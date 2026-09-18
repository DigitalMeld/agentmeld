import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createProviderEgress, connectTarget, publicIPv4 } from './provider-egress.mjs';

const hosts = ['provider.example'];
async function fixture(run, options = {}) {
  const peers = new Set();
  const echo = createServer(socket => { peers.add(socket); socket.on('close', () => peers.delete(socket)); socket.on('error', () => {}); socket.pipe(socket); });
  echo.listen(0, '127.0.0.1'); await once(echo, 'listening');
  const dials = [];
  const proxy = createProviderEgress({ hosts, resolve: async () => [{ family: 4, address: '1.1.1.1' }],
    dial: options => { dials.push(options); return connect(echo.address().port, '127.0.0.1'); },
    idleTimeoutMs: 500, lifetimeMs: 1000, connectTimeoutMs: 300, ...options });
  proxy.server.listen(0, '127.0.0.1'); await once(proxy.server, 'listening');
  const clients = new Set();
  async function client(authority = 'provider.example:443', suffix = '') {
    const socket = connect(proxy.server.address().port, '127.0.0.1'); clients.add(socket);
    socket.on('error', () => {}); await once(socket, 'connect');
    socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n${suffix}`);
    return socket;
  }
  try { await run({ proxy, client, dials }); }
  finally {
    for (const socket of clients) socket.destroy();
    await proxy.close(); for (const socket of peers) socket.destroy();
    await new Promise(resolve => echo.close(resolve));
  }
}
async function response(socket) {
  return new Promise(resolve => {
    let data = ''; const done = () => { socket.off('data', read); socket.off('close', done); resolve(data); };
    const read = chunk => { data += chunk; if (data.includes('\r\n\r\n')) done(); };
    socket.on('data', read); socket.once('close', done);
  });
}

test('CONNECT accepts only exact enrolled DNS names on TLS port without URL ambiguity', () => {
  const allowed = new Set(hosts);
  assert.equal(connectTarget('provider.example:443', allowed), 'provider.example');
  for (const value of ['provider.example:80', 'provider.example:0443', 'PROVIDER.example:443', 'provider.example.:443', 'provider.example.evil:443', 'https://provider.example:443', 'user@provider.example:443', '127.0.0.1:443', '[::1]:443', 'provider.example:443/path']) assert.throws(() => connectTarget(value, allowed));
});
test('destination addresses reject loopback, private, link-local, special-use, multicast and IPv6', () => {
  for (const ip of ['0.1.2.3', '10.0.0.1', '127.0.0.1', '100.64.0.1', '100.127.255.255', '169.254.169.254', '172.16.0.1', '172.31.0.1', '192.168.0.1', '192.0.0.1', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.19.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:1.1.1.1', '1.1.1.999']) assert.equal(publicIPv4(ip), false, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '100.128.0.1', '172.32.0.1']) assert.equal(publicIPv4(ip), true, ip);
});
test('permitted tunnel pins checked IP and carries opaque bytes without TLS termination', async () => fixture(async ({ client, dials }) => {
  const socket = await client(); assert.match(await response(socket), /200 Connection Established/);
  const received = once(socket, 'data'); socket.write('opaque fixture');
  assert.equal((await received)[0].toString(), 'opaque fixture');
  assert.deepEqual(dials, [{ host: '1.1.1.1', port: 443, family: 4 }]);
}));
test('unenrolled host and pipelined bytes fail before any outbound connection', async () => fixture(async ({ client, dials }) => {
  assert.match(await response(await client('evil.example:443')), /403/);
  assert.match(await response(await client('provider.example:443', 'injected')), /403/);
  assert.equal(dials.length, 0);
}));
test('private, mixed and malformed DNS answers never reach the dialer', async () => {
  for (const answers of [[], [{ family: 4, address: '127.0.0.1' }], [{ family: 4, address: '1.1.1.1' }, { family: 4, address: '10.0.0.1' }], [{ family: 6, address: '::1' }], null]) {
    await fixture(async ({ client, dials }) => { assert.match(await response(await client()), /403/); assert.equal(dials.length, 0); }, { resolve: async () => answers });
  }
});
test('expired DNS lookup cannot open an outbound socket after client deadline', async () => {
  let release;
  await fixture(async ({ client, dials }) => {
    const socket = await client(); await once(socket, 'close');
    release([{ family: 4, address: '1.1.1.1' }]); await delay(20); assert.equal(dials.length, 0);
  }, { connectTimeoutMs: 30, resolve: () => new Promise(resolve => { release = resolve; }) });
});
test('tunnel byte budget terminates oversized transmission', async () => fixture(async ({ client }) => {
  const socket = await client(); assert.match(await response(socket), /200/);
  const closed = once(socket, 'close'); socket.write('12345'); await closed;
}, { maxBytes: 4 }));
test('absolute tunnel lifetime terminates an idle accepted connection', async () => fixture(async ({ client }) => {
  const socket = await client(); assert.match(await response(socket), /200/); await once(socket, 'close');
}, { lifetimeMs: 50, idleTimeoutMs: 500 }));
