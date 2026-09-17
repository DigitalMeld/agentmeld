// Real Codex process, synthetic Responses stream. No external model or credentials.
import { toolSchemas } from './tool-contract.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

function latch() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
export async function startNativeFixture(tool = 'fixture_sum') {
  if (!Object.hasOwn(toolSchemas, tool)) throw new Error('unsupported fixture tool');
  const home = `/tmp/native-${randomUUID()}`;
  await mkdir(home + '/.codex', { recursive: true });
  let modelRequests = 0; let toolOutputSeen = false;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/responses')) { res.writeHead(404); res.end(); return; }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) { req.destroy(); return; } chunks.push(chunk); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks)); } catch { res.writeHead(400); res.end(); return; }
    if (++modelRequests > 2) { res.writeHead(429); res.end(); return; }
    const returned = (body.input || []).find(item => item.type === 'function_call_output');
    toolOutputSeen ||= Boolean(returned);
    const item = returned
      ? { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Fixture complete.' }] }
      : { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: tool, arguments: tool === 'fixture_sum' ? '{"a":2,"b":3}' : '{}' };
    const response = { id: `resp_${modelRequests}`, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of [{ type: 'response.created', response: { id: response.id } }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const proc = spawn('/opt/agentmeld/node_modules/.bin/codex', ['app-server', '--stdio', '-c', 'model_provider="m0"', '-c', 'model="fixture-model"', '-c', `model_providers.m0={name="M0 fixture",base_url="${base}",wire_api="responses",requires_openai_auth=false}`, '-c', 'model_reasoning_effort="low"'], { cwd: '/workspace', env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home + '/.codex' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let sequence = 0; let buffer = ''; let stderr = ''; let toolRequest; let threadId; let turnId;
  const called = latch(); const completed = latch();
  function fail(error) { called.reject(error); completed.reject(error); for (const waiter of pending.values()) waiter.reject(error); pending.clear(); }
  proc.on('error', fail); proc.on('exit', () => fail(new Error(`native process exited: ${stderr.slice(-800)}`)));
  proc.stdin.on('error', fail);
  proc.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
  proc.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (buffer.length > 1024 * 1024) { fail(new Error('native output limit')); proc.kill(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let frame; try { frame = JSON.parse(line); } catch { fail(new Error('native invalid JSON')); return; }
      if (frame.method && frame.id !== undefined) {
        if (frame.method === 'item/tool/call' && !toolRequest) { toolRequest = frame; called.resolve(frame); }
        else proc.stdin.write(JSON.stringify({ id: frame.id, error: { code: -32601, message: 'M0 request denied' } }) + '\n');
      } else if (pending.has(frame.id)) {
        const waiter = pending.get(frame.id); pending.delete(frame.id);
        if (frame.error) waiter.reject(new Error(JSON.stringify(frame.error))); else waiter.resolve(frame.result);
      } else if (frame.method === 'turn/completed') completed.resolve(frame.params.turn);
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout: ${stderr.slice(-800)}`)); }, 10000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const deadline = setTimeout(() => { fail(new Error('native fixture deadline')); proc.kill(); }, 25000);
  const close = async () => {
    clearTimeout(deadline); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    proc.stdin.end(); proc.kill('SIGTERM');
    const kill = setTimeout(() => proc.kill('SIGKILL'), 1000);
    await new Promise(resolve => { if (proc.exitCode !== null || proc.signalCode) resolve(); else proc.once('exit', resolve); }); clearTimeout(kill);
  };
  try {
    await request('initialize', { clientInfo: { name: 'agentmeld_m0', title: 'AgentMeld M0', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    proc.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const thread = await request('thread/start', { cwd: '/workspace', model: 'fixture-model', modelProvider: 'm0', sandbox: 'read-only', approvalPolicy: 'untrusted', ephemeral: true, dynamicTools: [{ type: 'function', name: tool, description: 'Explicit M0 fixture tool', inputSchema: toolSchemas[tool] }] });
    threadId = thread.thread.id;
    const turn = await request('turn/start', { threadId, input: [{ type: 'text', text: tool === 'fixture_sum' ? 'Use fixture_sum on 2 and 3.' : 'List the workspace with workspace_list.', text_elements: [] }] });
    turnId = turn.turn.id;
    const frame = await called.promise;
    return {
      frame, threadId, turnId,
      finish: async result => {
        proc.stdin.write(JSON.stringify({ id: frame.id, result }) + '\n');
        const turn = await completed.promise;
        const children = (await readFile(`/proc/${proc.pid}/task/${proc.pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean);
        if (children.length !== 1 || !(await readlink(`/proc/${children[0]}/exe`)).endsWith('/bin/codex')) throw new Error('native process identity unavailable');
        const peak = async pid => {
          const status = await readFile(`/proc/${pid}/status`, 'utf8');
          const value = Number(status.match(/VmHWM:\s+(\d+)/)?.[1]);
          if (!Number.isFinite(value) || value <= 0) throw new Error('native peak memory unavailable');
          return value;
        };
        return { turnStatus: turn.status, modelRequests, toolOutputSeen, nativeVmHwmKiB: await peak(children[0]), launcherVmHwmKiB: await peak(proc.pid), liveInference: false };
      }, close,
    };
  } catch (error) { await close(); throw error; }
}
