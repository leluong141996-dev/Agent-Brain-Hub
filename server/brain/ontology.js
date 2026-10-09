// Minimal ontology for Semantic Memory: entity types, relation types and the
// validation / scoping / ownership rules attached to each relation.
// scope:   private (only the writer domain sees it) | shared | global
// writer:  the single domain allowed to write this relation (single-writer-per-entity)
// card:    'one' → a new different value is a candidate contradiction; 'many' → a set
import { stripDiacritics, norm } from '../text.js';
import { tr } from '../i18n.js';

export const ENTITY_TYPES = ['customer', 'asset', 'trip', 'health_profile', 'finance_profile', 'organization'];

export const RELATIONS = {
  name: { entity: 'customer', card: 'one', scope: 'shared', writer: 'personal', label: { vi: 'tên', en: 'name', ja: '名前' } },
  lives_in: { entity: 'customer', card: 'one', scope: 'shared', writer: 'personal', label: { vi: 'sống ở', en: 'lives in', ja: '居住地' } },
  occupation: { entity: 'customer', card: 'one', scope: 'shared', writer: 'personal', label: { vi: 'nghề nghiệp', en: 'occupation', ja: '職業' } },
  has_children: { entity: 'customer', card: 'one', scope: 'shared', writer: 'personal', label: { vi: 'số con', en: 'children', ja: '子どもの人数' } },
  prefers: { entity: 'customer', card: 'many', scope: 'shared', writer: 'personal', ttlDays: 365, label: { vi: 'thích', en: 'likes', ja: '好きなもの' }, opposite: 'dislikes' },
  dislikes: { entity: 'customer', card: 'many', scope: 'shared', writer: 'personal', ttlDays: 365, label: { vi: 'không thích', en: 'dislikes', ja: '苦手なもの' }, opposite: 'prefers' },
  diet: { entity: 'customer', card: 'one', scope: 'shared', writer: 'personal', label: { vi: 'chế độ ăn', en: 'diet', ja: '食事制限' } },
  clothing_size: { entity: 'customer', card: 'one', scope: 'shared', writer: 'shopping', label: { vi: 'size', en: 'size', ja: 'サイズ' } },
  owns_asset: { entity: 'asset', card: 'many', scope: 'shared', writer: 'repair', label: { vi: 'sở hữu', en: 'owns', ja: '所有物' } },
  asset_issue: { entity: 'asset', card: 'many', scope: 'private', writer: 'repair', ttlDays: 90, label: { vi: 'đang gặp lỗi', en: 'has an issue', ja: '不具合' } },
  asset_unavailable: { entity: 'asset', card: 'one', scope: 'shared', writer: 'repair', ttlDays: 7, label: { vi: 'tình trạng', en: 'availability', ja: '利用状況' } },
  trip_destination: { entity: 'trip', card: 'one', scope: 'shared', writer: 'travel', ttlDays: 30, label: { vi: 'chuyến đi tới', en: 'trip to', ja: '行き先' } },
  prefers_seat: { entity: 'trip', card: 'one', scope: 'shared', writer: 'travel', label: { vi: 'ghế ưa thích', en: 'preferred seat', ja: '希望の座席' } },
  allergic_to: { entity: 'health_profile', card: 'many', scope: 'private', writer: 'health', label: { vi: 'dị ứng', en: 'allergic to', ja: 'アレルギー' } },
  health_condition: { entity: 'health_profile', card: 'many', scope: 'private', writer: 'health', label: { vi: 'bệnh nền', en: 'condition', ja: '持病' } },
  budget: { entity: 'finance_profile', card: 'one', scope: 'shared', writer: 'finance', ttlDays: 90, label: { vi: 'ngân sách', en: 'budget', ja: '予算' } },
  income: { entity: 'finance_profile', card: 'one', scope: 'private', writer: 'finance', label: { vi: 'thu nhập', en: 'income', ja: '収入' } },
  payment_method: { entity: 'finance_profile', card: 'one', scope: 'shared', writer: 'finance', label: { vi: 'thanh toán bằng', en: 'pays with', ja: '支払い方法' } },
  policy: { entity: 'organization', card: 'many', scope: 'global', writer: 'system', label: { vi: 'chính sách', en: 'policy', ja: 'ポリシー' } },
};

export function relationLabel(relation, lang) {
  return tr(RELATIONS[relation]?.label, lang) || relation;
}

export function validateFact(f) {
  const rel = RELATIONS[f.relation];
  if (!rel) return `relation "${f.relation}" not in ontology`;
  if (f.entity !== rel.entity) return `relation "${f.relation}" only applies to entity "${rel.entity}"`;
  const v = String(f.value || '').trim();
  if (v.length < 1 || v.length > 160) return 'empty or too long value';
  return null;
}

// --- Rule-based fact extraction (used offline, merged with LLM extraction) ---

const CITIES =
  'ha noi|hanoi|ho chi minh city|ho chi minh|tp hcm|sai gon|saigon|da nang|danang|nha trang|phu quoc|da lat|dalat|hue|hai phong|can tho|quy nhon|vung tau|singapore|bangkok|tokyo|seoul|paris|london|new york|sydney';
const BRANDS =
  'toyota|honda|vinfast|mazda|kia|hyundai|ford|mercedes|bmw|lexus|mitsubishi|tesla|suzuki|nissan|peugeot|audi|porsche|apple|macbook|iphone|ipad|samsung|galaxy|dell|hp|lenovo|thinkpad|asus|acer|xiaomi|oppo|pixel|sony|lg|panasonic|daikin';
const END = '(?=\\s*(?:[,.!?;]|$|\\s(?:va|nhung|nhe|ma|roi|vi|nen|and|but|so|because|it|which)\\s))';
const ME = '(?:toi|minh|em|tui)';

// Japanese rules (no spaces; a value is a run of non-punctuation characters).
const JW = '[^\\s、。,.!！?？「」]';
const JA_CITIES = '東京|大阪|京都|札幌|福岡|沖縄|名古屋|横浜|神戸|広島|ダナン|ハノイ|ホーチミン|ソウル|バンコク|シンガポール|台北|パリ|ロンドン|ニューヨーク';
const JA_BRANDS = 'トヨタ|ホンダ|日産|マツダ|スバル|スズキ|レクサス|テスラ|アップル|マックブック|アイフォン|ソニー|パナソニック|ダイキン|サムスン|' + 'toyota|honda|nissan|mazda|subaru|lexus|tesla|macbook|iphone|ipad|sony|panasonic|daikin|samsung|dell|lenovo';
const JA_RULES = [
  { rel: 'name', re: new RegExp(`(?:私の名前は|わたしの名前は|名前は)(${JW}{1,15}?)(?:です|と申します|といいます|[、。！!]|$)`) },
  { rel: 'name', re: new RegExp(`(?:私は|わたしは)?(${JW}{1,10}?)と申します`) },
  { rel: 'lives_in', re: new RegExp(`(${JW}{1,15}?)に(?:住んで|住む|在住|引っ越し)`) },
  { rel: 'dislikes', re: new RegExp(`(${JW.slice(0, -1)}は]{1,20}?)が(?:好きじゃない|好きではない|嫌い|苦手)`) },
  { rel: 'prefers', re: new RegExp(`(${JW.slice(0, -1)}は]{1,20}?)が(?:大)?好き(?!じゃない|ではない)`) },
  { rel: 'allergic_to', re: new RegExp(`(${JW.slice(0, -1)}は]{1,15}?)(?:の)?アレルギー`) },
  { rel: 'health_condition', re: /(糖尿病|高血圧|喘息|腰痛|不眠症|偏頭痛|心臓病)/ },
  { rel: 'diet', re: /(ベジタリアン|ヴィーガン|菜食主義)/ },
  { rel: 'owns_asset', re: new RegExp(`(?:車|愛車|パソコン|ノートパソコン|スマホ|携帯)は((?:${JA_BRANDS})${JW}{0,15}?)(?:です|で|[、。！!]|$)`) },
  { rel: 'asset_issue', re: new RegExp(`((?:ブレーキ|エンジン|画面|バッテリー|エアコン|タイヤ)が${JW}{1,10}?)(?:て|しまい|ました|[、。！!]|$)`) },
  { rel: 'trip_destination', re: new RegExp(`(${JA_CITIES})(?:へ|に|まで|行き|への)?(?:の)?(?:出張|旅行|フライト|航空券|飛行機|行く|行きたい)`) },
  { rel: 'prefers_seat', re: /(窓側|通路側)(?:の)?(?:席|座席)/ },
  { rel: 'has_children', re: /子(?:ども|供)が(\d+|一|二|三|四|ひとり|ふたり)人?/ },
  { rel: 'occupation', re: /(?:私は|わたしは|仕事は)(エンジニア|医者|医師|教師|先生|会計士|建築家|弁護士|看護師|学生|デザイナー)/ },
  { rel: 'budget', re: /予算[^\d]{0,12}?([\d,.]+\s?(?:万円|千円|円|ドル|万))/ },
  { rel: 'income', re: /(?:給料|月収|年収|収入)[^\d]{0,10}?([\d,.]+\s?(?:万円|千円|円|ドル|万))/ },
  { rel: 'payment_method', re: /(クレジットカード|クレカ|デビットカード|現金|銀行振込|paypay|ペイペイ|電子マネー)(?:で|払い)/ },
  { rel: 'clothing_size', re: /(?:サイズ|靴のサイズ)は?\s*(xxs|xs|s|m|l|xl|xxl|\d{2}(?:\.\d)?(?:cm|センチ)?)/ },
];

// Each rule runs against the diacritic-stripped text; captured spans are
// sliced from the original string so values keep their Vietnamese accents.
// The first non-empty capture group is the value.
const RULES = [
  { rel: 'name', re: new RegExp(`(?:ten ${ME} la|${ME} ten la|my name is|i am called|call me)\\s+([a-z][a-z ]{1,30}?)${END}`) },
  { rel: 'lives_in', re: new RegExp(`(?:${ME} (?:dang |hien )?song (?:o|tai)|nha ${ME} o|(?:moi )?chuyen (?:den|ve|toi) (?:song o )?|i live in|i'm based in|i moved to|moved to)\\s*([a-z][a-z ]{1,25}?)${END}`) },
  { rel: 'dislikes', re: new RegExp(`(?:khong (?:thich|ua|muon dung)|ghet|i (?:don'?t|do not) like|i hate|i dislike)\\s+([^,.!?;]{2,40}?)${END}`) },
  { rel: 'prefers', re: new RegExp(`(?<!khong )(?:${ME} (?:rat |cung |van )?(?:thich|uu tien|hay chon|me)|i (?:really )?(?:like|love|prefer|enjoy))\\s+([^,.!?;]{2,40}?)${END}`) },
  { rel: 'allergic_to', re: new RegExp(`(?:di ung (?:voi )?|allergic to |allergy to )([^,.!?;]{2,30}?)${END}`) },
  { rel: 'health_condition', re: new RegExp(`(?:${ME} (?:bi|mac|co tien su) (?:benh )?|i have |i suffer from )(tieu duong|cao huyet ap|huyet ap cao|hen suyen|dau lung|dau da day|tim mach|mat ngu|diabetes|high blood pressure|asthma|back pain|insomnia|migraines?)`) },
  { rel: 'diet', re: new RegExp(`(?:${ME} an |i am |i'm )(chay|kieng [a-z ]{2,15}?|vegetarian|vegan|keto)${END}`) },
  { rel: 'owns_asset', re: new RegExp(`(?:(?:xe|o to|laptop|may tinh|dien thoai) (?:cua )?${ME} la|${ME} (?:dang )?(?:di|lai|co|dung|xai) (?:mot )?(?:chiec |cai |xe |o to |laptop |dien thoai )?|my (?:car|laptop|phone|computer) is (?:an? )?|i (?:drive|own|use|have) (?:an? )?)\\s*((?:${BRANDS})[a-z0-9 -]{0,15}?)${END}`) },
  { rel: 'asset_issue', re: new RegExp(`(?:xe|phanh|lop|may|man hinh|pin|dieu hoa|dong co|ac quy|car|laptop|phone|screen|engine|brakes?|battery)[a-z ]{0,10}? (?:bi |co tieng |dang |is |keeps |has )((?:keu|hong|ro ri|chet may|mat phanh|nong|yeu|xit|ket|vo|sap nguon|broken|cracked|making noise|overheating|not charging|leaking|dead)[a-z ]{0,20}?)${END}`) },
  { rel: 'trip_destination', re: new RegExp(`(?:bay|di cong tac|cong tac|di du lich|du lich|dat ve|ve may bay|fly|flight|trip|travel|going)(?: di| ra| vao| toi| den| o| sang| to)?\\s+(${CITIES})\\b`) },
  { rel: 'prefers_seat', re: /(?:ghe (canh cua so|loi di)|(window|aisle) seat)/ },
  { rel: 'has_children', re: /(?:(?:toi|minh|em) co (\d+|mot|hai|ba|bon) (?:dua |be )?(?:con|chau|be)|i have (\d+|one|two|three|four) (?:kids|children))/ },
  { rel: 'occupation', re: new RegExp(`(?:${ME} (?:la|lam)(?: nghe)? |i am an? |i'm an? |i work as an? )(bac si|ky su|giao vien|lap trinh vien|ke toan|doanh nhan|sinh vien|luat su|kien truc su|y ta|engineer|doctor|teacher|developer|accountant|architect|lawyer|nurse|student|designer)${END}`) },
  { rel: 'budget', re: /(?:ngan sach|budget)\b[a-z ]{0,35}?(\$?\d[\d.,]*\s?(?:trieu|tr|ty|k|nghin|ngan|usd|dollars|million|vnd|dong)?)/ },
  { rel: 'income', re: /(?:luong|thu nhap|salary|income)(?: cua (?:toi|minh)| (?:toi|minh))?(?: is| la| khoang| tam| around| about)*\s*(\$?\d[\d.,]*\s?(?:trieu|tr|k|usd|dollars|vnd)?(?: ?(?:mot thang|\/thang|a month|per month|\/month))?)/ },
  { rel: 'payment_method', re: /(?:(?:thanh toan|tra tien|tra) (?:bang|qua) (the tin dung|the ghi no|momo|zalopay|chuyen khoan|tien mat|vi dien tu|apple pay)|pay (?:by|with|via) (credit card|debit card|cash|paypal|apple pay|bank transfer))/ },
  { rel: 'clothing_size', re: /\bsize (?:ao |giay |quan )?(xxs|xs|s|m|l|xl|xxl|\d{2})\b/ },
  ...JA_RULES,
];

export const UPDATE_MARKERS = ['moi chuyen', 'bay gio', 'gio thi', 'hien gio', 'da doi', 'khong con', 'cap nhat', 'thay doi', ' now ', 'nowadays', 'from now', 'moved', 'changed', 'no longer', 'anymore', 'actually', ' nua ', ' nua roi ', '引っ越し', '今は', '変わり', 'もう', '最近は'];

const ASSET_NOUNS = [
  ['o to', 'xe', 'car'], ['xe', 'xe', 'car'], ['laptop', 'laptop', 'laptop'], ['may tinh', 'máy tính', 'computer'],
  ['dien thoai', 'điện thoại', 'phone'], ['car', 'xe', 'car'], ['phone', 'điện thoại', 'phone'], ['computer', 'máy tính', 'computer'],
];
const assetNoun = (low, lang) => {
  const hit = ASSET_NOUNS.find(([k]) => new RegExp(`\\b${k}\\b`).test(low));
  return hit ? (lang === 'en' ? hit[2] : hit[1]) : lang === 'en' ? 'device' : 'thiết bị';
};
const JA_NOUNS = [['車', '車'], ['ノートパソコン', 'パソコン'], ['パソコン', 'パソコン'], ['スマホ', 'スマホ'], ['携帯', '携帯']];
const jaNoun = (text) => (JA_NOUNS.find(([k]) => text.includes(k)) || [null, 'デバイス'])[1];

function shadow(text) {
  // Same length as `text` (NFC), lowercase and without diacritics.
  let out = '';
  for (const ch of text) {
    const s = stripDiacritics(ch).toLowerCase();
    out += s.length === ch.length ? s : ch.toLowerCase();
  }
  return out;
}


// Trailing time/update words that speakers attach to a preference change
// ("I don't like X anymore"). Keep them in the sentence so UPDATE_MARKERS
// still fire; strip them from the stored value so opposite-fact matching works.
const TEMPORAL_TAIL = /(?:\s+(?:anymore|any\s+more|now|these\s+days|nowadays|nữa\s+rồi|nua\s+roi|nữa|nua|rồi|roi))+$/iu;

function stripTemporalTail(value) {
  const next = String(value || '').replace(TEMPORAL_TAIL, '').trim();
  return next || String(value || '').trim();
}

export function extractFactsRuleBased(rawText) {
  const text = rawText.normalize('NFC');
  const low = shadow(text);
  const facts = [];
  for (const { rel, re } of RULES) {
    const flags = re.flags.includes('d') ? re.flags : re.flags + 'd';
    const m = new RegExp(re.source, flags).exec(low);
    if (!m) continue;
    const g = m.indices.findIndex((ix, i) => i > 0 && ix);
    if (g < 1) continue;
    const [s, e] = m.indices[g];
    let value = text.slice(s, e).trim();
    if (rel === 'name') value = value.replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toUpperCase());
    if (rel === 'prefers' || rel === 'dislikes') value = stripTemporalTail(value);
    facts.push({ entity: RELATIONS[rel].entity, relation: rel, value, evidence: text.slice(m.index, m.index + m[0].length) });
  }
  // "xe phải sửa 3 ngày" / "my car is in the shop for 3 days" → temporary unavailability
  const vi = low.match(/(?:sua|gara|bao duong|bao hanh|nam xuong|mat xe|khong co xe)[a-z ]{0,25}?(\d+) ngay/);
  const en = low.match(/(?:repair|in the shop|serviced|fixed|garage|warranty)[a-z ]{0,25}?(\d+) days?/);
  if (vi || en) {
    const lang = vi ? 'vi' : 'en';
    const n = (vi || en)[1];
    const noun = assetNoun(low, lang);
    facts.push({ entity: 'asset', relation: 'asset_unavailable', value: lang === 'vi' ? `không có ${noun} ${n} ngày` : `no ${noun} for ${n} days`, ttlDays: Number(n) + 1, evidence: (vi || en)[0] });
  } else if (/(?:xe|o to|laptop|dien thoai|may tinh)[a-z ]{0,12}(?:hong|chet may|tai nan|nam gara|dang sua|vo man)/.test(low)) {
    facts.push({ entity: 'asset', relation: 'asset_unavailable', value: `${assetNoun(low, 'vi')} đang hỏng / đang sửa`, evidence: 'broken' });
  } else if (/(?:car|laptop|phone|computer)[a-z' ]{0,12}(?:broke|broken|won't start|in the shop|cracked)/.test(low)) {
    facts.push({ entity: 'asset', relation: 'asset_unavailable', value: `${assetNoun(low, 'en')} broken / in repair`, evidence: 'broken' });
  } else {
    const ja = text.match(/(?:修理|点検|車検|入庫|預け)[^\d]{0,12}?(\d+)日/);
    if (ja) {
      facts.push({ entity: 'asset', relation: 'asset_unavailable', value: `${jaNoun(text)}が${ja[1]}日間使えない`, ttlDays: Number(ja[1]) + 1, evidence: ja[0] });
    } else if (/(?:車|パソコン|スマホ|携帯)が(?:故障|壊れ|動かな)/.test(text)) {
      facts.push({ entity: 'asset', relation: 'asset_unavailable', value: `${jaNoun(text)}が故障中`, evidence: 'broken' });
    }
  }
  const isUpdate = UPDATE_MARKERS.some((k) => ` ${low} `.includes(k));
  return facts.map((f) => ({ ...f, isUpdate }));
}

// Display text in a given language.
export function factValue(f, lang = 'vi') {
  return f.valueI18n?.[lang] ?? f.value;
}

export function factToText(f, lang = 'vi') {
  return `${relationLabel(f.relation, lang)}${lang === 'ja' ? '：' : ': '}${factValue(f, lang)}`;
}

// Text used for embeddings: both labels so queries in either language match.
export function factEmbedText(f) {
  const rel = RELATIONS[f.relation];
  const extra = f.valueI18n ? Object.values(f.valueI18n).join(' ') : '';
  return `${rel ? `${rel.label.vi} ${rel.label.en} ${rel.label.ja}` : f.relation}: ${f.value} ${extra}`.trim();
}

export function sameValue(a, b) {
  return norm(a) === norm(b);
}
