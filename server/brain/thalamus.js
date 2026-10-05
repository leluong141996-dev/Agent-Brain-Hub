// Thalamus — Context Gateway. Receives every request, opens/continues the
// session and decides the route through the rest of the brain.
const SESSION_GAP_MS = 30 * 60 * 1000;

export function thalamus(B, t, { agentId, customerId, text }) {
  const agent = B.state.agents.find((a) => a.id === agentId);
  if (!agent) throw Object.assign(new Error(`agent "${agentId}" not found`), { status: 404 });
  if (!B.state.customers[customerId]) {
    B.state.customers[customerId] = { id: customerId, name: customerId, vip: false };
  }
  const wm = B.state.working[customerId];
  const now = B.clock.now();
  const newSession = !wm || !wm.sessionId || now - (wm.updatedAt || 0) > SESSION_GAP_MS;
  const switchedFrom = wm && wm.lastAgentId && wm.lastAgentId !== agentId ? wm.lastAgentId : null;

  const route = ['brainstem', 'amygdala'];
  if (switchedFrom) route.push('corpus_callosum');
  route.push('prefrontal', 'cerebellum', 'ras', 'basal_ganglia');

  t.step(
    'thalamus',
    switchedFrom ? t.L('Nhận request — phát hiện chuyển agent', 'Request received — agent switch detected', 'リクエスト受信 — エージェント切替を検知') : t.L('Nhận request & định tuyến', 'Request received & routed', 'リクエスト受信・ルーティング'),
    {
      agent: agent.name,
      customer: customerId,
      language: t.lang,
      session: newSession ? t.L('mở phiên mới', 'new session', '新規セッション') : t.L('tiếp tục phiên', 'continuing session', 'セッション継続'),
      handoff: switchedFrom ? `${B.agentName(switchedFrom)} → ${agent.name}` : null,
      route,
      chars: text.length,
    },
    { from: 'input' }
  );
  return { agent, newSession, switchedFrom };
}
