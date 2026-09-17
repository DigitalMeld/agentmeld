// One result, one short-lived capability. Trusted host setup; no public listener or user accounts.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export async function startResultServer({ authority, archive, scope, ttlMs = 60000 }) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 300000 || !scope || Object.keys(scope).sort().join(',') !== 'request,thread,turn,worker,workspace' || Object.values(scope).some(value => typeof value !== 'string' || !value || !value.isWellFormed() || Buffer.byteLength(value) > 256)) throw new Error('invalid result access configuration');
  const bound = Object.freeze({ ...scope });
  const token = randomBytes(32).toString('hex'); const credential = Buffer.from(`Bearer ${token}`);
  const expires = performance.now() + ttlMs;
  let origin; let revoked = false; let active = false; let closing;
  const unavailable = () => revoked || performance.now() >= expires;
  const server = createServer(async (req, res) => {
    const reply = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      });
      res.end(JSON.stringify(value));
    };
    const supplied = Buffer.from(req.headers.authorization || '');
    if (supplied.length !== credential.length || !timingSafeEqual(supplied, credential)) return reply(401, { error: 'unauthorized' });
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return reply(403, { error: 'origin denied' });
    if (unavailable()) return reply(410, { error: 'result access revoked or expired' });
    if (req.method !== 'GET') return reply(405, { error: 'read-only endpoint' });
    if (req.url !== '/result') return reply(404, { error: 'not found' });
    if (active) return reply(429, { error: 'result read in progress' });
    active = true;
    try {
      const record = await archive.readSettled(authority, bound);
      if (unavailable()) return reply(410, { error: 'result access revoked or expired' });
      return reply(200, { tool: record.action.tool, result: record.value });
    } catch {
      return reply(unavailable() ? 410 : 409, { error: 'result unavailable' });
    } finally { active = false; }
  });
  server.requestTimeout = 3000; server.headersTimeout = 3000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const revoke = () => { revoked = true; };
  return {
    origin, token, revoke,
    close: () => {
      if (!closing) {
        revoke(); server.closeAllConnections();
        closing = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
      return closing;
    },
  };
}
