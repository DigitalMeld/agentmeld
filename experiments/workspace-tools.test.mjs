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

test('workspace text reads preserve UTF-8 bytes including BOM and enforce exact result binding', async () => {
  const { readWorkspace } = await import('./workspace-tools.mjs');
  const root = await mkdtemp(join(tmpdir(), 'agentmeld-read-'));
  try {
    for (const text of ['', '\ufeffSynthetic café 🍎\n', 'a'.repeat(65536)]) {
      await writeFile(join(root, 'fixture.txt'), text);
      const result = await readWorkspace(root, { name: 'fixture.txt' });
      assert.equal(result.text, text); assert.equal(result.bytes, Buffer.byteLength(text));
      assert.equal(result.sha256.length, 64);
      for (const patch of [{ name: 'other' }, { bytes: -1 }, { sha256: 'a'.repeat(64) }, { text: '\ud800' }, { extra: true }]) {
        assert.throws(() => validateResult('workspace_read', { name: 'fixture.txt' }, { ...result, ...patch }));
      }
    }
  } finally { await rm(root, { recursive: true }); }
});
test('workspace text arguments reject traversal, absolute paths, extra fields and ambiguous names', () => {
  for (const name of ['', '.', '..', '../outside', '/etc/passwd', 'nested/file', 'nested\\file', 'nul\0', 'line\nbreak', 'x'.repeat(256), 'é'.repeat(128)]) {
    assert.throws(() => normalizeArguments('workspace_read', { name }));
  }
  for (const args of [{ name: 'safe', path: '/' }, {}, [], null]) assert.throws(() => normalizeArguments('workspace_read', args));
});
test('workspace text rejects symlinks, hard links, directories, oversized and non-text files', async () => {
  const { readWorkspace } = await import('./workspace-tools.mjs');
  const { link } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'agentmeld-read-'));
  try {
    const workspace = join(root, 'workspace'); await mkdir(workspace);
    await writeFile(join(root, 'outside'), 'synthetic outside data');
    await symlink(join(root, 'outside'), join(workspace, 'symlink'));
    await link(join(root, 'outside'), join(workspace, 'hardlink'));
    await mkdir(join(workspace, 'directory'));
    await writeFile(join(workspace, 'large'), 'x'.repeat(65537));
    await writeFile(join(workspace, 'invalid'), Buffer.from([0xff, 0xfe]));
    await writeFile(join(workspace, 'nul'), 'a\0b');
    for (const name of ['symlink', 'hardlink', 'directory', 'large', 'invalid', 'nul', 'missing']) await assert.rejects(readWorkspace(workspace, { name }));
  } finally { await rm(root, { recursive: true }); }
});
test('workspace FIFO is rejected without waiting for a writer', { timeout: 3000 }, async () => {
  const { readWorkspace } = await import('./workspace-tools.mjs');
  const { execFileSync } = await import('node:child_process');
  const root = await mkdtemp(join(tmpdir(), 'agentmeld-read-'));
  try {
    execFileSync('mkfifo', [join(root, 'pipe')]);
    await assert.rejects(readWorkspace(root, { name: 'pipe' }), /type/);
  } finally { await rm(root, { recursive: true }); }
});
