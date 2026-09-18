import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { LiveClient } from './codex-live-client.mjs';
function fixture() {
  const proc = new EventEmitter(); proc.stdin = new PassThrough(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
  proc.exitCode = null; proc.signalCode = null;
  proc.kill = signal => { proc.signalCode = signal; proc.emit('exit', null, signal); };
  const client = new LiveClient(proc, 1000);
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
