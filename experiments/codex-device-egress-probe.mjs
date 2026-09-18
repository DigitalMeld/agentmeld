// Unauthenticated device challenge + immediate cancellation. Never prints codes or starts inference.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { authConfig } from './codex-auth-store.mjs';
import assert from 'node:assert/strict';
const home = '/tmp/device-home'; const proxy = process.env.AGENTMELD_PROXY_IP;
assert.match(proxy, /^\d+\.\d+\.\d+\.\d+$/);
await mkdir(home + '/.codex', { recursive: true, mode: 0o700 });
await writeFile(home + '/.codex/config.toml', authConfig.replaceAll('/agentmeld-home', home), { mode: 0o600, flag: 'wx' });
const endpoint = `http://${proxy}:8443`;
const proc = spawn('/opt/agentmeld/node_modules/.bin/codex', ['app-server', '--stdio'], {
  cwd: '/workspace', env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home + '/.codex', HTTPS_PROXY: endpoint, HTTP_PROXY: endpoint, ALL_PROXY: endpoint, https_proxy: endpoint, http_proxy: endpoint, all_proxy: endpoint, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, stdio: ['pipe', 'pipe', 'pipe'],
});
let rejection = null;
let stage = 'initialize'; let buffer = ''; let sequence = 0; let closing = false; let failed = false;
const pending = new Map();
const fail = () => { if (closing) return; failed = true; for (const item of pending.values()) item.reject(Error('native unavailable')); pending.clear(); proc.kill('SIGKILL'); };
proc.on('error', fail); proc.on('exit', fail); proc.stdin.on('error', fail);
// Native diagnostics can include authorization details. Consume without retaining them.
proc.stderr.resume();
proc.stdout.on('data', chunk => {
  buffer += chunk.toString(); if (Buffer.byteLength(buffer) > 1024 * 1024) return fail();
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    let frame; try { frame = JSON.parse(line); } catch { return fail(); }
    if (frame.method && frame.id !== undefined) return fail();
    const item = pending.get(frame.id);
    if (item) {
      pending.delete(frame.id);
      if (frame.error) {
        const message = String(frame.error.message ?? '');
        rejection = { rpcCode: Number.isInteger(frame.error.code) ? frame.error.code : null,
          forbidden: /403|forbidden/i.test(message), rateLimited: /429|rate.limit/i.test(message),
          tlsFailure: /certificate|tls|ssl/i.test(message), connectionFailure: /connect|send.request|network/i.test(message),
          unsupportedMethod: /method.not.found|unknown.method/i.test(message),
          deviceRequestFailed: message.startsWith('failed to request device code:'),
          responseDecode: /expected|missing.field|line.*column|deserialize/i.test(message),
          unsupported: /unsupported|not.supported|not.enabled/i.test(message),
          timeout: /timeout|timed.out/i.test(message),
          requestBuild: /build|invalid.proxy|invalid.url/i.test(message),
          filesystem: /permission|no.such|read.only|file/i.test(message),
          httpStatuses: [400,401,403,404,407,408,429,500,502,503,504].filter(status => message.includes(String(status))) };
        item.reject(Error('native request rejected'));
      } else item.resolve(frame.result);
    }
  }
});
const request = (method, params) => {
  if (failed) return Promise.reject(Error('native unavailable'));
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); proc.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
};
const deadline = setTimeout(fail, 30000);
try {
  await request('initialize', { clientInfo: { name: 'agentmeld_m0_device_egress', version: '0.1.0' } });
  proc.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  stage = 'logged-out-preflight';
  const before = await request('account/read', { refreshToken: false });
  assert.ok(before.account === null && before.requiresOpenaiAuth === true);
  stage = 'device-challenge';
  const challenge = await request('account/login/start', { type: 'chatgptDeviceCode' });
  assert.ok(typeof challenge.loginId === 'string' && challenge.loginId.length > 0);
  // Cancel immediately; never reveal the code or visit the verification URL.
  stage = 'cancel-challenge';
  const canceled = await request('account/login/cancel', { loginId: challenge.loginId });
  assert.ok(canceled.status === 'canceled');
  assert.ok(challenge.type === 'chatgptDeviceCode' && typeof challenge.userCode === 'string' && challenge.userCode.length > 0);
  assert.ok(new URL(challenge.verificationUrl).protocol === 'https:');
  stage = 'logged-out-readback';
  const after = await request('account/read', { refreshToken: false });
  assert.ok(after.account === null && after.requiresOpenaiAuth === true);
  const repeated = await request('account/login/cancel', { loginId: challenge.loginId });
  assert.ok(repeated.status === 'notFound');
  let authFileAbsent = false; try { await access(home + '/.codex/auth.json'); } catch (e) { if (e.code !== 'ENOENT') throw e; authFileAbsent = true; }
  assert.ok(authFileAbsent);
  console.log(JSON.stringify({ phase: 'm0', nativeDeviceChallenge: true, immediatelyCanceled: true, repeatedCancelNotFound: true, loggedOutReadback: true, authFileAbsent: true, codeRetained: false, ownerLoginCompleted: false, credentialsUsed: false, liveInference: false }));
} catch {
  console.log(JSON.stringify({ phase: 'm0', failedStage: stage, rejection, nativeDeviceEgressQualified: false, sensitiveOutputRetained: false, ownerLoginCompleted: false, liveInference: false }));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline); closing = true;
  const exited = new Promise(resolve => { if (proc.exitCode !== null || proc.signalCode) resolve(); else proc.once('exit', resolve); });
  proc.stdin.end(); proc.kill('SIGTERM'); const kill = setTimeout(() => proc.kill('SIGKILL'), 1000); await exited; clearTimeout(kill);
}
