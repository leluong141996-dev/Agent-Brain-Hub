// Per-customer index over the memory arrays, so retrieval looks at one
// customer's facts and episodes instead of scanning everyone's.
//
// The arrays only change in two ways: items are pushed (new memories) or the
// whole array is replaced by a filtered copy (forgetting, reset, load). The index
// therefore follows them lazily: appended items are added incrementally, and a
// replaced array triggers a rebuild. Nothing else has to remember to update it.

const GLOBAL = '*';

function build(arr) {
  const by = new Map();
  for (const x of arr) add(by, x);
  return by;
}

function add(by, x) {
  let list = by.get(x.customerId);
  if (!list) by.set(x.customerId, (list = []));
  list.push(x);
}

export class MemoryIndex {
  constructor(B) {
    this.B = B;
    this.cache = {}; // kind → { arr, len, by }
  }

  sync(kind) {
    const arr = this.B.state[kind];
    let c = this.cache[kind];
    if (!c || c.arr !== arr || c.len > arr.length) {
      c = this.cache[kind] = { arr, len: arr.length, by: build(arr) };
    } else if (c.len < arr.length) {
      for (let i = c.len; i < arr.length; i++) add(c.by, arr[i]);
      c.len = arr.length;
    }
    return c.by;
  }

  episodes(customerId) {
    return this.sync('episodes').get(customerId) || [];
  }

  // Global facts (company policy) first, as they sit in the array, then the customer's.
  facts(customerId) {
    const by = this.sync('facts');
    return [...(customerId === GLOBAL ? [] : by.get(GLOBAL) || []), ...(by.get(customerId) || [])];
  }
}
