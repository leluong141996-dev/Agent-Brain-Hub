// Prefrontal cortex — Shared Context Service: working memory (customer state,
// journey, intent, active task) + the executive memory-aware loop.
import { DOMAINS, SHARED_INTENTS, domainOf } from '../agents.js';
import { includesAny, truncate } from '../text.js';
import { tr } from '../i18n.js';

const HOT_TURNS = 3;
const MAX_TURNS = 40;

export function ensureWorking(B, customerId) {
  let wm = B.state.working[customerId];
  if (!wm) {
    wm = B.state.working[customerId] = {
      customerId,
      sessionId: null,
      journey: [],
      intent: null,
      activeTask: null,
      lastAgentId: null,
      salience: null,
      lang: 'vi',
      turns: [],
      handoffs: [],
      outcomes: [],
      updatedAt: 0,
    };
  }
  return wm;
}

export function detectIntent(text, agent) {
  const domain = domainOf(agent);
  let best = { intent: 'general', matched: [], confidence: 0.3, shared: false };
  const consider = (intents, shared) => {
    for (const [intent, kws] of Object.entries(intents)) {
      const m = includesAny(text, kws);
      if (m.length > best.matched.length) best = { intent, matched: m, confidence: Math.min(0.95, 0.55 + m.length * 0.15), shared };
    }
  };
  consider(domain.intents, false);
  if (best.intent === 'general') consider(SHARED_INTENTS, true);
  // Intents from other domains (e.g. "book a flight" said to the repair agent) → cross-domain hint
  if (best.intent === 'general') {
    for (const [d, def] of Object.entries(DOMAINS)) {
      if (d === agent.domain) continue;
      for (const [intent, kws] of Object.entries(def.intents)) {
        const m = includesAny(text, kws);
        if (m.length > best.matched.length) best = { intent, matched: m, confidence: 0.5, shared: false, foreignDomain: d };
      }
    }
  }
  return best;
}

export const TASKS = {
  reminder: { vi: 'Tạo nhắc việc', en: 'Create a reminder', ja: 'リマインダー作成' },
  family_event: { vi: 'Lên kế hoạch dịp gia đình', en: 'Plan a family occasion', ja: '家族イベントの計画' },
  advice: { vi: 'Tư vấn', en: 'Give advice', ja: 'アドバイス' },
  report_breakdown: { vi: 'Xử lý hỏng hóc / cứu hộ', en: 'Handle a breakdown', ja: '故障対応' },
  book_maintenance: { vi: 'Đặt lịch bảo dưỡng / sửa chữa', en: 'Book maintenance / repair', ja: 'メンテナンス・修理の予約' },
  repair_status: { vi: 'Theo dõi tiến độ sửa chữa', en: 'Track repair progress', ja: '修理状況の確認' },
  book_flight: { vi: 'Đặt vé máy bay', en: 'Book a flight', ja: '航空券の予約' },
  book_hotel: { vi: 'Đặt khách sạn', en: 'Book a hotel', ja: 'ホテルの予約' },
  ground_transport: { vi: 'Sắp xếp di chuyển mặt đất', en: 'Arrange ground transport', ja: '現地移動の手配' },
  book_doctor: { vi: 'Đặt lịch khám', en: 'Book a doctor', ja: '診察の予約' },
  symptom_check: { vi: 'Sàng lọc triệu chứng', en: 'Check symptoms', ja: '症状の確認' },
  medication: { vi: 'Quản lý thuốc', en: 'Manage medication', ja: '服薬管理' },
  budget_planning: { vi: 'Lập ngân sách', en: 'Plan a budget', ja: '予算計画' },
  insurance: { vi: 'Tư vấn bảo hiểm', en: 'Insurance advice', ja: '保険の相談' },
  payment: { vi: 'Xử lý thanh toán', en: 'Handle a payment', ja: '支払い対応' },
  buy_product: { vi: 'Tìm & mua sản phẩm', en: 'Find & buy a product', ja: '商品の検索・購入' },
  track_order: { vi: 'Theo dõi đơn hàng', en: 'Track an order', ja: '注文の追跡' },
  return_refund: { vi: 'Đổi trả / hoàn tiền', en: 'Return / refund', ja: '返品・返金' },
  complaint: { vi: 'Xử lý khiếu nại', en: 'Handle a complaint', ja: '苦情対応' },
};

export function taskName(task, lang) {
  return task ? tr(TASKS[task.intent], lang) || task.intent : null;
}

export function updateWorkingMemory(B, t, { customerId, agent, text, salience, newSession, traceId }) {
  const wm = ensureWorking(B, customerId);
  const now = B.clock.now();
  if (newSession) wm.sessionId = B.store.id('ses');
  const it = detectIntent(text, agent);
  if (wm.lastAgentId !== agent.id) wm.journey.push({ agentId: agent.id, at: now, intent: it.intent });
  wm.lastAgentId = agent.id;
  wm.intent = it.intent;
  wm.lang = t.lang;
  if (TASKS[it.intent]) wm.activeTask = { intent: it.intent, agentId: agent.id, since: now };
  wm.salience = salience;
  wm.turns.push({ role: 'user', text, agentId: agent.id, at: now, traceId, sessionId: wm.sessionId, consolidated: false });
  if (wm.turns.length > MAX_TURNS) wm.turns.splice(0, wm.turns.length - MAX_TURNS);
  wm.updatedAt = now;

  t.step('prefrontal', t.L(`Cập nhật Working Memory — intent: ${it.intent}`, `Working memory updated — intent: ${it.intent}`, `ワーキングメモリ更新 — 意図: ${it.intent}`), {
    intent: it,
    activeTask: taskName(wm.activeTask, t.lang),
    journey: wm.journey.slice(-4).map((j) => B.agentName(j.agentId)),
    turnsInWorkingMemory: wm.turns.length,
    session: wm.sessionId,
  });
  return { wm, intent: it };
}

export function recordReply(B, { customerId, agent, text, traceId }) {
  const wm = ensureWorking(B, customerId);
  wm.turns.push({ role: 'assistant', text, agentId: agent.id, at: B.clock.now(), traceId, sessionId: wm.sessionId, consolidated: false });
}

// A turn spoken with a private-scope agent (e.g. Health) is only visible to
// agents of that same domain — working memory obeys the same partitioning.
export function turnVisible(B, turn, agent) {
  const domain = B.agentDomain(turn.agentId);
  if (!domain || domain === agent.domain) return true;
  return DOMAINS[domain]?.episodeScope !== 'private';
}

export function hotTurns(B, wm, agent) {
  return wm.turns
    .filter((x) => turnVisible(B, x, agent))
    .slice(-HOT_TURNS * 2)
    .map((x) => `${x.role === 'user' ? 'Customer' : 'Agent'}: ${truncate(x.text, 160)}`);
}
