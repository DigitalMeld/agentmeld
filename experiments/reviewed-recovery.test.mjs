import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RustAuthority } from './rust-browser-control.mjs';
import { ResultArchive } from './result-archive.mjs';
import { assessRecovery } from './recovery-assessment.mjs';
import { prepareRecoveryReview, commitRecoveryReview } from './reviewed-recovery.mjs';
const binary = process.env.AGENTMELD_TEST_BINARY || 'target/debug/agentmeld-m0';
const scope = { workspace: 'fixture', worker: 'a'.repeat(64), thread: 'thread', turn: 'turn', request: 'call' };
const action = { provider: 'codex', tool: 'fixture_sum', target: scope.worker, arguments: { a: 2, b: 3 } };
const worker = { observeTermination: async expected => { assert.equal(expected.worker, scope.worker); return { worker: scope.worker, state: 'absent' }; } };
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'agentmeld-reviewed-')); const journal = join(root, 'journal'); const owners = [];
  const open = async () => { const owner = await RustAuthority.open(binary, journal); owners.push(owner); return owner; };
  try { await run({ open, journal, root, archive: new ResultArchive(binary, join(root, 'archive')) }); }
  finally { for (const owner of owners) await owner.close(); await rm(root, { recursive: true }); }
}
async function kill(owner) { const exit = new Promise(resolve => owner.process.once('exit', resolve)); owner.process.kill('SIGKILL'); await exit; }
async function dispatch(owner, requested = scope, send = true) {
  const proposed = await owner.request({ op: 'propose', generation: owner.current.generation, action, scope: requested, ttl_ms: 30000, result_required: true });
  const allowed = await owner.request({ op: 'decide', approval_id: proposed.approval.id, action, scope: requested, allow: true });
  if (send) await owner.request({ op: 'dispatch', actor: 'agent', generation: allowed.generation, ticket: allowed.pending, action });
  return allowed.pending;
}
async function resume(owner) {
  const human = await owner.request({ op: 'takeover' });
  await owner.request({ op: 'human_ready', generation: human.generation });
  const resuming = await owner.request({ op: 'resume', generation: human.generation });
  await owner.request({ op: 'observed', generation: resuming.generation, digest: 'b'.repeat(64) });
}
const save = (archive, ticket, requested = scope) => archive.put({ scope: requested, action, ticket, value: { sum: 5 } });
const prepare = (owner, archive, request, outcome = 'accept_output') => prepareRecoveryReview(owner, archive, worker, { request, action, outcome, reviewer: 'fixture-reviewer' });
const raw = (owner, ticket, result = null) => ({ op: 'reconcile', sequence: owner.current.sequence, generation: owner.current.generation, ticket, action, scope, review_id: 'c'.repeat(64), reviewer: 'fixture-reviewer', worker_absent: true, outcome: result ? 'accept_output' : 'close_unknown', result });

test('reviewed output survives SIGKILL with distinct provenance and no automatic resume or replay', async () => fixture(async ({ open, archive }) => {
  let owner = await open(); const ticket = await dispatch(owner); const receipt = await save(archive, ticket);
  await kill(owner); owner = await open(); const plan = await prepare(owner, archive, { scope, ticket, receipt });
  const state = await commitRecoveryReview(owner, archive, worker, plan);
  assert.equal(state.mode, 'paused'); assert.equal(state.pending, null); assert.equal(state.uncertain, false);
  assert.equal(state.generation, plan.generation + 1); assert.equal(state.results.length, 0); assert.equal(state.resolutions.length, 1);
  await kill(owner); owner = await open();
  const reviewed = await archive.readReviewed(owner, scope);
  assert.deepEqual(reviewed.record.value, { sum: 5 }); assert.equal(reviewed.review.id, plan.review_id);
  assert.equal(reviewed.review.outcome, 'accept_output'); await assert.rejects(archive.readSettled(owner, scope), /no settled/);
  const report = await assessRecovery(owner, archive, { scope, ticket });
  assert.equal(report.status, 'reviewed_output_verified'); assert.equal(report.settlementRecorded, false);
  assert.equal(report.reviewRecorded.id, plan.review_id); assert.equal(report.requiresOutcomeReview, false);
  await assert.rejects(dispatch(owner), /stale/); await resume(owner); await assert.rejects(dispatch(owner), /duplicate/);
}));
test('closing an unknown outcome preserves saved bytes and cancellation through two restarts', async () => fixture(async ({ open, archive, root }) => {
  let owner = await open(); const ticket = await dispatch(owner); const receipt = await save(archive, ticket);
  await owner.request({ op: 'cancel' }); const plan = await prepare(owner, archive, { scope, ticket, receipt }, 'close_unknown');
  assert.equal(Object.hasOwn(plan.request, 'receipt'), false);
  await commitRecoveryReview(owner, archive, worker, plan);
  for (let index = 0; index < 2; index++) {
    await kill(owner); owner = await open(); assert.equal(owner.current.mode, 'cancelled');
    await assert.rejects(owner.request({ op: 'takeover' }));
    const report = await assessRecovery(owner, archive, { scope, ticket, receipt });
    assert.equal(report.status, 'closed_unknown'); assert.equal(report.verifiedReceipt, null); assert.equal(report.settlementRecorded, false);
    await assert.rejects(archive.readReviewed(owner, scope), /no reviewed/);
    assert.deepEqual((await archive.read(receipt, scope)).value, { sum: 5 });
    assert.equal((await readFile(join(root, 'archive', receipt.sha256))).length, receipt.bytes);
  }
}));
test('Rust rejects stale or mismatched reviews without journal mutation', async () => fixture(async ({ open, archive, journal }) => {
  let owner = await open(); const ticket = await dispatch(owner); const receipt = await save(archive, ticket); await owner.close(); owner = await open();
  const command = raw(owner, ticket, receipt); const before = await readFile(journal);
  const changes = [
    { sequence: command.sequence - 1 }, { generation: command.generation - 1 }, { ticket: ticket + 1 },
    { action: { ...action, arguments: { a: 3, b: 3 } } }, { worker_absent: false }, { review_id: 'bad' },
    { reviewer: '' }, { reviewer: 'x'.repeat(129) }, { reviewer: 'name\nextra' }, { result: null },
    { outcome: 'close_unknown' }, { outcome: 'success' }, { result: { sha256: 'a'.repeat(64), bytes: 0 } },
    ...Object.keys(scope).map(key => ({ scope: { ...scope, [key]: 'different' } })),
  ];
  for (const change of changes) {
    await assert.rejects(owner.request({ ...command, ...change }));
    assert.deepEqual(await readFile(journal), before);
  }
}));
test('active, undispatched and unscoped actions cannot be reconciled', async () => {
  for (const kind of ['active', 'undispatched', 'unscoped']) await fixture(async ({ open }) => {
    let owner = await open(); let ticket;
    if (kind === 'unscoped') {
      const admitted = await owner.request({ op: 'admit', generation: owner.current.generation, actor: 'agent', action }); ticket = admitted.pending;
      await owner.request({ op: 'dispatch', generation: admitted.generation, actor: 'agent', ticket, action });
    } else ticket = await dispatch(owner, scope, kind !== 'undispatched');
    if (kind !== 'active') { await owner.close(); owner = await open(); }
    await assert.rejects(owner.request(raw(owner, ticket)), /reconciliation/);
  });
});
test('a review becomes stale when controller state changes after preparation', async () => fixture(async ({ open, archive }) => {
  let owner = await open(); const ticket = await dispatch(owner); await owner.close(); owner = await open();
  const plan = await prepare(owner, archive, { scope, ticket }, 'close_unknown'); await owner.request({ op: 'disconnect' });
  await assert.rejects(commitRecoveryReview(owner, archive, worker, plan), /stale/); assert.equal(owner.current.resolutions.length, 0);
}));
test('commit rechecks archive integrity and worker absence after review', async () => fixture(async ({ open, archive, root }) => {
  let owner = await open(); const ticket = await dispatch(owner); const receipt = await save(archive, ticket); await owner.close(); owner = await open();
  const plan = await prepare(owner, archive, { scope, ticket, receipt });
  for (const state of ['present', 'unavailable']) await assert.rejects(commitRecoveryReview(owner, archive, { observeTermination: async () => ({ worker: scope.worker, state }) }, plan), /evidence/);
  await assert.rejects(commitRecoveryReview(owner, archive, null, plan), /evidence/);
  await writeFile(join(root, 'archive', receipt.sha256), 'corrupt');
  await assert.rejects(commitRecoveryReview(owner, archive, worker, plan), /evidence/);
  assert.equal(owner.current.resolutions.length, 0); assert.equal(owner.current.uncertain, true);
}));
test('Rust rejects a state change between final evidence assessment and commit', async () => fixture(async ({ open, archive }) => {
  let owner = await open(); const ticket = await dispatch(owner); await owner.close(); owner = await open();
  const plan = await prepare(owner, archive, { scope, ticket }, 'close_unknown');
  const racing = { request: async command => { if (command.op === 'reconcile') await owner.request({ op: 'disconnect' }); return owner.request(command); } };
  await assert.rejects(commitRecoveryReview(racing, archive, worker, plan), /stale/); assert.equal(owner.current.resolutions.length, 0);
}));
test('lost commit acknowledgement is discoverable after restart and never committed twice', async () => fixture(async ({ open, archive }) => {
  let owner = await open(); const ticket = await dispatch(owner); await owner.close(); owner = await open();
  const plan = await prepare(owner, archive, { scope, ticket }, 'close_unknown'); let commits = 0;
  const bridge = { request: async command => { const result = await owner.request(command); if (command.op === 'reconcile') { commits++; throw new Error('lost acknowledgement'); } return result; } };
  await assert.rejects(commitRecoveryReview(bridge, archive, worker, plan), /lost/);
  await kill(owner); owner = await open(); const report = await assessRecovery(owner, archive, { scope, ticket });
  assert.equal(report.reviewRecorded.id, plan.review_id); assert.equal(report.status, 'closed_unknown');
  await assert.rejects(commitRecoveryReview(owner, archive, worker, plan), /evidence/);
  assert.equal(commits, 1); assert.equal(owner.current.resolutions.length, 1);
}));
test('review history cannot be removed, rewritten or appended without the exact resolution transition', async () => fixture(async ({ open, archive, journal }) => {
  let owner = await open(); const ticket = await dispatch(owner); const receipt = await save(archive, ticket); await owner.close(); owner = await open();
  const plan = await prepare(owner, archive, { scope, ticket, receipt }); await commitRecoveryReview(owner, archive, worker, plan); await owner.close();
  const original = await readFile(journal, 'utf8'); const lines = original.trimEnd().split('\n').map(JSON.parse);
  for (const modify of [s => { s.resolutions = []; }, s => { s.resolutions[0].reviewer = 'other'; }, s => { s.resolutions.push(s.resolutions[0]); }]) {
    const next = structuredClone(lines.at(-1)); next.sequence++; modify(next);
    const evidence = original + JSON.stringify(next) + '\n'; await writeFile(journal, evidence);
    await assert.rejects(open()); assert.equal(await readFile(journal, 'utf8'), evidence);
  }
  for (const modify of [s => { s.mode = 'agent'; }, s => { s.generation--; }, s => { s.resolutions[0].worker_absent = false; }, s => { s.requests = []; }, s => { s.resolutions[0].result.bytes = 0; }, s => { s.results.push({ ticket, action_digest: s.resolutions[0].action_digest, scope_digest: s.resolutions[0].scope_digest, result: receipt }); }]) {
    const changed = structuredClone(lines); modify(changed.at(-1)); const evidence = changed.map(JSON.stringify).join('\n') + '\n';
    await writeFile(journal, evidence); await assert.rejects(open()); assert.equal(await readFile(journal, 'utf8'), evidence);
  }
}));
test('format 5 evidence is preserved and rejected without migration', async () => fixture(async ({ open, journal }) => {
  const owner = await open(); await owner.close();
  const old = (await readFile(journal, 'utf8')).trimEnd().split('\n').map(line => { const value = JSON.parse(line); value.version = 5; delete value.resolutions; return JSON.stringify(value); }).join('\n') + '\n';
  await writeFile(journal, old); await assert.rejects(open()); assert.equal(await readFile(journal, 'utf8'), old);
}));
test('review history capacity rejects additional resolution without evicting evidence', async () => fixture(async ({ open, archive }) => {
  const owner = await open();
  for (let index = 0; index < 17; index++) {
    const requested = { ...scope, request: String(index) }; const ticket = await dispatch(owner, requested);
    await owner.request({ op: 'disconnect' });
    const plan = await prepare(owner, archive, { scope: requested, ticket }, 'close_unknown');
    if (index === 16) { await assert.rejects(commitRecoveryReview(owner, archive, worker, plan), /reconciliation/); break; }
    await commitRecoveryReview(owner, archive, worker, plan); await resume(owner);
  }
  assert.equal(owner.current.resolutions.length, 16); assert.notEqual(owner.current.pending, null);
  assert.ok(Buffer.byteLength(JSON.stringify(owner.current)) < 65536);
  await owner.close(); const reopened = await open(); assert.equal(reopened.current.resolutions.length, 16);
}));
test('reviewed output readback rejects foreign scope and later corruption without losing provenance', async () => fixture(async ({ open, archive, root }) => {
  let owner = await open(); const ticket = await dispatch(owner); const receipt = await save(archive, ticket); await owner.close(); owner = await open();
  const plan = await prepare(owner, archive, { scope, ticket, receipt }); await commitRecoveryReview(owner, archive, worker, plan);
  for (const key of Object.keys(scope)) await assert.rejects(archive.readReviewed(owner, { ...scope, [key]: 'other' }), /no reviewed/);
  await writeFile(join(root, 'archive', receipt.sha256), 'corrupt'); await assert.rejects(archive.readReviewed(owner, scope));
  const report = await assessRecovery(owner, archive, { scope, ticket }); assert.equal(report.status, 'reviewed_output_unavailable');
  assert.equal(report.reviewRecorded.id, plan.review_id); assert.equal(report.verifiedReceipt, null); assert.equal(report.settlementRecorded, false);
}));
test('two reviews racing for the same action produce at most one durable disposition', async () => fixture(async ({ open, archive }) => {
  let owner = await open(); const ticket = await dispatch(owner); await owner.close(); owner = await open();
  const plan = await prepare(owner, archive, { scope, ticket }, 'close_unknown');
  const results = await Promise.allSettled([commitRecoveryReview(owner, archive, worker, plan), commitRecoveryReview(owner, archive, worker, { ...plan, review_id: 'd'.repeat(64) })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(owner.current.resolutions.length, 1);
}));

test('review preparation binds the displayed action and replay IDs cannot resolve another action', async () => fixture(async ({ open, archive }) => {
  const owner = await open(); const ticket = await dispatch(owner); await owner.request({ op: 'disconnect' });
  await assert.rejects(prepareRecoveryReview(owner, archive, worker, { request: { scope, ticket }, action: { ...action, arguments: { a: 3, b: 3 } }, outcome: 'close_unknown', reviewer: 'fixture-reviewer' }), /binding/);
  const plan = await prepare(owner, archive, { scope, ticket }, 'close_unknown');
  await commitRecoveryReview(owner, archive, worker, plan); await resume(owner);
  const requested = { ...scope, request: 'second' }; const secondTicket = await dispatch(owner, requested); await owner.request({ op: 'disconnect' });
  const second = await prepare(owner, archive, { scope: requested, ticket: secondTicket }, 'close_unknown');
  await assert.rejects(commitRecoveryReview(owner, archive, worker, { ...second, review_id: plan.review_id }), /reconciliation/);
  assert.equal(owner.current.resolutions.length, 1); assert.equal(owner.current.pending, secondTicket);
}));
test('crash before review commit retains uncertainty and invalidates the prepared decision', async () => fixture(async ({ open, archive }) => {
  let owner = await open(); const ticket = await dispatch(owner); await owner.request({ op: 'disconnect' });
  const plan = await prepare(owner, archive, { scope, ticket }, 'close_unknown'); await kill(owner); owner = await open();
  await assert.rejects(commitRecoveryReview(owner, archive, worker, plan), /stale/);
  assert.equal(owner.current.resolutions.length, 0); assert.equal(owner.current.uncertain, true);
}));
