import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink, chmod, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecoveryWorker, validateWorkerRecord, saveWorkerRecord, readWorkerRecord } from './recovery-worker.mjs';
const id = 'a'.repeat(64);
const record = { version: 1, runtimeId: 'engine-1', worker: id, workspace: '/fixture/workspace' };
const scope = { worker: id, workspace: record.workspace };
const runtime = (overrides = {}) => ({ identity: async () => 'engine-1', ids: async () => [], ...overrides });
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'agentmeld-worker-record-'));
  try { await run(join(directory, 'worker.json'), directory); }
  finally { await rm(directory, { recursive: true }); }
}
test('fresh recovery observer checks engine on both sides and never exposes dispatch', async () => {
  let remaining = [id]; let lookups = 0;
  const observer = new RecoveryWorker(record, runtime({ identity: async () => { lookups++; return 'engine-1'; }, ids: async () => remaining }));
  assert.equal((await observer.observeTermination(scope)).state, 'present');
  remaining = []; assert.equal((await observer.observeTermination(scope)).state, 'absent');
  assert.equal(lookups, 4); assert.equal(observer.request, undefined); assert.equal(observer.terminate, undefined);
  await assert.rejects(observer.observeTermination({ ...scope, worker: 'b'.repeat(64) }), /scope/);
  await assert.rejects(observer.observeTermination({ ...scope, workspace: '/wrong' }), /scope/);
  assert.equal(lookups, 4);
});
test('wrong, replaced and unavailable Docker engines cannot establish absence', async () => {
  for (const identity of [async () => 'other', async () => '', async () => { throw Error('offline'); }]) {
    let queries = 0;
    const observer = new RecoveryWorker(record, runtime({ identity, ids: async () => { queries++; return []; } }));
    assert.equal((await observer.observeTermination(scope)).state, 'unavailable'); assert.equal(queries, 0);
  }
  let n = 0;
  const observer = new RecoveryWorker(record, runtime({ identity: async () => ++n === 1 ? 'engine-1' : 'engine-2' }));
  assert.equal((await observer.observeTermination(scope)).state, 'unavailable');
});
test('invalid and failed inventories remain unavailable after reconstruction', async () => {
  for (const ids of [null, {}, ['short'], [id, id], ['A'.repeat(64)]]) {
    assert.equal((await new RecoveryWorker(record, runtime({ ids: async () => ids })).observeTermination(scope)).state, 'unavailable');
  }
  assert.equal((await new RecoveryWorker(record, runtime({ ids: async () => { throw Error('offline'); } })).observeTermination(scope)).state, 'unavailable');
});
test('record schema rejects mutable names, invalid engine identities and unsafe scope values', () => {
  for (const change of [{ version: 2 }, { runtimeId: '' }, { runtimeId: 'secret\nvalue' }, { worker: 'name' }, { workspace: 'relative' }, { workspace: '/' + 'x'.repeat(256) }, { extra: true }]) {
    assert.throws(() => validateWorkerRecord({ ...record, ...change }), /invalid/);
  }
  const input = structuredClone(record); const observer = new RecoveryWorker(input, runtime()); input.worker = 'b'.repeat(64);
  assert.equal(observer.record.worker, id); assert.ok(Object.isFrozen(observer.record));
});
test('record persists for a fresh observer and existing records are never overwritten', async () => fixture(async path => {
  await saveWorkerRecord(path, { id, workspace: scope.workspace, runtime: runtime() });
  const saved = await readWorkerRecord(path); assert.deepEqual(saved, record);
  assert.equal((await new RecoveryWorker(saved, runtime()).observeTermination(scope)).state, 'absent');
  const before = await readFile(path);
  await assert.rejects(saveWorkerRecord(path, { id, workspace: scope.workspace, runtime: runtime() }), /EEXIST/);
  assert.deepEqual(await readFile(path), before);
}));
test('record reader rejects symlinks, hard links, broad permissions, oversized and malformed files', async () => fixture(async (path, directory) => {
  await writeFile(path, JSON.stringify(record), { mode: 0o600 });
  const alias = join(directory, 'alias'); await symlink(path, alias); await assert.rejects(readWorkerRecord(alias));
  await link(path, join(directory, 'hardlink')); await assert.rejects(readWorkerRecord(path), /invalid/);
  await rm(join(directory, 'hardlink')); await chmod(path, 0o644); await assert.rejects(readWorkerRecord(path), /invalid/);
  await chmod(path, 0o600);
  for (const bytes of ['x'.repeat(4097), '{', Buffer.from([0xff])]) {
    await writeFile(path, bytes); await assert.rejects(readWorkerRecord(path));
  }
  await assert.rejects(readWorkerRecord(directory));
}));
