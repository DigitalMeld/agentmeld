// Offline proof of the pinned native subscription interface. Never starts login.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { LiveClient } from './codex-live-client.mjs';
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
const client = new LiveClient(proc, 15000);
try {
  await client.initialize();
  const account = await client.request('account/read', { refreshToken: false });
  assert.equal(account.account, null); assert.equal(account.requiresOpenaiAuth, true);
  await assert.rejects(client.qualifyModel('gpt-5.5'), /ChatGPT subscription required/);
  const report = { phase: 'm0', version: execFileSync(codex, ['--version'], { env, encoding: 'utf8' }).trim(),
    schema: { managedBrowserLogin: true, managedDeviceLogin: true, deviceResponseFields: true,
      externalTokensMarkedInternal: /INTERNAL USE ONLY/.test(variant(params, 'chatgptAuthTokens')?.description ?? '') },
    isolatedEmptyAccount: true, missingSubscriptionRejectedBeforeTurn: true, loginStarted: false, credentialsProvided: false, liveInferenceQualified: false };
  console.log(JSON.stringify(report));
} finally { await client.close(); }
