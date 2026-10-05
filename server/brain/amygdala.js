// Amygdala — Salience & Priority engine: sentiment, urgency, churn risk, VIP.
import { includesAny } from '../text.js';

const NEG = ['bực', 'tức', 'tệ', 'chán', 'thất vọng', 'quá đáng', 'khó chịu', 'lo lắng', 'sợ', 'mệt mỏi', 'phiền', 'kém', 'angry', 'terrible', 'awful', 'upset', 'annoyed', 'annoying', 'frustrated', 'disappointed', 'worried', 'ridiculous', 'unacceptable', '困る', '困り', '最悪', 'ひどい', 'イライラ', '不満', 'がっかり', '心配', '怒', '納得できない'];
const POS = ['cảm ơn', 'tuyệt', 'tốt quá', 'hài lòng', 'rất thích', 'ok luôn', 'great', 'thanks', 'thank you', 'perfect', 'awesome', 'love it', 'amazing', 'ありがとう', '助かり', '最高', '嬉しい', '満足'];
const URGENT = ['gấp', 'ngay', 'khẩn', 'hỏng', 'tai nạn', 'cấp cứu', 'chết máy', 'mất phanh', 'hôm nay', 'lập tức', 'urgent', 'asap', 'emergency', 'immediately', 'right now', 'today', 'broke down', 'broken', 'accident', '至急', '急ぎ', 'すぐに', '今すぐ', '緊急', '故障', '事故', '今日中'];
const CHURN = ['hủy', 'huỷ', 'chuyển sang bên khác', 'không dùng nữa', 'bỏ dịch vụ', 'đổi nhà cung cấp', 'cancel', 'switch provider', 'unsubscribe', 'close my account', '解約', '退会', '他社に乗り換え', 'キャンセル'];

export function amygdala(B, t, { text, customerId }) {
  const neg = includesAny(text, NEG);
  const pos = includesAny(text, POS);
  const urg = includesAny(text, URGENT);
  const churn = includesAny(text, CHURN);
  const bangs = (text.match(/!/g) || []).length;

  const sentiment = Math.max(-1, Math.min(1, (pos.length - neg.length * 1.2 - (bangs > 1 ? 0.3 : 0)) / 2));
  const urgency = Math.min(1, urg.length * 0.35 + (bangs > 0 ? 0.15 : 0) + (neg.length ? 0.15 : 0));
  const churnRisk = Math.min(1, churn.length * 0.6 + (sentiment < -0.4 ? 0.2 : 0));
  const vip = !!B.state.customers[customerId]?.vip;
  const score = urgency * 0.5 + Math.max(0, -sentiment) * 0.3 + churnRisk * 0.2 + (vip ? 0.2 : 0);
  const priority = score > 0.7 ? 'critical' : score > 0.4 ? 'high' : score > 0.15 ? 'normal' : 'low';

  const salience = {
    sentiment: +sentiment.toFixed(2),
    urgency: +urgency.toFixed(2),
    churnRisk: +churnRisk.toFixed(2),
    vip,
    priority,
    cues: { negative: neg, positive: pos, urgent: urg, churn },
  };
  t.step('amygdala', t.L(`Gắn nhãn cảm xúc: ${priority.toUpperCase()}`, `Emotional tagging: ${priority.toUpperCase()}`, `感情タグ付け：${priority.toUpperCase()}`), salience, {
    status: priority === 'critical' || priority === 'high' ? 'alert' : 'ok',
  });
  return salience;
}
