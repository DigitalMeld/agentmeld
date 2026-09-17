import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startResultServer } from './result-server.mjs';
import { setTimeout as delay } from 'node:timers/promises';
const scope = () => ({ workspace: 'fixture', worker: 'worker', thread: 'thread', turn: 'turn', request: 'call' });
const record = { action: { tool: 'workspace_read' }, value: { name: 'fixture.txt', text: '<script>untrusted</script>' } };
const headers = server => ({ Authorization: `Bearer ${server.token}`, Origin: server.origin });
test('result access requires its capability and exact host/origin, with no caller-selected scope', async () => {
  const expected = scope(); let reads = 0;
  const server = await startResultServer({ scope: expected, authority: {}, archive: { readSettled: async (authority, bound) => { reads++; assert.deepEqual(bound, scope()); return record; } } });
  expected.workspace = 'changed after pairing';
  try {
    assert.equal((await fetch(server.origin + '/result')).status, 401);
    assert.equal((await fetch(server.origin + '/result', { headers: { ...headers(server), Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(server.origin + '/result', { headers: { ...headers(server), Origin: 'https://other.invalid' } })).status, 403);
    const host = await new Promise((resolve, reject) => {
      const req = request(server.origin + '/result', { headers: { ...headers(server), Host: 'other.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end();
    });
    assert.equal(host, 403);
    assert.equal((await fetch(server.origin + '/result?request=other', { headers: headers(server) })).status, 404);
    assert.equal((await fetch(server.origin + '/result', { method: 'POST', headers: headers(server), body: '{}' })).status, 405);
    assert.equal(reads, 0);
    const response = await fetch(server.origin + '/result', { headers: headers(server) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { tool: 'workspace_read', result: record.value });
    assert.equal(response.headers.get('content-type'), 'application/json'); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(reads, 1);
  } finally { await server.close(); }
});
test('capabilities cannot cross endpoints and revocation is permanent', async () => {
  const options = { scope: scope(), authority: {}, archive: { readSettled: async () => record } };
  const first = await startResultServer(options); const second = await startResultServer(options);
  try {
    assert.equal((await fetch(second.origin + '/result', { headers: { Authorization: `Bearer ${first.token}` } })).status, 401);
    first.revoke();
    for (let index = 0; index < 2; index++) assert.equal((await fetch(first.origin + '/result', { headers: headers(first) })).status, 410);
    assert.equal((await fetch(second.origin + '/result', { headers: headers(second) })).status, 200);
  } finally { await first.close(); await first.close(); await second.close(); }
});
test('absolute expiry cannot be renewed by successful reads', async () => {
  const server = await startResultServer({ scope: scope(), authority: {}, ttlMs: 150, archive: { readSettled: async () => record } });
  try {
    assert.equal((await fetch(server.origin + '/result', { headers: headers(server) })).status, 200);
    await delay(180);
    assert.equal((await fetch(server.origin + '/result', { headers: headers(server) })).status, 410);
  } finally { await server.close(); }
});
for (const revoke of [true, false]) test(`pending result is withheld after ${revoke ? 'revocation' : 'expiry'}`, async () => {
  let release; let began; const started = new Promise(resolve => { began = resolve; });
  const server = await startResultServer({ scope: scope(), authority: {}, ttlMs: revoke ? 60000 : 100, archive: { readSettled: async () => { began(); return new Promise(resolve => { release = resolve; }); } } });
  try {
    const pending = fetch(server.origin + '/result', { headers: headers(server) }); await started;
    assert.equal((await fetch(server.origin + '/result', { headers: headers(server) })).status, 429);
    if (revoke) server.revoke(); else await delay(150);
    release(record); const response = await pending; assert.equal(response.status, 410);
    assert.equal((await response.text()).includes('untrusted'), false);
  } finally { release?.(record); await server.close(); }
});
test('archive errors reveal neither paths nor contents and release the read slot', async () => {
  let fail = true;
  const server = await startResultServer({ scope: scope(), authority: {}, archive: { readSettled: async () => { if (fail) throw new Error('/private-path sensitive text'); return record; } } });
  try {
    const response = await fetch(server.origin + '/result', { headers: headers(server) });
    assert.equal(response.status, 409); assert.equal((await response.text()).includes('sensitive'), false);
    fail = false; assert.equal((await fetch(server.origin + '/result', { headers: headers(server) })).status, 200);
  } finally { await server.close(); }
});
test('invalid scope or lifetime cannot start result access', async () => {
  for (const ttlMs of [0, -1, 300001, Infinity]) await assert.rejects(startResultServer({ scope: scope(), ttlMs }));
  for (const invalid of [{ ...scope(), request: '' }, { ...scope(), extra: 'value' }, { ...scope(), worker: '\ud800' }]) await assert.rejects(startResultServer({ scope: invalid }));
});
