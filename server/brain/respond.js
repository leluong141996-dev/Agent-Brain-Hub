// Executive response composition. With an LLM: a memory-grounded prompt.
// Offline: a deterministic template that still uses every memory signal.
import { labelOf } from './cerebellum.js';
import { relationLabel } from './ontology.js';
import { L, tr, LANGUAGE_NAME } from '../i18n.js';

// Each template returns [vi, en, ja].
const INTENT_TEMPLATES = {
  reminder: () => ['Mình sẽ tạo nhắc việc cho anh/chị. Anh/chị muốn nhắc lúc nào ạ?', "I'll set up that reminder. When would you like to be reminded?", 'リマインダーを設定します。いつお知らせしましょうか？'],
  family_event: () => ['Mình sẽ giúp anh/chị lên kế hoạch cho dịp này thật chu đáo.', "I'll help you plan this occasion thoughtfully.", '大切な日のプランを丁寧にお手伝いします。'],
  advice: () => ['Mình sẽ đưa ra vài gợi ý phù hợp với hoàn cảnh của anh/chị.', "I'll share a few suggestions that fit your situation.", '状況に合わせていくつかご提案します。'],
  report_breakdown: (v) => [`Mình đã ghi nhận sự cố${v.asset ? ` với ${v.asset}` : ''} và sẽ điều phối kỹ thuật viên kiểm tra ngay.`, `I've logged the problem${v.asset ? ` with your ${v.asset}` : ''} and will get a technician on it right away.`, `${v.asset ? `${v.asset}の` : ''}不具合を承りました。すぐに技術者を手配します。`],
  book_maintenance: (v) => [`Mình sẽ đặt lịch bảo dưỡng${v.asset ? ` cho ${v.asset}` : ''}. Anh/chị muốn khung giờ nào ạ?`, `I'll book a maintenance slot${v.asset ? ` for your ${v.asset}` : ''}. What time works for you?`, `${v.asset ? `${v.asset}の` : ''}メンテナンスを予約します。ご希望の時間帯はありますか？`],
  repair_status: (v) => [`Mình đang kiểm tra tiến độ sửa chữa${v.asset ? ` ${v.asset}` : ''} cho anh/chị.`, `I'm checking the repair progress${v.asset ? ` on your ${v.asset}` : ''}.`, `${v.asset ? `${v.asset}の` : ''}修理状況を確認しています。`],
  book_flight: (v) => [`Mình sẽ tìm chuyến bay${v.dest ? ` đi ${v.dest}` : ''} phù hợp${v.seat ? `, ưu tiên ghế ${v.seat}` : ''}.`, `I'll look for a suitable flight${v.dest ? ` to ${v.dest}` : ''}${v.seat ? `, ${v.seat} seat preferred` : ''}.`, `${v.dest ? `${v.dest}行きの` : ''}最適なフライトをお探しします${v.seat ? `（${v.seat}の席を優先）` : ''}。`],
  book_hotel: (v) => [`Mình sẽ tìm khách sạn${v.dest ? ` ở ${v.dest}` : ''} phù hợp với anh/chị.`, `I'll find a hotel${v.dest ? ` in ${v.dest}` : ''} that suits you.`, `${v.dest ? `${v.dest}で` : ''}ご希望に合うホテルをお探しします。`],
  ground_transport: (v) => [`Mình sẽ sắp xếp phương tiện di chuyển${v.dest ? ` tại ${v.dest}` : ''} cho anh/chị.`, `I'll arrange ground transport${v.dest ? ` in ${v.dest}` : ''} for you.`, `${v.dest ? `${v.dest}での` : ''}移動手段を手配します。`],
  book_doctor: () => ['Mình sẽ tìm lịch khám phù hợp nhất cho anh/chị.', "I'll find the most suitable doctor's appointment for you.", '最適な診察の予約をお探しします。'],
  symptom_check: () => ['Anh/chị mô tả thêm giúp mình triệu chứng kéo dài bao lâu và mức độ thế nào nhé.', 'Could you tell me how long the symptoms have lasted and how severe they are?', '症状がいつから続いているか、どの程度か教えていただけますか？'],
  medication: () => ['Mình sẽ hỗ trợ anh/chị quản lý lịch dùng thuốc.', "I'll help you manage your medication schedule.", '服薬スケジュールの管理をお手伝いします。'],
  budget_planning: (v) => [`Mình sẽ lập kế hoạch chi tiêu${v.budget ? ` trong ngân sách ${v.budget}` : ''} cho anh/chị.`, `I'll put together a spending plan${v.budget ? ` within your ${v.budget} budget` : ''}.`, `${v.budget ? `予算${v.budget}の範囲で` : ''}支出プランを作成します。`],
  insurance: () => ['Mình sẽ rà soát các quyền lợi bảo hiểm phù hợp với anh/chị.', "I'll review the insurance coverage that fits you.", 'ご状況に合った保険の補償内容を確認します。'],
  payment: (v) => [`Mình sẽ hỗ trợ thanh toán${v.pay ? ` bằng ${v.pay}` : ''}.`, `I'll help with the payment${v.pay ? ` by ${v.pay}` : ''}.`, `${v.pay ? `${v.pay}での` : ''}お支払いをお手伝いします。`],
  buy_product: (v) => [`Mình sẽ tìm sản phẩm phù hợp${v.budget ? ` trong tầm ${v.budget}` : ''}${v.size ? `, size ${v.size}` : ''}.`, `I'll find matching products${v.budget ? ` within ${v.budget}` : ''}${v.size ? `, size ${v.size}` : ''}.`, `${v.budget ? `予算${v.budget}以内で` : ''}${v.size ? `サイズ${v.size}の` : ''}ぴったりの商品をお探しします。`],
  track_order: () => ['Mình đang kiểm tra trạng thái đơn hàng cho anh/chị.', "I'm checking your order status.", 'ご注文の状況を確認しています。'],
  return_refund: () => ['Mình sẽ hỗ trợ anh/chị đổi trả / hoàn tiền nhanh nhất.', "I'll get your return / refund sorted as quickly as possible.", '返品・返金をできるだけ早く手続きします。'],
  complaint: () => ['Mình thành thật xin lỗi về trải nghiệm chưa tốt này.', "I'm truly sorry about this experience.", 'ご不快な思いをおかけし、誠に申し訳ございません。'],
  share_info: () => ['Cảm ơn anh/chị đã chia sẻ, mình đã ghi nhớ.', "Thanks for sharing — I've noted that.", '教えていただきありがとうございます。記録しました。'],
  greeting: () => ['Rất vui được hỗ trợ anh/chị hôm nay!', 'Happy to help you today!', '本日はどうぞよろしくお願いいたします！'],
  general: () => ['Mình có thể giúp gì thêm cho anh/chị ạ?', 'How else can I help you?', 'ほかにお手伝いできることはありますか？'],
};

function factMap(selected, utteranceFacts) {
  const m = new Map();
  for (const s of selected) if (s.kind === 'semantic' && s.relation && s.status !== 'conflicted') m.set(s.relation, s.value);
  for (const f of utteranceFacts) m.set(f.relation, f.value);
  return m;
}

function firstName(name, lang) {
  if (!name) return null;
  if (lang === 'en') return name.split(' ')[0];
  if (lang === 'ja') return name.split(' ')[0];
  return name.split(' ').slice(-1)[0];
}

export function templateReply(ctx) {
  const { intent, salience, selected, actions, skill, handoffPkg, utteranceFacts, lang } = ctx;
  const T = (vi, en, ja) => L(lang, vi, en, ja);
  const facts = factMap(selected, utteranceFacts);
  const said = new Set(utteranceFacts.map((f) => f.relation));
  const parts = [];
  const first = firstName(facts.get('name'), lang);
  parts.push(first ? T(`Chào anh/chị ${first},`, `Hi ${first},`, `${first}様、`) : T('Chào anh/chị,', 'Hi there,', 'お問い合わせありがとうございます。'));
  if (salience.sentiment < -0.3) parts.push(T('mình rất tiếc về sự bất tiện này.', "I'm really sorry for the trouble.", 'ご迷惑をおかけして申し訳ございません。'));
  if (salience.priority === 'high' || salience.priority === 'critical') parts.push(T('Mình sẽ ưu tiên xử lý ngay.', "I'll make this a priority.", '最優先で対応いたします。'));

  if (handoffPkg?.facts?.length) {
    const task = handoffPkg.activeTask;
    parts.push(T(
      `Mình đã nhận thông tin từ ${handoffPkg.from}${task ? ` (đang: ${task.toLowerCase()})` : ''}.`,
      `I've got the context from ${handoffPkg.from}${task ? ` (working on: ${task.toLowerCase()})` : ''}.`,
      `${handoffPkg.from}から状況を引き継ぎました${task ? `（対応中：${task}）` : ''}。`
    ));
  }
  const recall = selected
    .filter((s) => s.kind === 'semantic' && s.scope !== 'global' && s.parts.entityHit > 0 && !said.has(s.relation) && s.status !== 'conflicted')
    .slice(0, 2)
    .map((s) => s.text);
  if (recall.length) {
    parts.push(T(
      `Mình nhớ: ${recall.join('; ')} — anh/chị không cần nhắc lại.`,
      `I remember: ${recall.join('; ')} — no need to repeat it.`,
      `把握しております：${recall.join('、')}。改めてお伝えいただく必要はありません。`
    ));
  }

  const conflicts = new Map();
  for (const s of selected.filter((x) => x.status === 'conflicted')) {
    const key = s.relation === 'dislikes' ? 'prefers' : s.relation;
    if (!conflicts.has(key)) conflicts.set(key, []);
    conflicts.get(key).push(s.text);
  }
  for (const [rel, vals] of conflicts) {
    parts.push(T(
      `Mình đang có thông tin chưa thống nhất về "${relationLabel(rel, 'vi')}" (${vals.join(' / ')}) — anh/chị xác nhận giúp mình nhé?`,
      `I have conflicting information about "${relationLabel(rel, 'en')}" (${vals.join(' / ')}) — could you confirm which is right?`,
      `「${relationLabel(rel, 'ja')}」について矛盾する情報があります（${vals.join(' / ')}）。どちらが正しいかご確認いただけますか？`
    ));
  }

  const tpl = INTENT_TEMPLATES[intent] || INTENT_TEMPLATES.general;
  const [vi, en, ja] = tpl({ asset: facts.get('owns_asset'), dest: facts.get('trip_destination'), seat: facts.get('prefers_seat'), budget: facts.get('budget'), size: facts.get('clothing_size'), pay: facts.get('payment_method') });
  parts.push(T(vi, en, ja));

  if (skill) {
    const steps = skill.steps.slice(-2).map((s) => labelOf(s, lang));
    parts.push(T(
      `Theo quy trình đã học (playbook v${skill.version}): ${steps.join(' → ')}.`,
      `Following the learned playbook (v${skill.version}): ${steps.join(' → ')}.`,
      `学習済みのプレイブック（v${skill.version}）に沿って対応します：${steps.join(' → ')}。`
    ));
  } else if (actions[0]) {
    parts.push(T(
      `Gợi ý thêm: ${actions[0].label.toLowerCase()} — anh/chị có muốn không?`,
      `Also: ${actions[0].label.toLowerCase()} — would you like that?`,
      `あわせて「${actions[0].label}」はいかがでしょうか？`
    ));
  }
  const policy = selected.find((s) => s.scope === 'global' && s.parts.sim > 0.2);
  if (policy) parts.push(T(`(Lưu ý: ${policy.value}.)`, `(Note: ${policy.value}.)`, `（ご参考：${policy.value}）`));
  return parts.join(lang === 'ja' ? '' : ' ');
}

export function buildPrompt(ctx) {
  const { agent, intent, salience, selected, actions, skill, handoffPkg, hot, lang } = ctx;
  const lines = [
    `You are ${agent.name}, an agent in a multi-agent system that shares one memory ("brain"). Persona: ${tr(agent.persona, lang) || 'a helpful assistant'}.`,
    `Always reply in ${LANGUAGE_NAME[lang]}, concisely (2-4 sentences) and naturally.${lang === 'ja' ? ' Use polite Japanese (です・ます調).' : ''}`,
    ...memoryInstructions(),
    '',
    contextBlock({ intent, salience, selected, actions, skill, handoffPkg, hot, lang }),
  ];
  return lines.join('\n');
}

export function memoryInstructions() {
  return [
    'Use the memories below naturally; NEVER ask again for something already known. If a fact is marked [CONFLICT], ask the customer to confirm instead of picking one.',
    'Tokens like [PHONE] or [EMAIL] are redacted data — never guess or repeat them.',
    'You have NO real booking/lookup tools yet: never invent prices, times, hotel or product names, order numbers, or claim something is already booked — say you will search/propose and ask the customer to confirm.',
    'Only use the information in the sections below; do not infer extra facts about the customer.',
  ];
}

// The memory context as a prompt block. Also returned to connected (external)
// agents by /v1/recall so they can drop it into their own system prompt.
export function contextBlock({ intent, salience, selected, actions, skill, handoffPkg, hot, lang }) {
  const facts = selected.filter((s) => s.kind === 'semantic');
  const eps = selected.filter((s) => s.kind === 'episodic');
  const lines = [
    `## Emotional signal (Amygdala)\npriority=${salience.priority}, sentiment=${salience.sentiment}, urgency=${salience.urgency}`,
    `## Current intent\n${intent}`,
  ];
  if (handoffPkg) lines.push(`## Handoff package from ${handoffPkg.from}\n${JSON.stringify({ task: handoffPkg.activeTask, lastTurns: handoffPkg.lastTurns })}`);
  if (facts.length) lines.push('## Semantic memory\n' + facts.map((f) => `- ${f.status === 'conflicted' ? '[CONFLICT] ' : ''}${f.text}${f.scope === 'global' ? ' (policy)' : ''}`).join('\n'));
  if (eps.length) lines.push('## Episodic memory\n' + eps.map((e) => `- ${e.text}`).join('\n'));
  if (hot?.length) lines.push('## Working memory (latest turns)\n' + hot.join('\n'));
  if (skill) lines.push(`## Learned playbook (v${skill.version}) — follow it, don't re-derive\n` + skill.steps.map((s, i) => `${i + 1}. ${labelOf(s, lang)}`).join('\n'));
  if (actions.length) lines.push('## Next best action (Basal Ganglia) — weave in the first one tactfully\n' + actions.map((a) => `- ${a.label}`).join('\n'));
  return lines.join('\n');
}
