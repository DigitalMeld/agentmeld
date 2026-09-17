import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResultArchive } from './result-archive.mjs';
import { RustAuthority } from './rust-browser-control.mjs';
import { NativeToolBroker } from './native-tool-broker.mjs';
const binary = process.env.AGENTMELD_TEST_BINARY || 'target/debug/agentmeld-m0';
const scope = { workspace: 'workspace', worker: 'worker', thread: 'thread', turn: 'turn', request: 'call' };
const action = { provider: 'codex', tool: 'fixture_sum', target: 'worker', arguments: { a: 2, b: 3 } };
const record = { scope, action, ticket: 4, value: { sum: 5 } };
const frame = { id: 1, method: 'item/tool/call', params: { threadId: 'thread', turnId: 'turn', callId: 'call', tool: 'fixture_sum', arguments: { a: 2, b: 3 } } };
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'agentmeld-result-')); let authority;
  try {
    authority = await RustAuthority.open(binary, join(root, 'journal'));
    await run(new ResultArchive(binary, join(root, 'results')), authority, root);
  } finally { await authority?.close(); await rm(root, { recursive: true }); }
}
test('archive survives client replacement and binds readback to every scope field', async () => fixture(async (archive, authority, root) => {
  const receipt = await archive.put(record); const reopened = new ResultArchive(binary, join(root, 'results'));
  assert.deepEqual(await reopened.read(receipt, scope), { version: 1, ...record });
  for (const key of Object.keys(scope)) await assert.rejects(reopened.read(receipt, { ...scope, [key]: 'other' }), /scope/);
  assert.deepEqual(await archive.put(record), receipt);
  assert.equal((await readdir(join(root, 'results'))).length, 2);
  await writeFile(join(root, 'results', receipt.sha256), 'corrupted');
  await assert.rejects(reopened.read(receipt, scope), /unavailable/);
  await assert.rejects(reopened.put(record), /unavailable/);
}));
test('broker archives validated output before settlement and exposes a readback receipt', async () => fixture(async (archive, authority) => {
  const broker = new NativeToolBroker(authority, { request: async () => ({ sum: 5 }) }, scope, ['fixture_sum'], archive);
  const proposal = await broker.propose(frame); const response = await broker.decide(proposal.id, true);
  assert.equal(response.success, true); assert.equal(authority.current.pending, null);
  const stored = await archive.read(broker.lastResult, scope); assert.deepEqual(stored.value, { sum: 5 });
  assert.deepEqual(stored.action, action);
  const next = await broker.propose({ ...frame, params: { ...frame.params, callId: 'denied-next' } });
  await broker.decide(next.id, false); assert.equal(broker.lastResult, null);
}));
test('archive failure withholds success and preserves an unsettled dispatch', async () => fixture(async (archive, authority) => {
  const broker = new NativeToolBroker(authority, { request: async () => ({ sum: 5 }) }, scope, ['fixture_sum'], { put: async () => { throw new Error('disk full'); } });
  const proposal = await broker.propose(frame); assert.equal((await broker.decide(proposal.id, true)).success, false);
  assert.equal(broker.lastResult, null); assert.equal(authority.current.dispatched, true); assert.equal(authority.current.mode, 'paused');
}));
test('saved result with lost settlement remains evidence rather than completion', async () => fixture(async (archive, authority) => {
  let receipt;
  const bridge = { get current() { return authority.current; }, request: command => command.op === 'settle' ? Promise.reject(new Error('lost settlement')) : authority.request(command) };
  const broker = new NativeToolBroker(bridge, { request: async () => ({ sum: 5 }) }, scope, ['fixture_sum'], { put: async record => { receipt = await archive.put(record); return receipt; } });
  const proposal = await broker.propose(frame); assert.equal((await broker.decide(proposal.id, true)).success, false);
  assert.equal(broker.lastResult, null); assert.notEqual(authority.current.pending, null);
  assert.deepEqual((await archive.read(receipt, scope)).value, { sum: 5 });
}));
test('denial and invalid output create no archived result', async () => fixture(async (archive, authority, root) => {
  const broker = new NativeToolBroker(authority, { request: async () => ({ sum: 99 }) }, scope, ['fixture_sum'], archive);
  const denied = await broker.propose(frame); await broker.decide(denied.id, false);
  const next = await broker.propose({ ...frame, params: { ...frame.params, callId: 'next' } });
  assert.equal((await broker.decide(next.id, true)).success, false);
  await assert.rejects(readdir(join(root, 'results')), { code: 'ENOENT' });
}));

test('settled retrieval retains the requested scope while awaiting journal readback', async () => fixture(async (archive, authority) => {
  const broker = new NativeToolBroker(authority, { request: async () => ({ sum: 5 }) }, scope, ['fixture_sum'], archive);
  const proposal = await broker.propose(frame); await broker.decide(proposal.id, true);
  const requested = { ...scope };
  const bridge = { request: async command => { requested.request = 'mutated'; return authority.request(command); } };
  assert.deepEqual((await archive.readSettled(bridge, requested)).value, { sum: 5 });
}));
