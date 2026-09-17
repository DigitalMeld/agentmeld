import { normalizeArguments, validateResult, toolSchemas } from './tool-contract.mjs';
// Trusted host adapter. Native callbacks never receive the supervisor/admin interface.
export function normalizeCodexCall(frame, expected) {
  const params = frame?.params;
  if (frame?.method !== 'item/tool/call' || !['string', 'number'].includes(typeof frame.id) || (typeof frame.id === 'number' && !Number.isSafeInteger(frame.id)) || (typeof frame.id === 'string' && (!frame.id || frame.id.length > 128)) || !params || params.threadId !== expected.thread || params.turnId !== expected.turn || params.namespace != null || !Object.hasOwn(toolSchemas, params.tool) || typeof params.callId !== 'string' || !params.callId || params.callId.length > 256) throw new Error('unsupported or unbound Codex request');
  const args = normalizeArguments(params.tool, params.arguments);
  const scope = { workspace: expected.workspace, worker: expected.worker, thread: expected.thread, turn: expected.turn, request: params.callId };
  const action = { provider: 'codex', tool: params.tool, target: expected.worker, arguments: args };
  return { scope, action };
}
export class NativeToolBroker {
  constructor(authority, computer, expected, tools = [], archive = null) { this.archive = archive; this.lastResult = null; this.authority = authority; this.computer = computer; this.expected = Object.freeze({ ...expected }); this.seen = new Set(); this.pending = null; this.tools = new Set(tools); }
  authorize(action, scope) {
    if (!this.tools.has(action.tool)) throw new Error('tool grant denied');
    this.computer.authorize?.(action.tool, scope);
  }
  async propose(frame, ttlMs = 30000) {
    if (this.pending) throw new Error('approval already pending');
    const normalized = normalizeCodexCall(frame, this.expected);
    this.authorize(normalized.action, normalized.scope);
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
    this.lastResult = null;
    const failed = reason => ({ success: false, contentItems: [{ type: 'inputText', text: reason }] });
    try {
      const decision = await this.authority.request({ op: 'decide', approval_id: id, action: pending.action, scope: pending.scope, allow });
      if (decision.decision !== 'allow') return failed(`Tool ${decision.decision}`);
      this.authorize(pending.action, pending.scope);
      await this.authority.request({ op: 'dispatch', actor: 'agent', generation: pending.generation, ticket: decision.pending, action: pending.action });
      const value = validateResult(pending.action.tool, pending.action.arguments, await this.computer.request(pending.action.tool, pending.action.arguments));
      const receipt = this.archive ? await this.archive.put({ scope: pending.scope, action: pending.action, ticket: decision.pending, value }) : null;
      await this.authority.request({ op: 'settle', ticket: decision.pending, action: pending.action });
      this.lastResult = receipt;
      return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(value) }] };
    } catch {
      await this.authority.request({ op: 'disconnect' }).catch(() => {});
      return failed('Tool denied or outcome uncertain');
    }
  }
}
