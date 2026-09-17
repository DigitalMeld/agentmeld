import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RustAuthority } from './rust-browser-control.mjs';
import { ResultArchive } from './result-archive.mjs';
import { NativeToolBroker } from './native-tool-broker.mjs';
const binary = process.env.AGENTMELD_TEST_BINARY || 'target/debug/agentmeld-m0';
const scope = { workspace: 'workspace', worker: 'worker', thread: 'thread', turn: 'turn', request: 'call' };
const action = { provider: 'codex', tool: 'fixture_sum', target: 'worker', arguments: { a: 2, b: 3 } };
const frame = { id: 1, method: 'item/tool/call', params: { threadId: 'thread', turnId: 'turn', callId: 'call', tool: 'fixture_sum', arguments: action.arguments } };
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'agentmeld-settled-')); const owners = [];
  const journal = join(root, 'journal');
  const open = async () => { const owner = await RustAuthority.open(binary, journal); owners.push(owner); return owner; };
  try { await run(open, new ResultArchive(binary, join(root, 'results')), journal); }
  finally { for (const owner of owners) await owner.close(); await rm(root, { recursive: true }); }
}
async function kill(owner) {
  const exited = new Promise(resolve => owner.process.once('exit', resolve)); owner.process.kill('SIGKILL'); await exited;
}
async function dispatch(owner, requested = scope) {
  const proposed = await owner.request({ op: 'propose', generation: owner.current.generation, action, scope: requested, ttl_ms: 30000, result_required: true });
  const allowed = await owner.request({ op: 'decide', approval_id: proposed.approval.id, action, scope: requested, allow: true });
  await owner.request({ op: 'dispatch', actor: 'agent', generation: allowed.generation, ticket: allowed.pending, action });
  return allowed.pending;
}
test('settled result is discoverable by scope after supervisor SIGKILL without a cached receipt', async () => fixture(async (open, archive) => {
  let owner = await open(); const broker = new NativeToolBroker(owner, { request: async () => ({ sum: 5 }) }, scope, ['fixture_sum'], archive);
  const proposal = await broker.propose(frame); assert.equal((await broker.decide(proposal.id, true)).success, true);
  assert.equal(owner.current.results.length, 1); await kill(owner); owner = await open();
  assert.equal(owner.current.mode, 'paused'); assert.equal(owner.current.pending, null);
  assert.deepEqual((await archive.readSettled(owner, scope)).value, { sum: 5 });
  for (const key of Object.keys(scope)) await assert.rejects(archive.readSettled(owner, { ...scope, [key]: 'other' }), /no settled/);
}));
test('required result cannot be omitted or malformed and rejection leaves dispatch pending', async () => fixture(async open => {
  const owner = await open(); const ticket = await dispatch(owner); const before = structuredClone(owner.current);
  for (const result of [undefined, { sha256: 'bad', bytes: 1 }, { sha256: 'a'.repeat(64), bytes: 0 }, { sha256: 'a'.repeat(64), bytes: 524289 }, { sha256: 'A'.repeat(64), bytes: 1 }]) {
    await assert.rejects(owner.request({ op: 'settle', ticket, action, ...(result ? { result } : {}) }));
    assert.deepEqual(owner.current, before);
  }
}));
test('archived but unsettled output stays unavailable through settled retrieval after crash', async () => fixture(async (open, archive) => {
  let owner = await open(); const ticket = await dispatch(owner);
  const receipt = await archive.put({ scope, action, ticket, value: { sum: 5 } });
  await kill(owner); owner = await open(); assert.equal(owner.current.uncertain, true);
  await assert.rejects(archive.readSettled(owner, scope), /no settled/);
  assert.deepEqual((await archive.read(receipt, scope)).value, { sum: 5 });
  await assert.rejects(owner.request({ op: 'settle', ticket, action, result: receipt }), /uncertain/);
}));
test('lost settlement acknowledgement is recovered from the journal without rerunning the tool', async () => fixture(async (open, archive) => {
  let owner = await open(); let executions = 0;
  const bridge = { get current() { return owner.current; }, request: async command => {
    const state = await owner.request(command); if (command.op === 'settle') throw new Error('lost acknowledgement'); return state;
  } };
  const broker = new NativeToolBroker(bridge, { request: async () => { executions++; return { sum: 5 }; } }, scope, ['fixture_sum'], archive);
  const proposal = await broker.propose(frame); assert.equal((await broker.decide(proposal.id, true)).success, false);
  assert.equal(broker.lastResult, null); await kill(owner); owner = await open();
  assert.deepEqual((await archive.readSettled(owner, scope)).value, { sum: 5 }); assert.equal(executions, 1);
}));
test('result history cannot be removed, rewritten or appended without settlement; format 4 stays untouched', async () => fixture(async (open, archive, journal) => {
  const owner = await open(); const ticket = await dispatch(owner);
  const receipt = await archive.put({ scope, action, ticket, value: { sum: 5 } });
  await owner.request({ op: 'settle', ticket, action, result: receipt }); await owner.close();
  const original = await readFile(journal, 'utf8'); const lines = original.trimEnd().split('\n').map(JSON.parse);
  for (const modify of [s => { s.results = []; }, s => { s.results[0].result.sha256 = 'b'.repeat(64); }, s => { s.results.push(s.results[0]); }]) {
    const next = structuredClone(lines.at(-1)); next.sequence++; modify(next);
    const evidence = original + JSON.stringify(next) + '\n'; await writeFile(journal, evidence);
    await assert.rejects(open(), /exited/); assert.equal(await readFile(journal, 'utf8'), evidence);
  }
  const old = lines.map(state => { const value = { ...state, version: 4 }; delete value.results; delete value.pending_scope; delete value.result_required; if (value.approval) delete value.approval.result_required; return JSON.stringify(value); }).join('\n') + '\n';
  await writeFile(journal, old); await assert.rejects(open(), /exited/); assert.equal(await readFile(journal, 'utf8'), old);
}));
test('bounded result index stops new proposals without evicting history', async () => fixture(async open => {
  const owner = await open(); const result = { sha256: 'a'.repeat(64), bytes: 1 };
  for (let index = 0; index < 64; index++) {
    const ticket = await dispatch(owner, { ...scope, request: String(index) });
    await owner.request({ op: 'settle', ticket, action, result });
  }
  assert.equal(owner.current.results.length, 64);
  assert.ok(Buffer.byteLength(JSON.stringify(owner.current)) < 65536);
  await assert.rejects(dispatch(owner, { ...scope, request: 'overflow' }), /proposal/);
  assert.equal(owner.current.results.length, 64);
  await kill(owner); const recovered = await open(); assert.equal(recovered.current.results.length, 64);
}));
test('settled retrieval rejects an archive with a different action or ticket', async () => {
  for (const mismatch of ['ticket', 'action']) await fixture(async (open, archive) => {
    const owner = await open(); const ticket = await dispatch(owner);
    const wrong = mismatch === 'ticket' ? { ticket: ticket + 1, action, value: { sum: 5 } } : { ticket, action: { ...action, arguments: { a: 3, b: 3 } }, value: { sum: 6 } };
    const receipt = await archive.put({ scope, ...wrong });
    await owner.request({ op: 'settle', ticket, action, result: receipt });
    await assert.rejects(archive.readSettled(owner, scope), /binding mismatch/);
  });
});
