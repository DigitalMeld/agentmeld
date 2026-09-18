import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RustAuthority } from './rust-browser-control.mjs';
import { ResultArchive } from './result-archive.mjs';
import { assessRecovery } from './recovery-assessment.mjs';
const execute = promisify(execFile);
const binary = process.env.AGENTMELD_TEST_BINARY || 'target/debug/agentmeld-m0';
const scope = { workspace: 'workspace', worker: 'worker', thread: 'thread', turn: 'turn', request: 'call' };
const action = { provider: 'codex', tool: 'fixture_sum', target: 'worker', arguments: { a: 2, b: 3 } };
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'agentmeld-recovery-review-')); const owners = [];
  const journal = join(root, 'journal'); const directory = join(root, 'archive');
  const open = async () => { const owner = await RustAuthority.open(binary, journal); owners.push(owner); return owner; };
  try { await run({ root, journal, directory, open, archive: new ResultArchive(binary, directory) }); }
  finally { for (const owner of owners) await owner.close(); await rm(root, { recursive: true }); }
}
async function admit(owner, dispatch = true) {
  const proposed = await owner.request({ op: 'propose', generation: owner.current.generation, action, scope, ttl_ms: 30000, result_required: true });
  const allowed = await owner.request({ op: 'decide', approval_id: proposed.approval.id, action, scope, allow: true });
  if (dispatch) await owner.request({ op: 'dispatch', actor: 'agent', generation: allowed.generation, ticket: allowed.pending, action });
  return allowed.pending;
}
const save = (archive, ticket, changes = {}) => archive.put({ scope, action, ticket, value: { sum: 5 }, ...changes });
async function kill(owner) { const exit = new Promise(resolve => owner.process.once('exit', resolve)); owner.process.kill('SIGKILL'); await exit; }

test('saved output after SIGKILL is evidence only; assessment preserves journal and execution fence', async () => fixture(async ({ open, archive, journal }) => {
  let owner = await open(); const ticket = await admit(owner); const receipt = await save(archive, ticket);
  await kill(owner); owner = await open(); const before = await readFile(journal);
  const report = await assessRecovery(owner, archive, { scope, ticket, receipt });
  assert.equal(report.status, 'pending_output_verified'); assert.deepEqual(report.verifiedReceipt, receipt);
  assert.equal(report.settlementRecorded, false); assert.equal(report.requiresWorkerReconciliation, true);
  assert.equal(report.retryAuthorized, false); assert.equal(report.resumeAuthorized, false);
  assert.deepEqual(await readFile(journal), before); assert.equal(owner.current.uncertain, true);
  await assert.rejects(owner.request({ op: 'settle', ticket, action, result: receipt }), /uncertain/);
  await assert.rejects(owner.request({ op: 'resume', generation: owner.current.generation }));
  await assert.rejects(archive.readSettled(owner, scope), /no settled/);
}));
test('settled output uses the durable receipt rather than an operator-supplied replacement', async () => fixture(async ({ open, archive }) => {
  let owner = await open(); const ticket = await admit(owner); const receipt = await save(archive, ticket);
  await owner.request({ op: 'settle', ticket, action, result: receipt }); await kill(owner); owner = await open();
  const report = await assessRecovery(owner, archive, { scope, ticket, receipt: { sha256: 'a'.repeat(64), bytes: 1 } });
  assert.equal(report.status, 'settled_verified'); assert.equal(report.settlementRecorded, true);
  assert.equal(report.requiresWorkerReconciliation, false); assert.deepEqual(report.verifiedReceipt, receipt);
}));
test('missing and corrupt settled bytes never erase the recorded settlement', async () => fixture(async ({ open, archive, directory }) => {
  let owner = await open(); const ticket = await admit(owner); const receipt = await save(archive, ticket);
  await owner.request({ op: 'settle', ticket, action, result: receipt }); await owner.close(); owner = await open();
  for (const missing of [false, true]) {
    if (missing) await rm(join(directory, receipt.sha256)); else await writeFile(join(directory, receipt.sha256), 'private synthetic output');
    const report = await assessRecovery(owner, archive, { scope, ticket });
    assert.equal(report.status, 'settled_output_unavailable'); assert.equal(report.settlementRecorded, true);
    assert.equal(report.verifiedReceipt, null); assert.equal(JSON.stringify(report).includes('private'), false);
  }
}));
test('pending archive evidence must match ticket, action and every scope field', async () => fixture(async ({ open, archive }) => {
  let owner = await open(); const ticket = await admit(owner);
  const wrong = [
    { ticket: ticket + 1 },
    { action: { ...action, arguments: { a: 3, b: 3 } }, value: { sum: 6 } },
    ...Object.keys(scope).map(key => ({ scope: { ...scope, [key]: 'other' }, ...(key === 'worker' ? { action: { ...action, target: 'other' } } : {}) })),
  ];
  const receipts = []; // Writes stay sequential under the archive lock.
  for (const [index, changes] of wrong.entries()) receipts[index] = await save(archive, ticket, changes);
  await owner.close(); owner = await open();
  for (const receipt of receipts) {
    const report = await assessRecovery(owner, archive, { scope, ticket, receipt });
    assert.equal(report.status, 'pending_output_unavailable'); assert.equal(report.verifiedReceipt, null);
  }
  for (const key of Object.keys(scope)) await assert.rejects(assessRecovery(owner, archive, { scope: { ...scope, [key]: 'other' }, ticket }), /no matching/);
  await assert.rejects(assessRecovery(owner, archive, { scope, ticket: ticket + 1 }), /no matching/);
}));
test('undispatched actions and dispatched unknown outcomes stay distinct after restart', async () => {
  for (const dispatched of [false, true]) await fixture(async ({ open, archive }) => {
    let owner = await open(); const ticket = await admit(owner, dispatched); await owner.close(); owner = await open();
    const report = await assessRecovery(owner, archive, { scope, ticket });
    assert.equal(report.status, dispatched ? 'pending_outcome_unknown' : 'pending_not_dispatched');
    assert.equal(report.requiresWorkerReconciliation, dispatched); assert.equal(report.retryAuthorized, false);
  });
});
test('active controllers are rejected; cancelled work stays cancelled', async () => fixture(async ({ open, archive }) => {
  const owner = await open(); const ticket = await admit(owner); const receipt = await save(archive, ticket);
  await assert.rejects(assessRecovery(owner, archive, { scope, ticket, receipt }), /paused or cancelled/);
  await owner.request({ op: 'cancel' }); const before = structuredClone(owner.current);
  assert.equal((await assessRecovery(owner, archive, { scope, ticket, receipt })).mode, 'cancelled');
  assert.deepEqual(owner.current, before);
}));
test('state changes during archive reads invalidate the assessment', async () => fixture(async ({ open, archive }) => {
  let owner = await open(); const ticket = await admit(owner); const receipt = await save(archive, ticket);
  await owner.close(); owner = await open();
  const racing = { read: async (...args) => { const record = await archive.read(...args); await owner.request({ op: 'cancel' }); return record; } };
  await assert.rejects(assessRecovery(owner, racing, { scope, ticket, receipt }), /state changed/);
  assert.equal(owner.current.mode, 'cancelled');
}));
test('malformed requests fail before querying the authority or reading storage', async () => {
  const authority = { request: () => assert.fail('must not query authority') };
  for (const input of [null, { scope, ticket: 0 }, { scope, ticket: 1, extra: true }, { scope: { ...scope, request: '\ud800' }, ticket: 1 }, { scope, ticket: 1, receipt: null }, { scope, ticket: 1, receipt: { sha256: 'A'.repeat(64), bytes: 1 } }]) await assert.rejects(assessRecovery(authority, {}, input), /invalid/);
});
test('recovery CLI requires explicit recovery, preserves invalid inputs and respects exclusive ownership', async () => fixture(async ({ root, open, archive, journal, directory }) => {
  const owner = await open(); const ticket = await admit(owner); const receipt = await save(archive, ticket);
  const request = join(root, 'request.json'); await writeFile(request, JSON.stringify({ scope, ticket, receipt }));
  const args = ['scripts/review-recovery.mjs', '--journal', journal, '--archive', directory, '--request', request];
  const before = await readFile(journal);
  for (const argv of [args, [...args, '--recover']]) {
    await assert.rejects(execute(process.execPath, argv), error => error.code === 1 && !error.stderr.includes(root));
    assert.deepEqual(await readFile(journal), before);
  }
  await owner.close();
  await writeFile(request, '{broken'); await assert.rejects(execute(process.execPath, [...args, '--recover']));
  assert.deepEqual(await readFile(journal), before);
  await writeFile(request, JSON.stringify({ scope, ticket, receipt }));
  const { stdout } = await execute(process.execPath, [...args, '--recover']); const report = JSON.parse(stdout);
  assert.equal(report.status, 'pending_output_verified'); assert.equal(report.mode, 'paused');
  assert.equal(report.resumeAuthorized, false); assert.equal(stdout.includes('arguments'), false);
  const after = await readFile(journal, 'utf8');
  assert.equal(after.trimEnd().split('\n').length, before.toString().trimEnd().split('\n').length + 1);
  const recovered = await open(); assert.equal(recovered.current.uncertain, true);
}));
test('recovery CLI does not create a missing journal', async () => fixture(async ({ root, journal, directory }) => {
  await mkdir(directory); const request = join(root, 'request.json'); await writeFile(request, JSON.stringify({ scope, ticket: 1 }));
  await assert.rejects(execute(process.execPath, ['scripts/review-recovery.mjs', '--recover', '--journal', journal, '--archive', directory, '--request', request]));
  await assert.rejects(readFile(journal), { code: 'ENOENT' });
}));

test('CLI rejects oversized, symlink and FIFO request files before opening the journal', async () => fixture(async ({ root, open, archive, journal, directory }) => {
  const owner = await open(); const ticket = await admit(owner); await save(archive, ticket); await owner.close();
  const before = await readFile(journal); const oversized = join(root, 'oversized'); const link = join(root, 'link'); const fifo = join(root, 'fifo');
  await writeFile(oversized, 'x'.repeat(65537)); await symlink(oversized, link); await execute('mkfifo', [fifo]);
  for (const request of [oversized, link, fifo]) {
    await assert.rejects(execute(process.execPath, ['scripts/review-recovery.mjs', '--recover', '--journal', journal, '--archive', directory, '--request', request], { timeout: 3000 }), error => error.code === 1);
    assert.deepEqual(await readFile(journal), before);
  }
}));

test('fresh worker evidence refines recovery needs without resolving the action', async () => fixture(async ({ open, archive, journal }) => {
  let owner = await open(); const ticket = await admit(owner); const receipt = await save(archive, ticket); await owner.close(); owner = await open();
  const before = await readFile(journal);
  for (const state of ['present', 'absent', 'unavailable']) {
    const worker = { observeTermination: async expected => { assert.deepEqual(expected, scope); return { worker: scope.worker, state }; } };
    const report = await assessRecovery(owner, archive, { scope, ticket, receipt }, worker);
    assert.equal(report.version, 3); assert.equal(report.workerState, state);
    assert.equal(report.requiresWorkerReconciliation, state !== 'absent');
    assert.equal(report.requiresOutcomeReview, true); assert.equal(report.settlementRecorded, false);
    assert.equal(report.retryAuthorized, false); assert.equal(report.resumeAuthorized, false);
  }
  assert.deepEqual(await readFile(journal), before); assert.equal(owner.current.uncertain, true);
}));
test('invalid worker evidence and state changes during inventory cannot produce a report', async () => fixture(async ({ open, archive }) => {
  let owner = await open(); const ticket = await admit(owner); await owner.close(); owner = await open();
  for (const evidence of [null, { worker: 'foreign', state: 'absent' }, { worker: scope.worker, state: 'stopped' }]) {
    await assert.rejects(assessRecovery(owner, archive, { scope, ticket }, { observeTermination: async () => evidence }), /invalid worker evidence/);
  }
  await assert.rejects(assessRecovery(owner, archive, { scope, ticket }, { observeTermination: async () => { await owner.request({ op: 'cancel' }); return { worker: scope.worker, state: 'absent' }; } }), /state changed/);
}));
