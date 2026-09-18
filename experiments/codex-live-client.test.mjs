import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { LiveClient } from './codex-live-client.mjs';
function fixture(onRequest) {
  const proc = new EventEmitter(); proc.stdin = new PassThrough(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
  proc.exitCode = null; proc.signalCode = null;
  proc.kill = signal => { proc.signalCode = signal; proc.emit('exit', null, signal); };
  const client = new LiveClient(proc, 1000, onRequest);
  const send = f => proc.stdout.write(JSON.stringify(f) + '\n');
  return { proc, client, send };
}
test('live turn binds completion and output to both thread and turn, including early events', async () => {
  const { client, send } = fixture();
  try {
    const turn = client.turn('t', 'synthetic');
    send({ method: 'turn/completed', params: { threadId: 'other', turn: { id: 'a', status: 'failed' } } });
    send({ method: 'item/completed', params: { threadId: 'other', turnId: 'a', item: { type: 'agentMessage', text: 'wrong' } } });
    send({ method: 'item/completed', params: { threadId: 't', turnId: 'old', item: { type: 'agentMessage', text: 'stale' } } });
    send({ method: 'item/agentMessage/delta', params: { threadId: 't', turnId: 'a', delta: 'ok' } });
    send({ method: 'item/completed', params: { threadId: 't', turnId: 'a', item: { type: 'agentMessage', text: 'ok' } } });
    send({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'a', status: 'completed' } } });
    send({ id: 1, result: { turn: { id: 'a' } } });
    assert.deepEqual(await turn, { status: 'completed', answer: 'ok', streamed: true, items: [{ type: 'agentMessage', text: 'ok' }] });
  } finally { await client.close(); }
});
test('unexpected server callback never receives approval', async () => {
  const { client, proc, send } = fixture(); let response = '';
  proc.stdin.on('data', d => response += d);
  try { send({ id: 88, method: 'item/commandExecution/requestApproval', params: {} }); assert.equal(JSON.parse(response).error.code, -32601); }
  finally { await client.close(); }
});
test('malformed native output rejects pending RPC and prevents reuse', async () => {
  const { client, proc } = fixture();
  try { const result = client.request('x', {}); proc.stdout.write('not json\n'); await assert.rejects(result, /unavailable/); await assert.rejects(client.request('x', {}), /unavailable/); }
  finally { await client.close(); }
});
test('process exit rejects notification wait and RPC without native details', async () => {
  const { client, proc } = fixture();
  try { const result = client.request('x', {}); const event = client.wait(() => false); proc.kill('SIGKILL'); await assert.rejects(result, /unavailable/); await assert.rejects(event, /unavailable/); }
  finally { await client.close(); }
});
test('reused turn identity cannot satisfy a new probe from cached completion', async () => {
  const { client, send } = fixture();
  try {
    client.lastTurnId = 'old';
    const result = client.turn('t', 'new');
    send({ id: 1, result: { turn: { id: 'old' } } });
    await assert.rejects(result, /reused completed turn/);
  } finally { await client.close(); }
});
test('explicit callback handler responds only after its asynchronous decision', async () => {
  let decide; const decision = new Promise(resolve => { decide = resolve; });
  const { client, proc, send } = fixture(() => decision); let response = '';
  proc.stdin.on('data', chunk => response += chunk);
  try {
    send({ id: 9, method: 'item/tool/call', params: {} });
    await Promise.resolve(); assert.equal(response, '');
    decide({ success: false, contentItems: [] }); await Promise.all([...client.callbackTasks]);
    assert.deepEqual(JSON.parse(response), { id: 9, result: { success: false, contentItems: [] } });
  } finally { await client.close(); }
});
test('duplicate callback transport identity fails closed before a second handler call', async () => {
  let calls = 0; let decide; const decision = new Promise(resolve => { decide = resolve; });
  const { client, send } = fixture(async () => { calls++; return decision; });
  try {
    send({ id: 9, method: 'item/tool/call', params: {} }); await Promise.resolve();
    send({ id: 9, method: 'item/tool/call', params: {} });
    assert.equal(client.failed, true); assert.equal(calls, 1);
    decide({ success: true }); await Promise.all([...client.callbackTasks]);
  } finally { await client.close(); }
});
test('handler failure terminates the probe and rejects native waits', async () => {
  const { client, send } = fixture(async () => { throw Error('private diagnostic'); });
  try {
    const waiting = client.wait(() => false);
    send({ id: 9, method: 'item/tool/call', params: {} });
    await assert.rejects(waiting, /native probe unavailable/);
  } finally { await client.close(); }
});
test('queued callback cannot begin after protocol failure', async () => {
  let calls = 0; const { client, send } = fixture(async () => { calls++; return {}; });
  try {
    send({ id: 9, method: 'item/tool/call', params: {} });
    send({ id: 9, method: 'item/tool/call', params: {} });
    await Promise.all([...client.callbackTasks]);
    assert.equal(client.failed, true); assert.equal(calls, 0);
  } finally { await client.close(); }
});
test('missing subscription prevents model selection and turn startup', async () => {
  const { client, send } = fixture();
  try {
    const result = client.qualifyModel('gpt-5.5');
    send({ id: 1, result: { account: null, requiresOpenaiAuth: true } });
    await assert.rejects(result, /subscription required/);
    assert.equal(client.sequence, 1); assert.equal(client.pending.size, 0);
  } finally { await client.close(); }
});
test('unavailable configured model rejects without fallback or turn startup', async () => {
  const { client, send } = fixture();
  try {
    const result = client.qualifyModel('unavailable-model');
    send({ id: 1, result: { account: { type: 'chatgpt' } } }); await Promise.resolve();
    send({ id: 2, result: { data: [{ model: 'gpt-5.5' }] } });
    await assert.rejects(result, /unavailable/); assert.equal(client.sequence, 2);
  } finally { await client.close(); }
});
test('catalog admission requires an exact available model', async () => {
  const { client, send } = fixture();
  try {
    const result = client.qualifyModel('gpt-5.5');
    send({ id: 1, result: { account: { type: 'chatgpt' } } }); await Promise.resolve();
    send({ id: 2, result: { data: [{ model: 'gpt-5.5' }] } });
    assert.deepEqual(await result, { subscription: true, model: 'gpt-5.5' });
  } finally { await client.close(); }
});
test('native thread creation and resume cannot silently substitute a model', async () => {
  for (const method of ['thread/start', 'thread/resume']) {
    const { client, send } = fixture();
    try {
      const result = client.request(method, { model: 'gpt-5.5' });
      send({ id: 1, result: { model: 'other' } });
      await assert.rejects(result, /model mismatch/);
    } finally { await client.close(); }
  }
});
test('native model rerouting terminates the probe and rejects pending work', async () => {
  const { client, send } = fixture();
  try {
    const result = client.request('turn/start', {});
    send({ method: 'model/rerouted', params: { fromModel: 'gpt-5.5', toModel: 'other' } });
    await assert.rejects(result, /unavailable/); assert.equal(client.failed, true);
  } finally { await client.close(); }
});
