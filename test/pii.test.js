// v0.8.1: more PII formats in the brainstem (US SSN, IBAN, international phones),
// and the things that look similar but must stay: order numbers, dates, amounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../server/brain/brainstem.js';

const clean = (s) => redact(s).text;

test('pii: formatted US social security numbers are redacted; impossible ones and plain numbers are not', () => {
  assert.equal(clean('My SSN is 123-45-6789.'), 'My SSN is [SSN].');
  assert.equal(clean('SSN 078 05 1120 please'), 'SSN [SSN] please');
  for (const s of ['000-12-3456', '666-12-3456', '923-45-6789', '123-00-6789', '123-45-0000']) assert.equal(clean(s), s, `${s} is not a valid SSN`);
  assert.equal(clean('order 123456789 shipped'), 'order 123456789 shipped');
});

test('pii: IBANs are redacted when the check digits are right', () => {
  assert.equal(clean('Pay to GB82 WEST 1234 5698 7654 32 today'), 'Pay to [IBAN] today');
  assert.equal(clean('DE89370400440532013000'), '[IBAN]');
  assert.equal(clean('FR14 2004 1010 0505 0001 3M02 606'), '[IBAN]');
  assert.ok(!clean('GB83 WEST 1234 5698 7654 32').includes('[IBAN]'), 'a wrong check digit is not an IBAN (the card pattern may still take its digits)');
  assert.equal(clean('Ticket AB12 CD34 EF56'), 'Ticket AB12 CD34 EF56');
});

test('pii: international phone numbers are redacted', () => {
  assert.equal(clean('Call +44 20 7946 0958 now'), 'Call [PHONE] now');
  assert.equal(clean('Mine is +1 (415) 555-2671.'), 'Mine is [PHONE].');
  assert.equal(clean('+49 30 901820'), '[PHONE]');
  assert.equal(clean('+61 2 9374 4000'), '[PHONE]');
  assert.equal(clean('Vietnamese +84 912 345 678'), 'Vietnamese [PHONE]', 'existing format still works');
});

test('pii: order numbers, dates, amounts and scores stay', () => {
  for (const s of ['My order ORD-48207 for a rain jacket', 'on 2026-10-17 at 10:30', 'it costs 3,000 USD, +100 points', 'WH-1000XM5 headphones', 'flight VN 123 to Da Nang', 'budget 800 USD', 'Room 1204, floor 12', 'I was born in 1990']) {
    assert.equal(clean(s), s);
  }
});

test('pii: found items never echo the value', () => {
  const r = redact('SSN 123-45-6789, IBAN DE89370400440532013000, call +44 20 7946 0958');
  assert.deepEqual(r.found.map((f) => f.type).sort(), ['IBAN', 'PHONE', 'SSN']);
  assert.ok(r.found.every((f) => f.sample.endsWith('•••') && f.sample.length <= 5));
});
