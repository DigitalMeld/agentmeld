// Explicit subscription usage. Reports booleans only; native history contains synthetic fixture data.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, stat, writeFile, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { commandResultEvidence } from './native-command-evidence.mjs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { authHome, validateRuntimeAuthConfig } from './codex-auth-store.mjs';
import { LiveClient } from './codex-live-client.mjs';
const proxy = process.env.AGENTMELD_PROXY_IP; assert.match(proxy, /^\d+\.\d+\.\d+\.\d+$/);
validateRuntimeAuthConfig(await readFile(authHome + '/.codex/config.toml', 'utf8'));
assert.equal(JSON.parse(await readFile(authHome + '/store.json', 'utf8')).instance, process.env.AGENTMELD_STORE_INSTANCE);
const auth = await stat(authHome + '/.codex/auth.json'); assert.equal(auth.uid, 1000); assert.equal(auth.mode & 0o777, 0o600);
const binary = '/opt/agentmeld/node_modules/.bin/codex';
execFileSync(binary, ['sandbox', '-P', 'agentmeld', '-C', '/workspace', '--', 'node', '-e',
  "const fs=require('node:fs'),a=require('node:assert/strict');for(const flags of ['r','r+'])a.throws(()=>{const fd=fs.openSync('/agentmeld-home/.codex/auth.json',flags);fs.closeSync(fd)})"],
{ env: { PATH: process.env.PATH, HOME: authHome, CODEX_HOME: authHome + '/.codex' }, timeout: 10000, stdio: ['ignore','pipe','pipe'] });
const endpoint = `http://${proxy}:8443`;
const start = () => new LiveClient(spawn(binary, ['app-server', '--stdio'], { cwd: '/workspace', env: {
  PATH: process.env.PATH, HOME: authHome, CODEX_HOME: authHome + '/.codex',
  HTTPS_PROXY: endpoint, HTTP_PROXY: endpoint, ALL_PROXY: endpoint, https_proxy: endpoint, http_proxy: endpoint, all_proxy: endpoint,
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
}, stdio: ['pipe','pipe','pipe'] }), 120000);
let client; let stage = 'initialize';
const report = { phase: 'm0', model: 'gpt-5.5', liveInference: true, subscriptionRecognized: false, commandSuccess: false, commandFailure: false, processReplacement: false, conversationContinued: false, apiKeyUsed: false, rawAccountOrOutputRetainedInReport: false };
try {
  client = start(); await client.initialize();
  await client.qualifyModel('gpt-5.5'); report.subscriptionRecognized = true;
  stage = 'model-unavailable';
  await assert.rejects(client.qualifyModel('agentmeld-m0-unavailable-model'), /configured model unavailable in native catalog/);
  report.unavailableModelRejectedBeforeTurn = true;
  stage = 'thread-start';
  const thread = await client.request('thread/start', { cwd: '/workspace', model: 'gpt-5.5', allowProviderModelFallback: false, permissions: 'agentmeld', approvalPolicy: 'on-request', ephemeral: false });
  const nonce = randomUUID();
  const marker = randomUUID();
  stage = 'command-success';
  const success = await client.turn(thread.thread.id, `Remember the conversation-only nonce ${nonce}; do not write it to any file. Run exactly this shell command once: printf '%s' '${marker}' > /workspace/m0-live-marker.txt . The trailing period is sentence punctuation, not part of the command. Then reply DONE. Do not read other files or use other tools.`);
  assert.equal(success.status, 'completed');
  assert.ok(success.items.some(i => i.type === 'commandExecution' && i.exitCode === 0));
  assert.equal(await readFile('/workspace/m0-live-marker.txt', 'utf8'), marker); report.commandSuccess = true;
  stage = 'command-failure';
  await writeFile('/workspace/m0-failure.cjs', "require('node:fs').writeFileSync('/workspace/m0-failure-ran.txt', 'ran');process.exit(23);", { flag: 'wx' });
  const failureThread = await client.request('thread/start', { cwd: '/workspace', model: 'gpt-5.5', allowProviderModelFallback: false, permissions: 'agentmeld', approvalPolicy: 'on-request', ephemeral: false });
  const failure = await client.turn(failureThread.thread.id, 'Use exec_command with cmd exactly equal to node /workspace/m0-failure.cjs to execute this fixture. This fixture intentionally fails; do not infer its result without running it. Do not retry or repair it. Report the observed exit code.');
  report.failureDiagnostic = client.lastDiagnostic; report.failureMarkerExists = await stat('/workspace/m0-failure-ran.txt').then(() => true, () => false); report.deniedCallbacks = client.deniedCallbacks; report.failureTurnCompleted = failure.status === 'completed'; report.failureCommandExitCodes = failure.items.filter(i => i.type === 'commandExecution').map(i => Number.isInteger(i.exitCode) ? i.exitCode : null);
  assert.equal(failure.status, 'completed'); assert.equal(await readFile('/workspace/m0-failure-ran.txt', 'utf8'), 'ran');
  report.commandErrorEvent = failure.items.some(i => i.type === 'commandExecution' && i.exitCode === 23);
  const historyPath = failureThread.thread.path;
  assert.ok(typeof historyPath === 'string' && historyPath.startsWith(authHome + '/.codex/sessions/'));
  assert.equal(await realpath(historyPath), historyPath);
  const history = await open(historyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assert.ok((await history.stat()).size <= 1024 * 1024);
    const bytes = Buffer.alloc(1024 * 1024 + 1);
    const { bytesRead } = await history.read(bytes, 0, bytes.length, 0);
    assert.ok(bytesRead <= 1024 * 1024);
    report.nativeHistoryErrorResult = commandResultEvidence(bytes.subarray(0, bytesRead).toString('utf8'), 'node /workspace/m0-failure.cjs', 23);
  } finally { await history.close(); }
  report.commandFailure = report.nativeHistoryErrorResult;
  stage = 'process-replacement'; await client.close(); client = start(); await client.initialize(); report.processReplacement = true;
  stage = 'thread-resume';
  const resumed = await client.request('thread/resume', { threadId: thread.thread.id, cwd: '/workspace', permissions: 'agentmeld', approvalPolicy: 'on-request', model: 'gpt-5.5' });
  assert.equal(resumed.thread.id, thread.thread.id);
  stage = 'continuation';
  const continued = await client.turn(thread.thread.id, 'Return only the conversation-only nonce from my first message, exactly. Do not use any tools.');
  assert.equal(continued.status, 'completed'); assert.equal(continued.answer.trim(), nonce); assert.ok(continued.streamed);
  assert.ok(!continued.items.some(i => i.type === 'commandExecution')); report.conversationContinued = true;
  validateRuntimeAuthConfig(await readFile(authHome + '/.codex/config.toml', 'utf8'));
} catch (error) { report.failedStage = stage; if (error.reusedTurn) report.reusedTurn = true; if (Number.isInteger(error.rpcCode)) report.rpcCode = error.rpcCode; if (error.experimentalRequired) report.experimentalRequired = true; process.exitCode = 1; }
finally { if (client) await client.close(); }
report.qualified = !report.failedStage && report.commandSuccess && report.commandFailure && report.conversationContinued;
if (!report.qualified) process.exitCode = 1;
console.log(JSON.stringify(report));
