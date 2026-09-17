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
  const broker = new NativeToolBroker(owner, { request: async () => { calls++; } }, expected, ['fixture_sum']);
  const proposed = await broker.propose(frame()); assert.equal((await broker.decide(proposed.id, false)).success, false);
  await assert.rejects(broker.propose(frame()), /duplicate/);
  const next = { ...frame(), id: 8, params: { ...frame().params, callId: 'next-call' } }; const expired = await broker.propose(next, 1); await delay(10);
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
  const broker = new NativeToolBroker(owner, { request: async (...args) => { calls.push(args); return { sum: 5 }; } }, expected, ['fixture_sum']);
  const first = broker.propose(frame()); await assert.rejects(broker.propose({ ...frame(), id: 8 }), /pending/);
  const proposal = await first; assert.equal((await broker.decide(proposal.id, true)).success, true);
  assert.deepEqual(calls, [['fixture_sum', { a: 2, b: 3 }]]); assert.equal(owner.current.pending, null);
  await assert.rejects(broker.decide(proposal.id, true), /unknown/);
}));
test('lost tool result pauses authority and recovers as uncertain without retry', async () => fixture(async open => {
  const owner = await open(); let calls = 0;
  const broker = new NativeToolBroker(owner, { request: async () => { calls++; throw new Error('transport lost'); } }, expected, ['fixture_sum']);
  const proposal = await broker.propose(frame()); assert.equal((await broker.decide(proposal.id, true)).success, false);
  assert.equal(owner.current.mode, 'paused'); assert.equal(owner.current.dispatched, true);
  await owner.close(); const recovered = await open(); assert.equal(recovered.current.uncertain, true); assert.equal(calls, 1);
}));
test('unexpected tool output cannot enter the native response or settle the ticket', async () => fixture(async open => {
  const owner = await open();
  const broker = new NativeToolBroker(owner, { request: async () => ({ sum: 5, unexpected: 'untrusted content' }) }, expected, ['fixture_sum']);
  const proposal = await broker.propose(frame()); const response = await broker.decide(proposal.id, true);
  assert.equal(response.success, false); assert.equal(JSON.stringify(response).includes('untrusted content'), false);
  assert.equal(owner.current.mode, 'paused'); assert.notEqual(owner.current.pending, null);
}));
test('request identity survives broker replacement, transport ID changes and supervisor restart', async () => fixture(async open => {
  let owner = await open(); const computer = { request: async () => ({ sum: 5 }) };
  let broker = new NativeToolBroker(owner, computer, expected, ['fixture_sum']);
  const proposed = await broker.propose(frame()); await broker.decide(proposed.id, false);
  broker = new NativeToolBroker(owner, computer, expected, ['fixture_sum']);
  await assert.rejects(broker.propose({ ...frame(), id: 900 }), /duplicate/);
  await owner.close(); owner = await open();
  const human = await owner.request({ op: 'takeover' });
  await owner.request({ op: 'human_ready', generation: human.generation });
  const resumed = await owner.request({ op: 'resume', generation: human.generation });
  await owner.request({ op: 'observed', generation: resumed.generation, digest: 'a'.repeat(64) });
  broker = new NativeToolBroker(owner, computer, expected, ['fixture_sum']);
  await assert.rejects(broker.propose({ ...frame(), id: 901 }), /duplicate/);
  const next = { ...frame(), params: { ...frame().params, callId: 'new-call' } };
  const allowed = await broker.propose(next); assert.equal((await broker.decide(allowed.id, true)).success, true);
}));
test('durable request ledger fails closed at capacity without dropping old identities', async () => fixture(async open => {
  const owner = await open(); const { scope, action } = normalizeCodexCall(frame(), expected);
  for (let index = 0; index < 256; index++) {
    const unique = { ...scope, request: String(index) };
    const proposed = await owner.request({ op: 'propose', generation: 0, scope: unique, action, ttl_ms: 30000 });
    await owner.request({ op: 'decide', approval_id: proposed.approval.id, scope: unique, action, allow: false });
  }
  assert.equal(owner.current.requests.length, 256);
  for (const request of ['0', 'overflow']) await assert.rejects(owner.request({ op: 'propose', generation: 0, scope: { ...scope, request }, action, ttl_ms: 30000 }), /ledger/);
  assert.equal(owner.current.requests.length, 256);
}));
test('workspace listing requires an explicit grant before proposing and validates its result', async () => fixture(async open => {
  const owner = await open(); const call = { ...frame(), params: { ...frame().params, tool: 'workspace_list', arguments: {} } };
  const computer = { request: async (tool, args) => { assert.equal(tool, 'workspace_list'); assert.deepEqual(args, {}); return { entries: ['fixture.txt'] }; } };
  const denied = new NativeToolBroker(owner, computer, expected);
  await assert.rejects(denied.propose(call), /grant/); assert.equal(owner.current.approval, null);
  const allowed = new NativeToolBroker(owner, computer, expected, ['workspace_list']);
  const proposal = await allowed.propose(call); assert.equal((await allowed.decide(proposal.id, true)).success, true);
}));
test('grant revocation after review prevents dispatch and clears an unused ticket', async () => fixture(async open => {
  const owner = await open(); let revoked = false; let executions = 0;
  const computer = { authorize: () => { if (revoked) throw new Error('grant revoked'); }, request: async () => { executions++; } };
  const broker = new NativeToolBroker(owner, computer, expected, ['fixture_sum']);
  const proposal = await broker.propose(frame()); revoked = true;
  assert.equal((await broker.decide(proposal.id, true)).success, false);
  assert.equal(executions, 0); assert.equal(owner.current.pending, null); assert.equal(owner.current.mode, 'paused');
}));
test('workspace text requires a grant and exact filename approval before any read', async () => fixture(async open => {
  const { createHash } = await import('node:crypto');
  const owner = await open(); let reads = 0;
  const call = { ...frame(), params: { ...frame().params, tool: 'workspace_read', arguments: { name: 'fixture.txt' } } };
  const text = 'synthetic text';
  const computer = { request: async (tool, args) => {
    reads++; assert.equal(tool, 'workspace_read'); assert.deepEqual(args, { name: 'fixture.txt' });
    return { name: args.name, text, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') };
  } };
  await assert.rejects(new NativeToolBroker(owner, computer, expected).propose(call), /grant/);
  assert.equal(owner.current.approval, null);
  const broker = new NativeToolBroker(owner, computer, expected, ['workspace_read']);
  const denied = await broker.propose(call);
  assert.equal((await broker.decide(denied.id, false)).success, false); assert.equal(reads, 0);
  const next = { ...call, params: { ...call.params, callId: 'new-read' } };
  const proposal = await broker.propose(next);
  const { action, scope } = normalizeCodexCall(next, expected);
  await assert.rejects(owner.request({ op: 'decide', approval_id: proposal.id, action: { ...action, arguments: { name: 'other.txt' } }, scope, allow: true }), /binding/);
  assert.equal(reads, 0);
  const result = await broker.decide(proposal.id, true);
  assert.equal(result.success, true); assert.equal(JSON.parse(result.contentItems[0].text).text, text);
  assert.equal(reads, 1); assert.equal(owner.current.pending, null);
}));
test('invalid workspace text digest is withheld and leaves the action unsettled', async () => fixture(async open => {
  const owner = await open();
  const call = { ...frame(), params: { ...frame().params, tool: 'workspace_read', arguments: { name: 'fixture.txt' } } };
  const broker = new NativeToolBroker(owner, { request: async () => ({ name: 'fixture.txt', text: 'must not be returned', bytes: 20, sha256: 'a'.repeat(64) }) }, expected, ['workspace_read']);
  const proposal = await broker.propose(call); const result = await broker.decide(proposal.id, true);
  assert.equal(result.success, false); assert.equal(JSON.stringify(result).includes('must not be returned'), false);
  assert.equal(owner.current.mode, 'paused'); assert.notEqual(owner.current.pending, null);
}));
