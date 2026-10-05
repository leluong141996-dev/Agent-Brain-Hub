// SVG brain map: anatomical layout of regions, pathways and signal animation.

export const REGIONS = {
  input: { x: 70, y: 250, r: 26, en: 'Input', name: { vi: 'Giác quan', en: 'Senses', ja: '感覚' }, color: '#94a3b8', service: { vi: 'Tin nhắn của khách', en: 'Customer message', ja: 'お客様のメッセージ' }, role: { vi: 'Tín hiệu từ bên ngoài đi vào não.', en: 'Signals entering the brain from outside.', ja: '外部から脳に入るシグナル。' } },
  output: { x: 70, y: 470, r: 26, en: 'Output', name: { vi: 'Phản hồi', en: 'Response', ja: '応答' }, color: '#94a3b8', service: { vi: 'Câu trả lời cho khách', en: 'Reply to the customer', ja: 'お客様への応答' }, role: { vi: 'Hành động/lời nói của agent.', en: "The agent's words and actions.", ja: 'エージェントの言葉と行動。' } },
  thalamus: { x: 520, y: 318, r: 30, en: 'Thalamus', name: { vi: 'Đồi thị', en: 'Relay station', ja: '視床' }, color: '#38bdf8', service: 'Context Gateway', role: { vi: 'Trạm trung chuyển, định tuyến mọi tín hiệu giác quan đến vỏ não.', en: 'Relay station that routes every sensory signal to the cortex.', ja: 'あらゆる感覚シグナルを大脳皮質へ中継・ルーティングする。' }, data: { vi: 'Request/event từ agent, khởi tạo session', en: 'Agent requests/events, session start', ja: 'エージェントのリクエスト/イベント、セッション開始' }, tech: 'API Gateway + routing rules', loop: 'awake' },
  prefrontal: { x: 235, y: 238, r: 40, en: 'Prefrontal cortex', name: { vi: 'Vỏ não trước trán', en: 'Executive control', ja: '前頭前野' }, color: '#f472b6', service: 'Shared Context Service (Working memory + Executive)', role: { vi: 'Giữ thông tin đang xử lý, điều phối quyết định (executive function).', en: 'Holds what is being processed and coordinates decisions (executive function).', ja: '処理中の情報を保持し、意思決定を調整する（実行機能）。' }, data: { vi: 'Customer state, journey, intent, active task', en: 'Customer state, journey, intent, active task', ja: '顧客状態、ジャーニー、意図、進行中のタスク' }, tech: 'Redis / in-memory KV + pub-sub', loop: 'awake' },
  amygdala: { x: 455, y: 425, r: 24, en: 'Amygdala', name: { vi: 'Hạch hạnh nhân', en: 'Emotion tagging', ja: '扁桃体' }, color: '#f87171', service: 'Salience & Priority Engine', role: { vi: 'Gắn nhãn cảm xúc, đánh giá mức độ khẩn cấp.', en: 'Tags emotion and judges urgency.', ja: '感情をタグ付けし、緊急度を判断する。' }, data: { vi: 'Sentiment, urgency, VIP flag, churn risk', en: 'Sentiment, urgency, VIP flag, churn risk', ja: '感情、緊急度、VIPフラグ、解約リスク' }, tech: 'Intent/sentiment classifier + rule engine', loop: 'awake' },
  hippocampus: { x: 610, y: 410, r: 28, en: 'Hippocampus', name: { vi: 'Hồi hải mã', en: 'Memory encoding', ja: '海馬' }, color: '#facc15', service: 'Memory Encoding & Consolidation', role: { vi: 'Mã hoá trải nghiệm ngắn hạn thành ký ức dài hạn.', en: 'Turns short-term experience into long-term memory.', ja: '短期の経験を長期記憶へ符号化する。' }, data: { vi: 'Tóm tắt phiên, trích entity, hierarchical summarization', en: 'Session summaries, entity extraction, hierarchical summarization', ja: 'セッション要約、エンティティ抽出、階層的要約' }, tech: 'Worker queue + LLM summarization + embedding', loop: 'both' },
  neocortex: { x: 520, y: 118, r: 44, en: 'Neocortex', name: { vi: 'Vỏ não mới', en: 'Long-term memory', ja: '新皮質' }, color: '#818cf8', service: 'Persistent Memory Layer', role: { vi: 'Lưu trữ tri thức dài hạn: episodic, semantic, procedural.', en: 'Stores long-term knowledge: episodic, semantic, procedural.', ja: '長期の知識を保存：エピソード・意味・手続き。' }, data: { vi: 'Fact/preference, lịch sử sự kiện, pattern hành vi', en: 'Facts/preferences, event history, behaviour patterns', ja: '事実/好み、イベント履歴、行動パターン' }, tech: 'Vector DB + Graph DB + SQL', loop: 'both' },
  basal_ganglia: { x: 385, y: 330, r: 28, en: 'Basal ganglia', name: { vi: 'Hạch nền', en: 'Action selection', ja: '大脳基底核' }, color: '#fb923c', service: 'Next Best Action Engine', role: { vi: 'Chọn hành động, hình thành thói quen.', en: 'Selects actions and forms habits.', ja: '行動を選択し、習慣を形成する。' }, data: { vi: 'Tổng hợp tín hiệu → recommendation, học từ feedback', en: 'Signals → recommendation, learns from feedback', ja: 'シグナル → 推薦、フィードバックから学習' }, tech: 'Decision engine + bandit-style scoring', loop: 'awake' },
  cerebellum: { x: 800, y: 478, r: 36, en: 'Cerebellum', name: { vi: 'Tiểu não', en: 'Skill memory', ja: '小脳' }, color: '#34d399', service: 'Agent Playbook / Skill Memory', role: { vi: 'Trí nhớ thủ tục, tinh chỉnh kỹ năng qua lặp lại.', en: 'Procedural memory, refines skills through repetition.', ja: '手続き記憶。反復によってスキルを磨く。' }, data: { vi: 'Workflow đã học, few-shot pattern', en: 'Learned workflows, few-shot patterns', ja: '学習済みワークフロー、few-shotパターン' }, tech: 'Versioned playbook store', loop: 'both' },
  corpus_callosum: { x: 470, y: 232, r: 22, en: 'Corpus callosum', name: { vi: 'Thể chai', en: 'Agent bridge', ja: '脳梁' }, color: '#22d3ee', service: 'Cross-Agent Event Bus / Handoff', role: { vi: 'Bó sợi thần kinh kết nối hai bán cầu — handoff giữa các agent.', en: 'Fibre bundle joining the hemispheres — handoff between agents.', ja: '左右の半球をつなぐ神経束 — エージェント間の引き継ぎ。' }, data: { vi: 'Gói handoff đã lọc theo mức liên quan', en: 'Relevance-filtered handoff packages', ja: '関連度でフィルタした引き継ぎパッケージ' }, tech: 'Kafka/NATS + context filter', loop: 'awake' },
  brainstem: { x: 600, y: 580, r: 26, en: 'Brainstem', name: { vi: 'Thân não', en: 'Safety reflexes', ja: '脳幹' }, color: '#a3a3a3', service: 'Safety / Guardrail Layer', role: { vi: 'Phản xạ tự động, chức năng sống còn cơ bản.', en: 'Automatic reflexes and vital functions.', ja: '自動的な反射と生命維持の基本機能。' }, data: { vi: 'PII redaction, compliance, fallback', en: 'PII redaction, compliance, fallback', ja: '個人情報マスク、コンプライアンス、フォールバック' }, tech: 'Independent rule-engine middleware', loop: 'awake' },
  ras: { x: 575, y: 498, r: 22, en: 'RAS', name: { vi: 'Hệ lưới hoạt hoá', en: 'Attention filter', ja: '網様体賦活系' }, color: '#e879f9', service: 'Attention / Retrieval Service', role: { vi: 'Lọc và quyết định thông tin nào được đưa vào "ý thức".', en: 'Filters what is allowed into "consciousness".', ja: 'どの情報を「意識」に入れるかを選別する。' }, data: { vi: 'Ghép context liên quan từ Neocortex mỗi lần agent gọi', en: 'Assembles relevant context from the Neocortex on every call', ja: '呼び出しごとに新皮質から関連コンテキストを組み立て' }, tech: 'RAG pipeline + re-ranker', loop: 'awake' },
  dmn: { x: 715, y: 238, r: 30, en: 'Default mode network', name: { vi: 'Mạng mặc định', en: 'Reflection', ja: 'デフォルトモードネットワーク' }, color: '#c084fc', service: 'Reflection Engine', role: { vi: 'Hoạt động khi nghỉ, tích hợp trải nghiệm thành hiểu biết bậc cao.', en: 'Active at rest; integrates experience into higher-level understanding.', ja: '休息中に働き、経験を高次の理解へ統合する。' }, data: { vi: 'Insight cấp cao, đề xuất skill promotion', en: 'High-level insights, skill promotion proposals', ja: '高次の洞察、スキル昇格の提案' }, tech: 'Scheduled batch analysis', loop: 'sleep' },
  forgetting: { x: 830, y: 150, r: 24, en: 'Synaptic pruning', name: { vi: 'Cắt tỉa synapse', en: 'Forgetting', ja: 'シナプス刈り込み' }, color: '#fda4af', service: 'Forgetting Engine', role: { vi: 'Não chủ động loại bỏ kết nối ít dùng.', en: 'The brain actively removes rarely used connections.', ja: '脳は使われない結合を能動的に取り除く。' }, data: { vi: 'TTL, thay thế fact cũ, gắn cờ mâu thuẫn', en: 'TTL, superseding old facts, flagging conflicts', ja: 'TTL、古い事実の置き換え、矛盾のフラグ付け' }, tech: 'Scheduled cleanup job', loop: 'sleep' },
};

export const tx = (v, lang) => (v && typeof v === 'object' ? v[lang] ?? (lang === 'ja' ? v.en : undefined) ?? v.vi : v);

// Anatomical pathways drawn faintly in the background.
const PATHWAYS = [
  ['input', 'thalamus'], ['thalamus', 'brainstem'], ['brainstem', 'amygdala'], ['amygdala', 'prefrontal'], ['amygdala', 'corpus_callosum'],
  ['corpus_callosum', 'prefrontal'], ['prefrontal', 'cerebellum'], ['cerebellum', 'ras'], ['ras', 'neocortex'], ['neocortex', 'prefrontal'],
  ['ras', 'basal_ganglia'], ['basal_ganglia', 'prefrontal'], ['prefrontal', 'brainstem'], ['brainstem', 'output'], ['output', 'hippocampus'],
  ['hippocampus', 'neocortex'], ['hippocampus', 'corpus_callosum'], ['neocortex', 'forgetting'], ['forgetting', 'dmn'], ['dmn', 'cerebellum'],
  ['neocortex', 'dmn'], ['basal_ganglia', 'hippocampus'], ['amygdala', 'hippocampus'],
];

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

function curve(a, b) {
  const A = REGIONS[a];
  const B = REGIONS[b];
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(60, len * 0.18);
  const cx = mx - (dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return `M${A.x},${A.y} Q${cx},${cy} ${B.x},${B.y}`;
}

export class BrainMap {
  constructor(svg, { onSelect } = {}) {
    this.svg = svg;
    this.onSelect = onSelect;
    this.nodes = {};
    this.build();
  }

  build() {
    const svg = this.svg;
    svg.setAttribute('viewBox', '0 0 1000 660');
    const defs = el('defs', {}, svg);
    for (const [id, r] of Object.entries(REGIONS)) {
      const g = el('radialGradient', { id: `glow-${id}` }, defs);
      el('stop', { offset: '0%', 'stop-color': r.color, 'stop-opacity': '0.7' }, g);
      el('stop', { offset: '55%', 'stop-color': r.color, 'stop-opacity': '0.22' }, g);
      el('stop', { offset: '100%', 'stop-color': r.color, 'stop-opacity': '0' }, g);
    }
    const blur = el('filter', { id: 'soft', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: '6' }, blur);

    // Brain silhouette (sagittal view, frontal lobe on the left)
    const shell = el('g', { class: 'shell' }, svg);
    el('path', {
      class: 'cerebrum',
      d: 'M175,395 C120,350 118,250 160,185 C205,110 300,62 420,52 C540,40 660,55 760,100 C850,140 905,215 900,300 C896,360 868,400 820,415 C770,430 720,420 690,428 C640,440 600,450 560,440 C500,452 430,462 360,450 C290,442 225,432 175,395 Z',
    }, shell);
    el('path', { class: 'gyri', d: 'M210,200 C260,150 330,120 400,128 M300,90 C340,140 330,190 360,230 M450,70 C460,120 430,170 470,200 M560,62 C560,110 600,150 590,200 M670,80 C650,130 690,170 680,210 M770,120 C740,170 790,210 770,260 M850,210 C820,240 850,290 820,330 M200,300 C250,280 290,300 320,280 M640,360 C690,340 740,360 790,345' }, shell);
    el('path', { class: 'cerebellum-shape', d: 'M690,440 C700,400 790,395 860,420 C915,440 925,500 890,535 C850,570 760,575 712,545 C680,525 680,470 690,440 Z' }, shell);
    el('path', { class: 'gyri', d: 'M715,470 C770,455 840,460 895,480 M710,500 C770,490 840,495 900,505 M720,530 C770,525 830,530 880,530' }, shell);
    el('path', { class: 'stem-shape', d: 'M545,440 C560,470 560,520 570,560 C578,600 585,630 590,655 L640,655 C632,620 628,585 630,550 C632,510 640,470 650,440 Z' }, shell);
    el('path', { class: 'callosum-arc', d: 'M330,280 C380,215 470,200 560,210 C630,218 690,240 720,290' }, shell);

    this.pathLayer = el('g', { class: 'pathways' }, svg);
    for (const [a, b] of PATHWAYS) el('path', { d: curve(a, b), class: 'pathway', 'data-a': a, 'data-b': b }, this.pathLayer);
    this.signalLayer = el('g', { class: 'signals' }, svg);

    const nodeLayer = el('g', { class: 'nodes' }, svg);
    for (const [id, r] of Object.entries(REGIONS)) {
      const rr = Math.round(r.r * 0.78);
      const g = el('g', { class: `node node-${id}`, transform: `translate(${r.x},${r.y})`, tabindex: '0', role: 'button', 'aria-label': `${r.en} — ${tx(r.name, 'vi')}`, style: `--c:${r.color}` }, nodeLayer);
      el('circle', { class: 'halo', r: rr * 2.2, fill: `url(#glow-${id})` }, g);
      el('circle', { class: 'core', r: rr, stroke: r.color }, g);
      el('circle', { class: 'ring', r: rr + 6, stroke: r.color }, g);
      const label = el('text', { class: 'label', y: rr + 19, 'text-anchor': 'middle' }, g);
      label.textContent = r.en;
      const sub = el('text', { class: 'sublabel', y: rr + 34, 'text-anchor': 'middle' }, g);
      sub.textContent = tx(r.name, 'vi');
      const badge = el('text', { class: 'badge-txt', y: 4, 'text-anchor': 'middle' }, g);
      badge.textContent = '';
      g.addEventListener('click', () => this.onSelect && this.onSelect(id));
      g.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && this.onSelect && this.onSelect(id));
      this.nodes[id] = { g, badge, sub, count: 0 };
    }
  }

  setLang(lang) {
    for (const [id, n] of Object.entries(this.nodes)) {
      n.sub.textContent = tx(REGIONS[id].name, lang);
      n.g.setAttribute('aria-label', `${REGIONS[id].en} — ${tx(REGIONS[id].name, lang)}`);
    }
  }

  select(id) {
    for (const [k, n] of Object.entries(this.nodes)) n.g.classList.toggle('selected', k === id);
  }

  reset() {
    for (const n of Object.values(this.nodes)) {
      n.count = 0;
      n.badge.textContent = '';
      n.g.classList.remove('visited', 'active', 'st-warn', 'st-alert', 'st-hit');
    }
    this.pathLayer.querySelectorAll('.pathway.used').forEach((p) => p.classList.remove('used'));
    this.signalLayer.innerHTML = '';
  }

  setLoop(kind) {
    for (const [id, n] of Object.entries(this.nodes)) {
      const loop = REGIONS[id].loop;
      n.g.classList.toggle('dim', kind === 'sleep' ? loop === 'awake' : loop === 'sleep');
    }
  }

  // Animate one step: a signal travels from → region, then the region fires.
  fire(step, duration = 500) {
    const to = step.region;
    const from = step.from;
    const node = this.nodes[to];
    if (!node) return Promise.resolve();
    return new Promise((resolve) => {
      const travel = from && from !== to && REGIONS[from] ? this.signal(from, to, step.status, duration * 0.7) : Promise.resolve();
      travel.then(() => {
        node.count += 1;
        node.badge.textContent = node.count > 1 ? `×${node.count}` : '';
        node.g.classList.add('visited', 'active');
        node.g.classList.remove('st-warn', 'st-alert', 'st-hit');
        if (step.status && step.status !== 'ok') node.g.classList.add(`st-${step.status}`);
        setTimeout(() => node.g.classList.remove('active'), Math.max(500, duration));
        setTimeout(resolve, duration * 0.3);
      });
    });
  }

  signal(from, to, status, ms) {
    const d = curve(from, to);
    const track = el('path', { d, class: 'pathway used live' }, this.signalLayer);
    const len = track.getTotalLength();
    track.style.strokeDasharray = `${len}`;
    track.style.strokeDashoffset = `${len}`;
    const color = status === 'alert' ? '#e5484d' : status === 'warn' ? '#f5a524' : status === 'hit' ? '#30a46c' : REGIONS[to].color;
    track.style.stroke = color;
    const dot = el('circle', { r: 5, class: 'spark', fill: color }, this.signalLayer);
    const trail = el('circle', { r: 11, class: 'spark-trail', fill: color }, this.signalLayer);
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = (now) => {
        const p = Math.min(1, (now - start) / ms);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const pt = track.getPointAtLength(e * len);
        dot.setAttribute('cx', pt.x);
        dot.setAttribute('cy', pt.y);
        trail.setAttribute('cx', pt.x);
        trail.setAttribute('cy', pt.y);
        track.style.strokeDashoffset = `${len * (1 - e)}`;
        if (p < 1) requestAnimationFrame(tick);
        else {
          dot.remove();
          trail.remove();
          track.classList.remove('live');
          track.classList.add('trail');
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }
}
