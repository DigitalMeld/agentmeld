// Explicit subscription usage. Reports booleans only; native history contains synthetic fixture data.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, stat, writeFile, open, statfs } from 'node:fs/promises';


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
const instance = process.env.AGENTMELD_QUOTA_INSTANCE;
assert.match(instance, /^[a-f0-9-]{36}$/);
const mode = process.env.AGENTMELD_WORKSPACE_STAGE; assert.ok(['write', 'read'].includes(mode));
const recordPath = authHome + '/workspace-probe-' + instance + '.json';
const report = { phase: 'm0', liveInference: true, mode, boundedWorkspace: false, nativeCommand: false, workspacePreserved: false, conversationPreserved: false, rawAccountOrOutputRetained: false };
try {
  const fs = await statfs('/workspace'); const capacity = fs.bsize * fs.blocks;
  assert.ok(capacity > 32 * 1024 * 1024 && capacity <= 64 * 1024 * 1024); report.boundedWorkspace = true; report.capacityBytes = capacity;
  assert.equal(await readFile('/workspace/retained.txt', 'utf8'), 'retained-' + instance);
  assert.equal(await readFile('/workspace/recovered.txt', 'utf8'), 'writes recovered');
  client = start(); await client.initialize();
  await client.qualifyModel('gpt-5.5');
  if (mode === 'write') {
    stage = 'write';
    const nonce = randomUUID();
    const thread = await client.request('thread/start', { cwd: '/workspace', model: 'gpt-5.5', allowProviderModelFallback: false, permissions: 'agentmeld', approvalPolicy: 'on-request', ephemeral: false });
    const turn = await client.turn(thread.thread.id, `Remember the conversation-only nonce ${nonce}; do not write it to disk. Execute printf '%s' '${instance}' > /workspace/live-marker.txt using your shell tool, then reply DONE.`);
    assert.equal(turn.status, 'completed'); assert.ok(turn.items.some(i => i.type === 'commandExecution' && i.exitCode === 0));
    assert.equal(await readFile('/workspace/live-marker.txt', 'utf8'), instance);
    const marker = await open('/workspace/live-marker.txt', 'r'); try { await marker.sync(); } finally { await marker.close(); }
    const record = await open(recordPath, 'wx', 0o600);
    try { await record.writeFile(JSON.stringify({ instance, thread: thread.thread.id, nonce })); await record.sync(); } finally { await record.close(); }
    report.nativeCommand = true;
  } else {
    stage = 'resume';
    assert.equal(await readFile('/workspace/live-marker.txt', 'utf8'), instance);
    const record = JSON.parse(await readFile(recordPath, 'utf8')); assert.equal(record.instance, instance);
    const thread = await client.request('thread/resume', { threadId: record.thread, cwd: '/workspace', model: 'gpt-5.5', permissions: 'agentmeld', approvalPolicy: 'on-request' });
    assert.equal(thread.thread.id, record.thread);
    const turn = await client.turn(record.thread, 'Run cat /workspace/live-marker.txt using your shell tool. Then return only two lines: the file contents, then the conversation-only nonce from my earlier message. Do not write files.');
    assert.equal(turn.status, 'completed'); assert.ok(turn.items.some(i => i.type === 'commandExecution' && i.exitCode === 0));
    assert.equal(turn.answer.trim(), instance + '\n' + record.nonce);
    report.nativeCommand = true; report.conversationPreserved = true;
  }
  assert.equal(await readFile('/workspace/retained.txt', 'utf8'), 'retained-' + instance);
  assert.equal(await readFile('/workspace/recovered.txt', 'utf8'), 'writes recovered');
  report.workspacePreserved = true;
} catch { report.failedStage = stage; process.exitCode = 1; }
finally { if (client) await client.close(); }
report.qualified = !report.failedStage && report.boundedWorkspace && report.nativeCommand && report.workspacePreserved && (mode === 'write' || report.conversationPreserved);
if (!report.qualified) process.exitCode = 1;
console.log(JSON.stringify(report));
