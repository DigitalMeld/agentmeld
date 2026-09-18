// Experimental CONNECT-only provider gateway. No TLS termination or credential logging.
import { createServer } from 'node:http';
import { connect, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export function publicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

export function connectTarget(authority, allowed) {
  if (typeof authority !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*:443$/.test(authority)) throw Error('destination denied');
  const host = authority.slice(0, -4);
  if (isIP(host) || !allowed.has(host)) throw Error('destination denied');
  return host;
}

export function createProviderEgress({ hosts, resolve = host => lookup(host, { all: true, family: 4 }), dial = connect,
  connectTimeoutMs = 5000, idleTimeoutMs = 15000, lifetimeMs = 60000, maxBytes = 16 * 1024 * 1024, maxConnections = 8 }) {
  const allowed = new Set(hosts);
  if (!allowed.size) throw Error('explicit hosts required');
  for (const host of allowed) connectTarget(host + ':443', allowed);
  for (const value of [connectTimeoutMs, idleTimeoutMs, lifetimeMs, maxBytes, maxConnections]) {
    if (!Number.isSafeInteger(value) || value < 1) throw Error('positive limits required');
  }
  const sockets = new Set();
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: connectTimeoutMs, requestTimeout: connectTimeoutMs }, (_req, res) => {
    res.writeHead(403, { Connection: 'close' }); res.end();
  });
  server.on('connection', socket => {
    if (sockets.size >= maxConnections) { socket.destroy(); return; }
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(idleTimeoutMs, () => socket.destroy());
    socket.on('error', () => socket.destroy());
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connect', (req, client, head) => {
    client.pause();
    let upstream; let closed = false;
    const finish = () => { if (closed) return; closed = true; clearTimeout(deadline); clearTimeout(lifetime); client.destroy(); upstream?.destroy(); };
    const deadline = setTimeout(finish, connectTimeoutMs);
    const lifetime = setTimeout(finish, lifetimeMs);
    client.once('close', finish);
    (async () => {
      const host = connectTarget(req.url, allowed);
      if (req.headers.host !== req.url || head.length) throw Error('ambiguous CONNECT');
      const addresses = await resolve(host);
      if (closed) return;
      if (!Array.isArray(addresses) || !addresses.length || addresses.length > 32
        || addresses.some(entry => entry.family !== 4 || !publicIPv4(entry.address))) throw Error('address denied');
      // Dial the checked numeric address, never re-resolve a hostname after validation.
      upstream = dial({ host: addresses[0].address, port: 443, family: 4 });
      upstream.on('error', finish); upstream.once('close', finish);
      upstream.setTimeout(idleTimeoutMs, finish);
      upstream.once('connect', () => {
        if (closed) return finish();
        clearTimeout(deadline);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        let sent = 0; let received = 0;
        client.on('data', chunk => { if ((sent += chunk.length) > maxBytes) finish(); });
        upstream.on('data', chunk => { if ((received += chunk.length) > maxBytes) finish(); });
        client.pipe(upstream); upstream.pipe(client); client.resume();
      });
    })().catch(() => {
      if (!closed) client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      upstream?.destroy();
    });
  });
  return { server, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
