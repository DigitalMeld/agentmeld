// Offline native lifecycle fixture. All tokens are synthetic and all endpoints are loopback.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { LiveClient } from './codex-live-client.mjs';
const root = await mkdtemp('/tmp/auth-lifecycle-');
const jwt = payload => Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.fixture';
const idToken = jwt({ email: 'fixture@example.invalid', 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account', chatgpt_plan_type: 'pro' } });
let mode = 'success'; let refreshes = 0; let revocations = 0; let invalidRequests = 0;
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) { req.destroy(); return; } }
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/oauth/token') {
    refreshes++;
    try { const parsed = JSON.parse(body); assert.equal(parsed.grant_type, 'refresh_token'); assert.ok(parsed.refresh_token.startsWith('fixture-')); } catch { invalidRequests++; }
    res.writeHead(mode === 'expired' ? 401 : mode === 'transient' ? 429 : 200);
    res.end(JSON.stringify(mode === 'expired' ? { error: { code: 'refresh_token_expired' } } : mode === 'transient' ? { error: { code: 'rate_limit_exceeded' } } : { id_token: idToken, access_token: 'fixture-access-new', refresh_token: 'fixture-refresh-new' }));
  } else if (req.method === 'POST' && req.url === '/oauth/revoke') {
    revocations++; res.end('{}');
  } else { invalidRequests++; res.writeHead(404); res.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = 'http://127.0.0.1:' + server.address().port;
const report = { phase: 'm0', realCredentials: false, liveInference: false, loopbackOnly: true };
let client; let stage = 'initialize';
try {
  for (mode of ['success', 'expired', 'transient']) {
    const home = root + '/' + mode; await mkdir(home + '/.codex', { recursive: true });
    const path = home + '/.codex/auth.json';
    await writeFile(home + '/.codex/config.toml', 'cli_auth_credentials_store="file"\nforced_login_method="chatgpt"\n');
    await writeFile(path, JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken, access_token: 'fixture-access-old', refresh_token: 'fixture-refresh-old', account_id: 'fixture-account' }, last_refresh: new Date().toISOString() }), { mode: 0o600 });
    client = new LiveClient(spawn('/opt/agentmeld/node_modules/.bin/codex', ['app-server', '--stdio'], { env: {
      PATH: process.env.PATH, HOME: home, CODEX_HOME: home + '/.codex',
      CODEX_REFRESH_TOKEN_URL_OVERRIDE: endpoint + '/oauth/token', CODEX_REVOKE_TOKEN_URL_OVERRIDE: endpoint + '/oauth/revoke',
    }, stdio: ['pipe', 'pipe', 'pipe'] }), 15000);
    await client.initialize(); stage = mode + '-account';
    assert.equal((await client.request('account/read', { refreshToken: false })).account?.type, 'chatgpt');
    const before = refreshes; stage = mode + '-refresh';
    // Legacy native status exposes only synthetic fixture tokens here, never a retained account.
    const status = await client.request('getAuthStatus', { includeToken: true, refreshToken: true });
    assert.equal(refreshes, before + 1);
    if (mode === 'success') {
      assert.equal(status.authToken, 'fixture-access-new');
      const persisted = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(persisted.tokens.refresh_token, 'fixture-refresh-new');
      assert.equal(persisted.tokens.access_token, 'fixture-access-new');
      report.refreshPersisted = true;
      stage = 'logout'; await client.request('account/logout', {});
      assert.equal((await client.request('account/read', { refreshToken: false })).account, null);
      assert.equal(await stat(path).then(() => true, () => false), false); assert.ok(revocations > 0);
      report.logoutClearedNativeStore = true; report.revocationRequested = true;
    } else if (mode === 'transient') {
      assert.equal(status.authToken, 'fixture-access-old');
      assert.equal(JSON.parse(await readFile(path, 'utf8')).tokens.refresh_token, 'fixture-refresh-old');
      mode = 'success';
      const retry = await client.request('getAuthStatus', { includeToken: true, refreshToken: true });
      assert.equal(retry.authToken, 'fixture-access-new'); assert.equal(refreshes, before + 2);
      report.transientFailurePreservedSession = true; report.transientRetryRecovered = true;
    } else {
      assert.equal(status.authToken, null); assert.equal(status.requiresOpenaiAuth, true);
      const again = await client.request('getAuthStatus', { includeToken: true, refreshToken: true });
      assert.equal(again.authToken, null); assert.equal(refreshes, before + 1);
      report.expiredTokenWithheld = true; report.permanentFailureNotRetried = true;
    }
    await client.close(); client = null;
  }
  assert.equal(invalidRequests, 0); report.qualified = true;
} catch { report.failedStage = stage; process.exitCode = 1; }
finally { if (client) await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
console.log(JSON.stringify(report));
