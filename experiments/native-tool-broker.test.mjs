import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RustAuthority } from './rust-browser-control.mjs';
import { NativeToolBroker, normalizeCodexCall } from './native-tool-broker.mjs';
const expected = { workspace: 'workspace', worker: 'worker', thread: 'thread', turn: 'turn' };
const frame = () => ({ id: 7, method: 'item/tool/call', params: { threadId: 'thread', turnId: 'turn', callId: 'call', tool: 'fixture_sum', arguments: { a: 2, b: 3 } } });
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'agentmeld-approvals-')); const owners = [];
  const open = async () => { const owner = await RustAuthority.open('target/debug/agentmeld-m0', join(directory, 'journal')); owners.push(owner); return owner; };
  try { await run(open); } finally { for (const owner of owners) await owner.close(); await rm(directory, { recursive: true }); }
}
test('Codex adapter rejects foreign context, built-in callbacks and malformed arguments', () => {
  for (const change of [ { method: 'item/commandExecution/requestApproval' }, { id: Infinity }, { id: '' }, { id: 'x'.repeat(257) } ]) assert.throws(() => normalizeCodexCall({ ...frame(), ...change }, expected));
  for (const change of [ { threadId: 'other' }, { turnId: 'other' }, { namespace: 'other' }, { tool: 'shell' }, { callId: '' }, { arguments: { a: 2, b: 3, command: 'shell' } }, { arguments: { a: Number.MAX_SAFE_INTEGER, b: 1 } } ]) assert.throws(() => normalizeCodexCall({ ...frame(), params: { ...frame().params, ...change } }, expected));
});
test('durable approval binds every scope field and payload before one-time dispatch', async () => fixture(async open => {
  const owner = await open(); const { scope, action } = normalizeCodexCall(frame(), expected);
  const proposed = await owner.request({ op: 'propose', generation: 0, scope, action, ttl_ms: 30000 });
  const decision = { op: 'decide', approval_id: proposed.approval.id, scope, action, allow: true };
  for (const key of Object.keys(scope)) await assert.rejects(owner.request({ ...decision, scope: { ...scope, [key]: 'other' } }), /binding/);
  await assert.rejects(owner.request({ ...decision, action: { ...action, arguments: { a: 9, b: 3 } } }), /binding/);
  await assert.rejects(owner.request({ op: 'admit', actor: 'agent', generation: 0, action }), /stale/);
  const allowed = await owner.request(decision); assert.equal(allowed.decision, 'allow');
  await assert.rejects(owner.request(decision), /no pending/);
  const dispatch = { op: 'dispatch', actor: 'agent', generation: 0, ticket: allowed.pending, action };
  await owner.request(dispatch); await assert.rejects(owner.request(dispatch), /mismatch/);
  await owner.request({ op: 'settle', ticket: allowed.pending, action });
}));
test('denied and expired approvals execute no tool and cannot be replayed', async () => fixture(async open => {
  const owner = await open(); let calls = 0;
  const broker = new NativeToolBroker(owner, { request: async () => { calls++; } }, expected);
  const proposed = await broker.propose(frame()); assert.equal((await broker.decide(proposed.id, false)).success, false);
  await assert.rejects(broker.propose(frame()), /duplicate/);
  const next = { ...frame(), id: 8 }; const expired = await broker.propose(next, 1); await delay(10);
  const result = await broker.decide(expired.id, true); assert.match(result.contentItems[0].text, /expired/);
  assert.equal(owner.current.pending, null); assert.equal(calls, 0);
}));
test('restart, takeover, cancellation and disconnect revoke pending approval', async () => {
  for (const operation of ['restart', 'takeover', 'cancel', 'disconnect']) await fixture(async open => {
    const owner = await open(); const { scope, action } = normalizeCodexCall(frame(), expected);
    const state = await owner.request({ op: 'propose', generation: 0, scope, action, ttl_ms: 30000 });
    let current = owner;
    if (operation === 'restart') { await owner.close(); current = await open(); } else await owner.request({ op: operation });
    assert.equal(current.current.approval, null);
    await assert.rejects(current.request({ op: 'decide', approval_id: state.approval.id, scope, action, allow: true }), /no pending/);
  });
});
test('native broker executes exact approved arguments once and rejects concurrent proposals', async () => fixture(async open => {
  const owner = await open(); const calls = [];
  const broker = new NativeToolBroker(owner, { request: async (...args) => { calls.push(args); return { sum: 5 }; } }, expected);
  const first = broker.propose(frame()); await assert.rejects(broker.propose({ ...frame(), id: 8 }), /pending/);
  const proposal = await first; assert.equal((await broker.decide(proposal.id, true)).success, true);
  assert.deepEqual(calls, [['fixture_sum', { a: 2, b: 3 }]]); assert.equal(owner.current.pending, null);
  await assert.rejects(broker.decide(proposal.id, true), /unknown/);
}));
test('lost tool result pauses authority and recovers as uncertain without retry', async () => fixture(async open => {
  const owner = await open(); let calls = 0;
  const broker = new NativeToolBroker(owner, { request: async () => { calls++; throw new Error('transport lost'); } }, expected);
  const proposal = await broker.propose(frame()); assert.equal((await broker.decide(proposal.id, true)).success, false);
  assert.equal(owner.current.mode, 'paused'); assert.equal(owner.current.dispatched, true);
  await owner.close(); const recovered = await open(); assert.equal(recovered.current.uncertain, true); assert.equal(calls, 1);
}));
test('unexpected tool output cannot enter the native response or settle the ticket', async () => fixture(async open => {
  const owner = await open();
  const broker = new NativeToolBroker(owner, { request: async () => ({ sum: 5, unexpected: 'untrusted content' }) }, expected);
  const proposal = await broker.propose(frame()); const response = await broker.decide(proposal.id, true);
  assert.equal(response.success, false); assert.equal(JSON.stringify(response).includes('untrusted content'), false);
  assert.equal(owner.current.mode, 'paused'); assert.notEqual(owner.current.pending, null);
}));
