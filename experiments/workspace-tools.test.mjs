import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listWorkspace } from './workspace-tools.mjs';
import { normalizeArguments, validateResult } from './tool-contract.mjs';
test('workspace tool cannot select a path and rejects unbounded or malformed results', () => {
  for (const args of [{ path: '..' }, [], null]) assert.throws(() => normalizeArguments('workspace_list', args));
  for (const entries of [['../outside'], ['a', 'a'], ['line\nbreak'], ['x'.repeat(256)], Array.from({ length: 129 }, (_, i) => String(i))]) assert.throws(() => validateResult('workspace_list', {}, { entries }));
  assert.throws(() => validateResult('workspace_list', {}, { entries: [], contents: 'unexpected' }));
});
test('workspace listing returns immediate names without following symlinks or opening files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentmeld-list-'));
  try {
    await mkdir(join(root, 'workspace')); await writeFile(join(root, 'outside'), 'synthetic secret');
    await writeFile(join(root, 'workspace', 'file'), 'not returned'); await mkdir(join(root, 'workspace', 'nested'));
    await writeFile(join(root, 'workspace', 'nested', 'child'), 'not returned');
    await symlink(join(root, 'outside'), join(root, 'workspace', 'link'));
    assert.deepEqual(await listWorkspace(join(root, 'workspace')), { entries: ['file', 'link', 'nested'] });
  } finally { await rm(root, { recursive: true }); }
});
test('workspace listing rejects directories beyond its entry budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentmeld-list-'));
  try {
    await Promise.all(Array.from({ length: 129 }, (_, i) => writeFile(join(root, String(i)), '')));
    await assert.rejects(listWorkspace(root), /limit/);
  } finally { await rm(root, { recursive: true }); }
});
