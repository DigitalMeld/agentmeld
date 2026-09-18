// Explicit subscription usage. Reports booleans only; native history contains synthetic fixture data.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, stat, writeFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeToolBroker } from './native-tool-broker.mjs';
import { RustAuthority } from './rust-browser-control.mjs';
import { toolSchemas } from './tool-contract.mjs';
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
const start = onRequest => new LiveClient(spawn(binary, ['app-server', '--stdio'], { cwd: '/workspace', env: {
  PATH: process.env.PATH, HOME: authHome, CODEX_HOME: authHome + '/.codex',
  HTTPS_PROXY: endpoint, HTTP_PROXY: endpoint, ALL_PROXY: endpoint, https_proxy: endpoint, http_proxy: endpoint, all_proxy: endpoint,
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
}, stdio: ['pipe','pipe','pipe'] }), 120000, onRequest);
let client; let authority; let stage = 'initialize'; let expectedThread; let scenario; let calls = 0; let callbacks = 0;
const report = { phase: 'm0', liveInference: true, model: 'gpt-5.5', approvedOnce: false, deniedWithoutExecution: false, interruptedPendingApproval: false, interruptedAndCleanedRunningCommand: false, rawAccountOrOutputRetained: false };
try {
  authority = await RustAuthority.open('/usr/local/bin/agentmeld-m0', authHome + '/control-' + randomUUID() + '.jsonl');
  client = start(async frame => {
    assert.equal(frame.params?.threadId, expectedThread);
    assert.ok(client.events.some(f => f.method === 'turn/started' && f.params?.threadId === expectedThread && f.params?.turn?.id === frame.params.turnId));
    assert.equal(callbacks++, 0);
    const broker = new NativeToolBroker(authority, { request: async (tool, args) => {
      assert.equal(tool, 'fixture_sum'); assert.deepEqual(args, { a: 2, b: 3 }); calls++; return { sum: 5 };
    } }, { workspace: 'live-control', worker: 'live-worker', thread: expectedThread, turn: frame.params.turnId }, ['fixture_sum']);
    const proposal = await broker.propose(frame);
    assert.deepEqual(proposal.arguments, { a: 2, b: 3 });
    assert.equal(calls, 0);
    if (scenario === 'interrupt') {
      await authority.request({ op: 'cancel' });
      assert.equal(authority.current.approval, null);
      await client.request('turn/interrupt', { threadId: expectedThread, turnId: frame.params.turnId });
    }
    assert.ok(!client.failed && !client.closing);
    const result = await broker.decide(proposal.id, scenario !== 'deny');
    assert.equal(result.success, scenario === 'allow');
    await assert.rejects(broker.decide(proposal.id, true));
    return result;
  });
  await client.initialize();
  await client.qualifyModel('gpt-5.5');
  for (scenario of ['allow', 'deny', 'interrupt']) {
    stage = scenario; calls = 0; callbacks = 0;
    const thread = await client.request('thread/start', { cwd: '/workspace', model: 'gpt-5.5', allowProviderModelFallback: false, permissions: 'agentmeld', approvalPolicy: 'on-request', ephemeral: true,
      dynamicTools: [{ type: 'function', name: 'fixture_sum', description: 'Use this fixture tool exactly once to add two integers. Do not calculate the result yourself.', inputSchema: toolSchemas.fixture_sum }] });
    expectedThread = thread.thread.id;
    const turn = await client.turn(expectedThread, 'Call fixture_sum exactly once with a=2 and b=3. Do not use other tools or compute the answer yourself. If denied, report the denial without retrying.');
    await Promise.all([...client.callbackTasks]);
    assert.equal(client.failed, undefined); assert.equal(callbacks, 1);
    assert.equal(calls, scenario === 'allow' ? 1 : 0);
    assert.equal(turn.status, scenario === 'interrupt' ? 'interrupted' : 'completed');
    assert.equal(authority.current.approval, null);
    if (scenario === 'allow') report.approvedOnce = true;
    if (scenario === 'deny') report.deniedWithoutExecution = true;
    if (scenario === 'interrupt') report.interruptedPendingApproval = true;
  }
  stage = 'interrupt-running-command';
  const run = randomUUID(); const script = '/workspace/live-cancel-' + run + '.cjs';
  const parentFile = '/workspace/parent-' + run; const childFile = '/workspace/child-' + run;
  await writeFile(script, `const fs=require('node:fs');const child=process.argv[2]==='child';
if(!child)require('node:child_process').spawn(process.execPath,[__filename,'child'],{stdio:'ignore'});
const file=child?${JSON.stringify(childFile)}:${JSON.stringify(parentFile)};let tick=0;
fs.writeFileSync(file,String(tick));setInterval(()=>fs.writeFileSync(file,String(++tick)),50);
setTimeout(()=>process.exit(0),60000);`, { flag: 'wx' });
  const running = await client.request('thread/start', { cwd: '/workspace', model: 'gpt-5.5', allowProviderModelFallback: false, permissions: 'agentmeld', approvalPolicy: 'on-request', ephemeral: true });
  expectedThread = running.thread.id;
  const turnPromise = client.turn(expectedThread, `Run node ${script} with exec_command. It is a bounded cancellation fixture. Let it keep running until interrupted. Do not edit files or use other commands.`);
  turnPromise.catch(() => {});
  report.runningCheckpoint = 'waiting-for-child';
  let ready = false;
  for (let i = 0; i < 400; i++) {
    if (client.failed) throw Error('native lost');
    if (await stat(childFile).then(() => true, () => false)) { ready = true; break; }
    await delay(50);
  }
  assert.ok(ready);
  report.runningCheckpoint = 'tracking-processes';
  const tracked = [];
  for (const pid of (await readdir('/proc')).filter(p => /^\d+$/.test(p))) {
    const cmd = await readFile('/proc/' + pid + '/cmdline', 'utf8').catch(() => '');
    if (cmd.includes(script)) tracked.push(pid);
  }
  assert.ok(tracked.length >= 2);
  const active = client.events.find(f => f.method === 'turn/started' && f.params?.threadId === expectedThread);
  assert.ok(active);
  report.runningCheckpoint = 'requesting-interruption';
  await client.request('turn/interrupt', { threadId: expectedThread, turnId: active.params.turn.id });
  assert.equal((await turnPromise).status, 'interrupted');
  report.runningCheckpoint = 'cleaning-background-terminals';
  await client.request('thread/backgroundTerminals/clean', { threadId: expectedThread });
  report.backgroundTerminalCleanupRequested = true;
  report.runningCheckpoint = 'verifying-stopped-processes';
  await delay(300);
  const before = await Promise.all([readFile(parentFile, 'utf8'), readFile(childFile, 'utf8')]);
  await delay(300);
  assert.deepEqual(await Promise.all([readFile(parentFile, 'utf8'), readFile(childFile, 'utf8')]), before);
  for (const pid of tracked) {
    const status = await readFile('/proc/' + pid + '/status', 'utf8').catch(() => '');
    assert.ok(status === '' || /^State:\s+Z/m.test(status));
  }
  report.runningCheckpoint = 'complete';
  report.interruptedAndCleanedRunningCommand = true;
} catch { report.failedStage = stage; process.exitCode = 1; }
finally { if (client) await client.close(); if (authority) await authority.close(); }
report.qualified = !report.failedStage && report.approvedOnce && report.deniedWithoutExecution && report.interruptedPendingApproval && report.interruptedAndCleanedRunningCommand;
if (!report.qualified) process.exitCode = 1;
console.log(JSON.stringify(report));
