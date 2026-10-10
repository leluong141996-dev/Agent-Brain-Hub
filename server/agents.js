// Agent domains, their intents and the action catalogue used by Basal Ganglia.
// Six general-purpose specialties; a new agent (native or connected) picks one.
// Intent keywords cover Vietnamese, English and Japanese.
import { tr } from './i18n.js';

export const DOMAINS = {
  personal: {
    label: { vi: 'Trợ lý cá nhân', en: 'Personal assistant', ja: 'パーソナルアシスタント' },
    color: '#a855f7',
    retentionDays: null, // the customer profile is kept until they ask to delete it
    primaryLayers: ['semantic'],
    episodeScope: 'shared',
    intents: {
      reminder: ['nhắc', 'nhắc nhở', 'lịch hẹn', 'đặt lịch', 'remind', 'reminder', 'schedule', 'calendar', 'リマインド', '予定', 'カレンダー', '思い出させて'],
      family_event: ['sinh nhật', 'kỷ niệm', 'đám cưới', 'gia đình', 'birthday', 'anniversary', 'wedding', 'family', '誕生日', '記念日', '結婚式', '家族'],
      advice: ['tư vấn', 'lời khuyên', 'nên làm gì', 'advice', 'should i', 'recommend', 'アドバイス', '相談', 'どうすれば'],
    },
  },
  repair: {
    label: { vi: 'Sửa chữa & bảo dưỡng', en: 'Repair & maintenance', ja: '修理・メンテナンス' },
    color: '#f97316',
    retentionDays: 90,
    primaryLayers: ['procedural', 'episodic'],
    episodeScope: 'shared',
    intents: {
      report_breakdown: ['hỏng', 'chết máy', 'không lên nguồn', 'tai nạn', 'bị kêu', 'vỡ màn', 'broken', 'broke down', 'not working', 'breakdown', 'cracked', "won't start", '故障', '壊れ', '動かない', '割れ', 'エンジンがかからない', '事故'],
      book_maintenance: ['bảo dưỡng', 'sửa', 'thay dầu', 'kiểm tra định kỳ', 'bảo hành', 'maintenance', 'repair', 'service appointment', 'warranty', 'メンテナンス', '点検', '修理の予約', 'オイル交換', '保証'],
      repair_status: ['bao giờ xong', 'tiến độ', 'lấy lại', 'xong chưa', 'status', 'when will', 'ready yet', 'いつ終わ', '進捗', '状況'],
    },
  },
  travel: {
    label: { vi: 'Du lịch & di chuyển', en: 'Travel & transport', ja: '旅行・移動' },
    color: '#0ea5e9',
    retentionDays: 365,
    primaryLayers: ['episodic', 'semantic'],
    episodeScope: 'shared',
    intents: {
      book_flight: ['vé máy bay', 'máy bay', 'chuyến bay', 'bay', 'công tác', 'flight', 'fly', 'plane ticket', 'business trip', 'フライト', '航空券', '飛行機', '出張'],
      book_hotel: ['khách sạn', 'phòng', 'resort', 'homestay', 'hotel', 'room', 'accommodation', 'ホテル', '宿泊', '旅館', '部屋'],
      ground_transport: ['taxi', 'thuê xe', 'đưa đón', 'sân bay', 'grab', 'rent a car', 'car rental', 'airport transfer', 'airport', 'ride', 'タクシー', 'レンタカー', '空港', '送迎'],
    },
  },
  health: {
    label: { vi: 'Sức khoẻ', en: 'Health & wellness', ja: 'ヘルスケア' },
    color: '#10b981',
    retentionDays: 3650,
    primaryLayers: ['semantic', 'episodic'],
    episodeScope: 'private', // sensitive data never leaves the health agent
    intents: {
      book_doctor: ['khám', 'bác sĩ', 'phòng khám', 'doctor', 'clinic', 'appointment with', '診察', '医者', '病院', 'クリニック'],
      symptom_check: ['đau', 'sốt', 'ho', 'mệt', 'chóng mặt', 'triệu chứng', 'mất ngủ', 'pain', 'fever', 'cough', 'tired', 'dizzy', 'symptom', 'insomnia', '痛い', '痛み', '熱', '咳', 'だるい', 'めまい', '症状', '眠れない'],
      medication: ['thuốc', 'uống thuốc', 'đơn thuốc', 'medication', 'medicine', 'pill', 'prescription', '薬', '服薬', '処方'],
    },
  },
  finance: {
    label: { vi: 'Tài chính cá nhân', en: 'Personal finance', ja: '個人ファイナンス' },
    color: '#eab308',
    retentionDays: 1825,
    primaryLayers: ['semantic', 'episodic'],
    episodeScope: 'private', // money matters stay with the finance agent
    intents: {
      budget_planning: ['ngân sách', 'chi tiêu', 'tiết kiệm', 'kế hoạch tài chính', 'lương', 'thu nhập', 'kiếm được', 'budget', 'spending', 'save money', 'saving', 'income', 'salary', 'earn', 'earnings', 'paycheck', '予算', '支出', '貯金', '節約', '収入', '給料', '月収', '年収'],
      insurance: ['bảo hiểm', 'quyền lợi', 'bồi thường', 'insurance', 'claim', 'coverage', '保険', '補償', '請求'],
      payment: ['thanh toán', 'hoá đơn', 'hóa đơn', 'chuyển khoản', 'trả góp', 'payment', 'bill', 'invoice', 'transfer', '支払い', '請求書', '振込', '分割払い'],
    },
  },
  shopping: {
    label: { vi: 'Mua sắm & đơn hàng', en: 'Shopping & orders', ja: 'ショッピング・注文' },
    color: '#ec4899',
    retentionDays: 180,
    primaryLayers: ['episodic', 'semantic'],
    episodeScope: 'shared',
    intents: {
      buy_product: ['mua', 'sản phẩm', 'giá', 'so sánh', 'buy', 'product', 'price', 'compare', 'looking for', '買いたい', '購入', '商品', '値段', '比較', '探して'],
      track_order: ['đơn hàng', 'giao hàng', 'vận chuyển', 'order', 'delivery', 'shipping', 'package', '注文', '配送', '届か', '荷物'],
      return_refund: ['đổi trả', 'hoàn tiền', 'trả hàng', 'return', 'refund', 'exchange', '返品', '返金', '交換'],
    },
  },
};

// Intents every agent understands (shared procedural memory).
export const SHARED_INTENTS = {
  complaint: ['khiếu nại', 'bực', 'tệ', 'chán', 'thất vọng', 'quá đáng', 'không hài lòng', 'complain', 'complaint', 'terrible', 'unacceptable', 'not happy', 'angry', '苦情', 'クレーム', 'ひどい', '最悪', '不満', '納得できない'],
  share_info: ['tên tôi', 'tôi sống', 'tôi thích', 'tôi không thích', 'dị ứng', 'tôi có', 'tôi là', 'my name', 'i live', 'i like', 'i am', "i'm", 'allergic', '私の名前', '住んで', '好き', 'アレルギー'],
  greeting: ['xin chào', 'chào', 'hello', 'hi', 'hey', 'こんにちは', 'こんばんは', 'おはよう'],
};

const isCar = (v) => /xe|ô tô|oto|car|vehicle|車/i.test(v || '');

// Action catalogue. `when(ctx)` returns a relevance 0..1 from context signals:
// ctx = { intent, facts: Map(relation → value), salience, domain }
export const ACTIONS = [
  { id: 'loaner_offer', domain: 'repair', label: { vi: 'Cho mượn xe/thiết bị thay thế trong lúc sửa', en: 'Offer a loaner car/device during the repair', ja: '修理中の代車・代替機を提供' }, when: (c) => (c.intent === 'report_breakdown' ? 0.9 : c.facts.has('asset_unavailable') ? 0.5 : 0) },
  { id: 'onsite_pickup', domain: 'repair', label: { vi: 'Cử kỹ thuật viên / nhận tận nơi', en: 'Send a technician / pick up on site', ja: '技術者の派遣・引き取り' }, when: (c) => (c.intent === 'report_breakdown' ? 0.8 : 0.1) },
  { id: 'maintenance_plan', domain: 'repair', label: { vi: 'Gợi ý gói bảo dưỡng định kỳ', en: 'Suggest a regular maintenance plan', ja: '定期メンテナンスプランを提案' }, when: (c) => (c.intent === 'book_maintenance' ? 0.7 : 0.1) },
  { id: 'rental_car_bundle', domain: 'travel', label: { vi: 'Thuê xe tự lái tại điểm đến (kèm vé)', en: 'Self-drive rental at the destination (bundled)', ja: '現地レンタカーをセットで手配' }, when: (c) => (isCar(c.facts.get('asset_unavailable')) ? 0.95 : c.intent === 'ground_transport' ? 0.6 : 0.15) },
  { id: 'taxi_bundle', domain: 'travel', label: { vi: 'Đặt taxi sân bay kèm vé máy bay', en: 'Airport taxi bundled with the flight', ja: '航空券と空港タクシーをセットで手配' }, when: (c) => (isCar(c.facts.get('asset_unavailable')) ? 0.85 : c.intent === 'book_flight' ? 0.4 : 0.1) },
  { id: 'hotel_near_meeting', domain: 'travel', label: { vi: 'Gợi ý khách sạn gần nơi công tác', en: 'Suggest a hotel near the meeting place', ja: '出張先近くのホテルを提案' }, when: (c) => (c.intent === 'book_flight' || c.intent === 'book_hotel' ? 0.55 : 0.1) },
  { id: 'travel_insurance', domain: 'travel', label: { vi: 'Bảo hiểm du lịch cho chuyến đi', en: 'Travel insurance for the trip', ja: '旅行保険の加入' }, when: (c) => (c.facts.has('trip_destination') ? 0.45 : 0.1) },
  { id: 'book_checkup', domain: 'health', label: { vi: 'Đặt lịch khám với bác sĩ phù hợp', en: 'Book a check-up with a suitable doctor', ja: '適切な医師の診察を予約' }, when: (c) => (c.intent === 'symptom_check' || c.intent === 'book_doctor' ? 0.85 : 0.15) },
  { id: 'medication_reminder', domain: 'health', label: { vi: 'Bật nhắc uống thuốc', en: 'Turn on medication reminders', ja: '服薬リマインダーを設定' }, when: (c) => (c.intent === 'medication' ? 0.8 : c.facts.has('health_condition') ? 0.4 : 0.05) },
  { id: 'budget_plan', domain: 'finance', label: { vi: 'Lập kế hoạch ngân sách tháng', en: 'Build a monthly budget plan', ja: '月間予算プランを作成' }, when: (c) => (c.intent === 'budget_planning' ? 0.85 : c.facts.has('income') ? 0.3 : 0.1) },
  { id: 'insurance_review', domain: 'finance', label: { vi: 'Rà soát quyền lợi bảo hiểm', en: 'Review insurance coverage', ja: '保険の補償内容を見直し' }, when: (c) => (c.intent === 'insurance' ? 0.8 : c.facts.has('has_children') ? 0.3 : 0.1) },
  { id: 'autopay_setup', domain: 'finance', label: { vi: 'Bật thanh toán hoá đơn tự động', en: 'Set up automatic bill payment', ja: '請求書の自動支払いを設定' }, when: (c) => (c.intent === 'payment' ? 0.75 : 0.05) },
  { id: 'product_shortlist', domain: 'shopping', label: { vi: 'Gợi ý 3 sản phẩm hợp ngân sách', en: 'Shortlist 3 products within budget', ja: '予算内のおすすめ商品を3つ提案' }, when: (c) => (c.intent === 'buy_product' ? (c.facts.has('budget') ? 0.9 : 0.7) : 0.1) },
  { id: 'track_shipment', domain: 'shopping', label: { vi: 'Theo dõi đơn hàng theo thời gian thực', en: 'Track the order in real time', ja: '注文をリアルタイムで追跡' }, when: (c) => (c.intent === 'track_order' ? 0.85 : 0.05) },
  { id: 'easy_return', domain: 'shopping', label: { vi: 'Tạo yêu cầu đổi trả nhanh', en: 'Start a quick return request', ja: 'かんたん返品リクエストを作成' }, when: (c) => (c.intent === 'return_refund' ? 0.85 : 0.05) },
  { id: 'set_reminder', domain: 'personal', label: { vi: 'Tạo nhắc việc trên lịch', en: 'Create a calendar reminder', ja: 'カレンダーにリマインダーを作成' }, when: (c) => (c.intent === 'reminder' ? 0.85 : 0.1) },
  { id: 'family_gift', domain: 'personal', label: { vi: 'Gợi ý quà / kế hoạch cho dịp gia đình', en: 'Suggest a gift / plan for the family occasion', ja: '家族のイベント向けにギフト・プランを提案' }, when: (c) => (c.intent === 'family_event' ? 0.8 : 0.05) },
  { id: 'escalate_human', domain: '*', label: { vi: 'Chuyển chuyên viên ưu tiên (escalation)', en: 'Escalate to a priority human agent', ja: '担当者へ優先エスカレーション' }, when: (c) => (c.salience.urgency > 0.7 && c.salience.sentiment < -0.3 ? 0.9 : c.intent === 'complaint' ? 0.6 : 0) },
  { id: 'apology_voucher', domain: '*', label: { vi: 'Xin lỗi + tặng voucher bù đắp', en: 'Apologize + offer a goodwill voucher', ja: 'お詫びとクーポンの提供' }, when: (c) => (c.salience.sentiment < -0.4 ? 0.6 : 0) },
];

// Default permissions. Every agent always reads its own private memory and
// global policies; `readShared` opens the shared pool, `write` lets it learn.
export const DEFAULT_PERMISSIONS = { readShared: true, write: true };

export const DEFAULT_AGENTS = [
  { id: 'mia', name: 'Mia', domain: 'personal', kind: 'native', persona: { vi: 'Trợ lý cá nhân chu đáo: hồ sơ, gia đình, lịch hẹn, sở thích.', en: 'A thoughtful personal assistant: profile, family, schedule, preferences.', ja: 'プロフィール・家族・予定・好みを把握する気配りのできるアシスタント。' }, builtin: true },
  { id: 'kai', name: 'Kai', domain: 'repair', kind: 'native', persona: { vi: 'Kỹ thuật viên sửa chữa xe, thiết bị và đồ gia dụng — ngắn gọn, thực tế.', en: 'A repair technician for cars, devices and home appliances — brief and practical.', ja: '車・デバイス・家電の修理技術者。簡潔で実践的。' }, builtin: true },
  { id: 'atlas', name: 'Atlas', domain: 'travel', kind: 'native', persona: { vi: 'Chuyên viên du lịch & công tác, chủ động gợi ý.', en: 'A travel and business-trip planner who suggests proactively.', ja: '先回りして提案する旅行・出張プランナー。' }, builtin: true },
  { id: 'sage', name: 'Sage', domain: 'health', kind: 'native', persona: { vi: 'Trợ lý sức khoẻ thận trọng, không chẩn đoán thay bác sĩ.', en: 'A careful wellness assistant that never replaces a doctor.', ja: '医師の代わりに診断はしない、慎重なヘルスケアアシスタント。' }, builtin: true },
  { id: 'penny', name: 'Penny', domain: 'finance', kind: 'native', persona: { vi: 'Cố vấn tài chính cá nhân: ngân sách, bảo hiểm, thanh toán.', en: 'A personal finance advisor: budgets, insurance, payments.', ja: '予算・保険・支払いを扱う個人ファイナンスアドバイザー。' }, builtin: true },
  { id: 'nova', name: 'Nova', domain: 'shopping', kind: 'native', persona: { vi: 'Trợ lý mua sắm: tìm sản phẩm, theo dõi đơn, đổi trả.', en: 'A shopping assistant: product search, order tracking, returns.', ja: '商品探し・注文追跡・返品をサポートするショッピングアシスタント。' }, builtin: true },
].map((a) => ({ ...a, permissions: { ...DEFAULT_PERMISSIONS } }));

export function domainOf(agent) {
  return DOMAINS[agent.domain] || DOMAINS.personal;
}

export function actionLabel(id, lang) {
  const a = ACTIONS.find((x) => x.id === id);
  return a ? tr(a.label, lang) : id;
}
