import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RustAuthority } from './rust-browser-control.mjs';
// Explicit container runner selects its packaged Linux binary; default checks stay local.
const binary = process.env.AGENTMELD_TEST_BINARY || 'target/debug/agentmeld-m0';
const action = { tool: 'fixture_sum', arguments: { a: 2, b: 3 } };
const scope = { workspace: 'fixture', worker: 'fixture', thread: 'thread', turn: 'turn', request: 'request' };
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'agentmeld-crash-'));
  const journal = join(directory, 'control.jsonl'); const owners = [];
  const open = async () => { const owner = await RustAuthority.open(binary, journal); owners.push(owner); return owner; };
  try { await run(open, journal); }
  finally { for (const owner of owners) await owner.close(); await rm(directory, { recursive: true }); }
}
async function kill(owner) {
  const exited = new Promise(resolve => owner.process.once('exit', resolve));
  assert.equal(owner.process.kill('SIGKILL'), true); await exited;
}
async function proposal(owner) {
  return owner.request({ op: 'propose', generation: owner.current.generation, action, scope, ttl_ms: 30000 });
}
async function advance(owner, boundary) {
  const proposed = await proposal(owner);
  if (boundary === 'proposed') return;
  const decision = await owner.request({ op: 'decide', approval_id: proposed.approval.id, action, scope, allow: boundary !== 'denied' });
  if (['denied', 'approved'].includes(boundary)) return;
  await owner.request({ op: 'dispatch', generation: decision.generation, actor: 'agent', ticket: decision.pending, action });
  if (boundary === 'dispatched') return;
  await owner.request({ op: 'settle', ticket: decision.pending, action });
  if (boundary === 'cancelled') await owner.request({ op: 'cancel' });
}
for (const boundary of ['proposed', 'denied', 'approved', 'dispatched', 'settled', 'cancelled']) {
  test(`SIGKILL after ${boundary} preserves the durable fence through two restarts`, async () => fixture(async open => {
    let owner = await open(); await advance(owner, boundary);
    const before = structuredClone(owner.current); await kill(owner);
    for (let restart = 1; restart <= 2; restart++) {
      owner = await open();
      const state = owner.current;
      assert.equal(state.generation, before.generation + restart);
      assert.equal(state.mode, boundary === 'cancelled' ? 'cancelled' : 'paused');
      assert.equal(state.approval, null);
      assert.equal(state.pending, before.pending);
      assert.equal(state.uncertain, before.pending !== null);
      assert.deepEqual(state.requests, before.requests);
      await assert.rejects(owner.request({ op: 'dispatch', generation: before.generation, actor: 'agent', ticket: before.pending ?? 1, action }));
      if (before.approval) await assert.rejects(owner.request({ op: 'decide', approval_id: before.approval.id, action, scope, allow: true }), /no pending/);
      if (state.uncertain) {
        await assert.rejects(owner.request({ op: 'settle', ticket: before.pending, action }), /uncertain/);
        await assert.rejects(owner.request({ op: 'takeover' }), /unavailable/);
      } else if (boundary === 'cancelled') {
        await assert.rejects(owner.request({ op: 'takeover' }), /unavailable/);
      }
      // No operation above should have changed persisted state.
      assert.deepEqual(await owner.request({ op: 'state' }), state);
      await kill(owner);
    }
  }));
}
test('recovered approval requires fresh observation and cannot reuse its request identity', async () => fixture(async open => {
  let owner = await open(); const old = await proposal(owner); await kill(owner); owner = await open();
  const human = await owner.request({ op: 'takeover' });
  await owner.request({ op: 'human_ready', generation: human.generation });
  const resuming = await owner.request({ op: 'resume', generation: human.generation });
  await assert.rejects(proposal(owner), /stale/);
  await owner.request({ op: 'observed', generation: resuming.generation, digest: 'a'.repeat(64) });
  await assert.rejects(proposal(owner), /duplicate/);
  await assert.rejects(owner.request({ op: 'decide', approval_id: old.approval.id, action, scope, allow: true }), /no pending/);
  const fresh = await owner.request({ op: 'propose', generation: owner.current.generation, action, scope: { ...scope, request: 'fresh' }, ttl_ms: 30000 });
  assert.equal(fresh.mode, 'awaiting_approval');
}));
const corruptions = {
  'invalid pending digest': s => { s.approval = null; s.mode = 'agent'; s.pending = s.sequence; s.pending_digest = 'z'.repeat(64); },
  'invalid observation digest': s => { s.observation = 'not-a-digest'; },
  'invalid decision': s => { s.decision = 'approved'; },
  'invalid approval digest': s => { s.approval.digest = 'z'.repeat(64); },
  'empty approval scope': s => { s.approval.scope.worker = ''; },
  'unrecorded approval scope': s => { s.approval.scope.request = 'unrecorded'; },
};
for (const [name, corrupt] of Object.entries(corruptions)) {
  test(`recovery rejects ${name} without modifying evidence`, async () => fixture(async (open, journal) => {
    const owner = await open(); await proposal(owner); await owner.close();
    const lines = (await readFile(journal, 'utf8')).trimEnd().split('\n').map(JSON.parse);
    corrupt(lines.at(-1)); const evidence = lines.map(s => JSON.stringify(s)).join('\n') + '\n';
    await writeFile(journal, evidence);
    await assert.rejects(open(), /exited/);
    assert.equal(await readFile(journal, 'utf8'), evidence);
  }));
}
for (const irreversible of ['cancelled', 'uncertain']) {
  test(`journal cannot clear ${irreversible} in a later snapshot`, async () => fixture(async (open, journal) => {
    let owner = await open(); await advance(owner, irreversible === 'cancelled' ? 'cancelled' : 'dispatched');
    if (irreversible === 'uncertain') { await kill(owner); owner = await open(); }
    await owner.close();
    const text = await readFile(journal, 'utf8');
    const next = JSON.parse(text.trimEnd().split('\n').at(-1)); next.sequence++;
    if (irreversible === 'cancelled') next.mode = 'agent'; else next.uncertain = false;
    const evidence = text + JSON.stringify(next) + '\n'; await writeFile(journal, evidence);
    await assert.rejects(open(), /exited/); assert.equal(await readFile(journal, 'utf8'), evidence);
  }));
}
test('torn final records are preserved and never repaired automatically', async () => fixture(async (open, journal) => {
  const owner = await open(); await proposal(owner); await owner.close();
  const text = await readFile(journal, 'utf8');
  const start = text.lastIndexOf('\n', text.length - 2) + 1;
  const final = text.slice(start);
  for (const bytes of [1, Math.floor(final.length / 2), final.length - 2, final.length - 1]) {
    const evidence = text.slice(0, start) + final.slice(0, bytes);
    await writeFile(journal, evidence);
    await assert.rejects(open(), /exited/);
    assert.equal(await readFile(journal, 'utf8'), evidence);
  }
}));
