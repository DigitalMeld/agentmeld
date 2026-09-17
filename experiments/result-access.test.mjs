import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RustAuthority } from './rust-browser-control.mjs';
import { ResultArchive } from './result-archive.mjs';
import { NativeToolBroker } from './native-tool-broker.mjs';
import { startResultServer } from './result-server.mjs';
const binary = 'target/debug/agentmeld-m0';
const scope = { workspace: 'fixture', worker: 'worker', thread: 'thread', turn: 'turn', request: 'call' };
const action = { provider: 'codex', tool: 'fixture_sum', target: 'worker', arguments: { a: 2, b: 3 } };
const frame = { id: 1, method: 'item/tool/call', params: { threadId: 'thread', turnId: 'turn', callId: 'call', tool: 'fixture_sum', arguments: action.arguments } };
test('HTTP result access exposes only verified settled output after supervisor replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentmeld-access-')); const owners = []; const servers = [];
  const open = async () => { const value = await RustAuthority.open(binary, join(root, 'journal')); owners.push(value); return value; };
  const archive = new ResultArchive(binary, join(root, 'archive'));
  const pair = async (authority, requested = scope) => { const server = await startResultServer({ authority, archive, scope: requested }); servers.push(server); return server; };
  const get = server => fetch(server.origin + '/result', { headers: { Authorization: `Bearer ${server.token}` } });
  try {
    let owner = await open();
    // Saved bytes without a settlement must not become available through the endpoint.
    await archive.put({ scope, action, ticket: 99, value: { sum: 5 } });
    const before = await pair(owner); assert.equal((await get(before)).status, 409); await before.close();
    const broker = new NativeToolBroker(owner, { request: async () => ({ sum: 5 }) }, scope, ['fixture_sum'], archive);
    const proposal = await broker.propose(frame); assert.equal((await broker.decide(proposal.id, true)).success, true);
    await owner.close(); owner = await open(); assert.equal(owner.current.mode, 'paused');
    const server = await pair(owner); const response = await get(server);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { tool: 'fixture_sum', result: { sum: 5 } });
    assert.equal(owner.current.mode, 'paused'); // Readback cannot resume execution.
    const foreign = await pair(owner, { ...scope, request: 'foreign' }); assert.equal((await get(foreign)).status, 409);
    await writeFile(join(root, 'archive', broker.lastResult.sha256), 'corrupt synthetic result');
    const corrupted = await get(server); assert.equal(corrupted.status, 409);
    assert.equal((await corrupted.text()).includes('synthetic'), false);
    server.revoke(); assert.equal((await get(server)).status, 410);
  } finally {
    for (const server of servers) await server.close();
    for (const owner of owners) await owner.close();
    await rm(root, { recursive: true });
  }
});
