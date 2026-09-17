// Trusted host adapter. Native callbacks never receive the supervisor/admin interface.
export function normalizeCodexCall(frame, expected) {
  const params = frame?.params;
  if (frame?.method !== 'item/tool/call' || !['string', 'number'].includes(typeof frame.id) || (typeof frame.id === 'number' && !Number.isSafeInteger(frame.id)) || (typeof frame.id === 'string' && (!frame.id || frame.id.length > 128)) || !params || params.threadId !== expected.thread || params.turnId !== expected.turn || params.namespace != null || params.tool !== 'fixture_sum' || typeof params.callId !== 'string' || !params.callId || params.callId.length > 256) throw new Error('unsupported or unbound Codex request');
  const args = params.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).sort().join(',') !== 'a,b' || !Number.isSafeInteger(args.a) || !Number.isSafeInteger(args.b) || !Number.isSafeInteger(args.a + args.b)) throw new Error('invalid fixture arguments');
  const scope = { workspace: expected.workspace, worker: expected.worker, thread: expected.thread, turn: expected.turn, request: JSON.stringify([frame.id, params.callId]) };
  const action = { provider: 'codex', tool: 'fixture_sum', target: expected.worker, arguments: { a: args.a, b: args.b } };
  return { scope, action };
}
export class NativeToolBroker {
  constructor(authority, computer, expected) { this.authority = authority; this.computer = computer; this.expected = Object.freeze({ ...expected }); this.seen = new Set(); this.pending = null; }
  async propose(frame, ttlMs = 30000) {
    if (this.pending) throw new Error('approval already pending');
    const normalized = normalizeCodexCall(frame, this.expected);
    if (this.seen.size >= 128 || this.seen.has(normalized.scope.request)) throw new Error('duplicate or over-budget request');
    this.seen.add(normalized.scope.request);
    // Reserve synchronously so concurrent callbacks cannot overwrite the pending approval.
    const pending = { ...normalized, generation: this.authority.current.generation };
    this.pending = pending;
    try {
      const state = await this.authority.request({ op: 'propose', generation: pending.generation, action: pending.action, scope: pending.scope, ttl_ms: ttlMs });
      pending.id = state.approval.id;
      return { id: pending.id, tool: pending.action.tool, arguments: { ...pending.action.arguments }, scope: { ...pending.scope } };
    } catch (error) { if (this.pending === pending) this.pending = null; throw error; }
  }
  async decide(id, allow) {
    const pending = this.pending;
    if (!pending || pending.id === undefined || pending.id !== id || typeof allow !== 'boolean') throw new Error('unknown approval');
    this.pending = null; // One review attempt; never retry uncertain execution automatically.
    const failed = reason => ({ success: false, contentItems: [{ type: 'inputText', text: reason }] });
    try {
      const decision = await this.authority.request({ op: 'decide', approval_id: id, action: pending.action, scope: pending.scope, allow });
      if (decision.decision !== 'allow') return failed(`Tool ${decision.decision}`);
      await this.authority.request({ op: 'dispatch', actor: 'agent', generation: pending.generation, ticket: decision.pending, action: pending.action });
      const value = await this.computer.request('fixture_sum', pending.action.arguments);
      if (!value || Object.keys(value).join(',') !== 'sum' || value.sum !== pending.action.arguments.a + pending.action.arguments.b) throw new Error('invalid tool result');
      await this.authority.request({ op: 'settle', ticket: decision.pending, action: pending.action });
      return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(value) }] };
    } catch {
      await this.authority.request({ op: 'disconnect' }).catch(() => {});
      return failed('Tool denied or outcome uncertain');
    }
  }
}
