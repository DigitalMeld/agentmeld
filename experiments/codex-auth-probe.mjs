// Offline proof of the pinned native subscription interface. Never starts login.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const codex = '/opt/agentmeld/node_modules/.bin/codex';
const directory = await mkdtemp('/tmp/agentmeld-auth-');
const home = join(directory, 'home'); await mkdir(home);
const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: join(home, '.codex') };
await mkdir(env.CODEX_HOME);
const schema = join(directory, 'schema');
execFileSync(codex, ['app-server', 'generate-json-schema', '--out', schema], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 1024 * 1024 });
const params = JSON.parse(await readFile(join(schema, 'v2/LoginAccountParams.json'), 'utf8'));
const responses = JSON.parse(await readFile(join(schema, 'v2/LoginAccountResponse.json'), 'utf8'));
const variant = (schema, type) => schema.oneOf.find(entry => entry.properties?.type?.enum?.includes(type));
assert.deepEqual(variant(params, 'chatgptDeviceCode').required, ['type']);
assert.ok(variant(params, 'chatgpt'));
for (const field of ['loginId', 'verificationUrl', 'userCode']) assert.ok(variant(responses, 'chatgptDeviceCode').properties[field]);
const proc = spawn(codex, ['app-server', '--stdio'], { cwd: '/workspace', env, stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = ''; let sequence = 0; const pending = new Map();
let fatal;
const fail = () => { fatal = new Error('native auth protocol unavailable'); for (const request of pending.values()) request.reject(fatal); pending.clear(); proc.kill('SIGKILL'); };
proc.on('error', fail); proc.on('exit', fail); proc.stdin.on('error', fail); proc.stderr.resume();
proc.stdout.on('data', chunk => {
  buffer += chunk.toString(); if (buffer.length > 1024 * 1024) return fail();
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    let frame; try { frame = JSON.parse(line); } catch { return fail(); }
    if (frame.method && frame.id !== undefined) return fail();
    const request = pending.get(frame.id);
    if (request) { pending.delete(frame.id); if (frame.error) request.reject(new Error('native auth request rejected')); else request.resolve(frame.result); }
  }
});
function request(method, params) {
  if (fatal) return Promise.reject(fatal);
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); proc.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
}
const deadline = setTimeout(fail, 15000);
try {
  await request('initialize', { clientInfo: { name: 'agentmeld_m0_auth', version: '0.1.0' } });
  proc.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const account = await request('account/read', { refreshToken: false });
  assert.equal(account.account, null); assert.equal(account.requiresOpenaiAuth, true);
  const report = { phase: 'm0', version: execFileSync(codex, ['--version'], { env, encoding: 'utf8' }).trim(),
    schema: { managedBrowserLogin: true, managedDeviceLogin: true, deviceResponseFields: true,
      externalTokensMarkedInternal: /INTERNAL USE ONLY/.test(variant(params, 'chatgptAuthTokens')?.description ?? '') },
    isolatedEmptyAccount: true, loginStarted: false, credentialsProvided: false, liveInferenceQualified: false };
  console.log(JSON.stringify(report));
} finally {
  clearTimeout(deadline);
  const exited = new Promise(resolve => { if (proc.exitCode !== null || proc.signalCode) resolve(); else proc.once('exit', resolve); });
  proc.stdin.end(); const kill = setTimeout(() => proc.kill('SIGKILL'), 1000); await exited; clearTimeout(kill);
}
