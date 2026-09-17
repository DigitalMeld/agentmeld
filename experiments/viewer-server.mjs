// Offline M0 capability-authenticated viewer. No external listener or password store.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function startViewer(control, { leaseMs = 5000 } = {}) {
  const token = randomBytes(32).toString('hex');
  const credential = Buffer.from(`Bearer ${token}`);
  let origin; let expires = 0; let disconnected = false;
  const assets = {
    '/': ['text/html', await readFile(new URL('./viewer.html', import.meta.url))],
    '/viewer.js': ['text/javascript', await readFile(new URL('./viewer.js', import.meta.url))],
  };
  const server = createServer(async (req, res) => {
    const reply = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    const supplied = Buffer.from(req.headers.authorization || '');
    if (supplied.length !== credential.length || !timingSafeEqual(supplied, credential)) return reply(401, { error: 'unauthorized' });
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return reply(403, { error: 'origin denied' });
    if (req.method !== 'GET' && req.headers.origin !== origin) return reply(403, { error: 'origin required' });
    // An expired viewer is permanently revoked; a new viewer must be explicitly paired.
    if (expires && Date.now() >= expires && !disconnected) {
      disconnected = true;
      control.disconnect().catch(() => {});
    }
    if (disconnected) return reply(410, { error: 'viewer disconnected' });
    expires = Date.now() + leaseMs;
    try {
      if (req.method === 'GET' && assets[req.url]) {
        const [type, body] = assets[req.url];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
        return res.end(body);
      }
      if (req.method === 'GET' && req.url === '/state') return reply(200, control.state());
      if (req.method === 'GET' && req.url === '/frame') {
        const frame = await control.frame();
        if (disconnected || Date.now() >= expires) return reply(410, { error: 'viewer disconnected' });
        return reply(200, frame);
      }
      if (req.method !== 'POST') return reply(404, { error: 'not found' });
      if (req.headers['content-type'] !== 'application/json') return reply(415, { error: 'JSON required' });
      let bytes = 0; const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8192) { reply(413, { error: 'body too large' }); req.destroy(); return; }
        chunks.push(chunk);
      }
      if (disconnected || Date.now() >= expires) return reply(410, { error: 'viewer disconnected' });
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'invalid body' });
      if (req.url === '/takeover') return reply(200, await control.takeover());
      if (req.url === '/cancel') return reply(200, await control.cancel());
      if (req.url === '/disconnect') {
        disconnected = true;
        return reply(200, await control.disconnect());
      }
      if (!Number.isSafeInteger(body.generation)) return reply(400, { error: 'generation required' });
      if (req.url === '/resume') return reply(200, await control.resume(body.generation));
      if (req.url === '/input') {
        if (![body.x, body.y].every(Number.isFinite) || body.x < 0 || body.y < 0 || body.x >= 640 || body.y >= 360) return reply(400, { error: 'coordinates out of bounds' });
        return reply(200, await control.input(body.generation, body.x, body.y));
      }
      return reply(404, { error: 'not found' });
    } catch { if (!res.headersSent) reply(409, { error: 'operation rejected' }); }
  });
  server.requestTimeout = 3000;
  server.headersTimeout = 3000;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const timer = setInterval(() => {
    if (expires && Date.now() >= expires && !disconnected) {
      disconnected = true;
      control.disconnect().catch(() => {});
    }
  }, Math.min(250, leaseMs));
  return {
    origin, token,
    close: async () => {
      clearInterval(timer);
      await control.disconnect();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
