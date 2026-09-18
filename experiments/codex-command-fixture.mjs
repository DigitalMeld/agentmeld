// Explicit offline native command probe. The only model is a loopback synthetic stream.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

export async function runCommandFixture({ home, command }) {
  let requests = 0; let toolOutputSeen = false; let selectedTool;
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; }); done.catch(() => {});
  const server = createServer((req, res) => {
    (async () => {
      if (req.method !== 'POST' || !req.url.endsWith('/responses')) { res.writeHead(404); res.end(); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) { if ((size += chunk.length) > 2 * 1024 * 1024) throw Error('model request limit'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks));
      if (++requests > 2) throw Error('model turn limit');
      const returned = body.input?.find(item => item.type === 'function_call_output');
      toolOutputSeen ||= Boolean(returned);
      const names = body.tools?.map(tool => tool.name ?? tool.function?.name) ?? [];
      selectedTool ??= names.includes('exec_command') ? 'exec_command' : names.includes('shell_command') ? 'shell_command' : null;
      if (!selectedTool) throw Error('native command tool absent');
      const args = selectedTool === 'exec_command'
        ? { cmd: command, yield_time_ms: 1000, max_output_tokens: 1000 }
        : { command, timeout_ms: 10000, workdir: '/workspace' };
      const item = returned
        ? { type: 'message', id: 'msg_boundary', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Boundary fixture complete.' }] }
        : { type: 'function_call', id: 'fc_boundary', call_id: 'call_boundary', name: selectedTool, arguments: JSON.stringify(args) };
      const response = { id: 'resp_' + requests, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const event of [{ type: 'response.created', response: { id: response.id } }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    })().catch(() => { rejectDone(new Error('synthetic command stream failed')); res.destroy(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const proc = spawn('/opt/agentmeld/node_modules/.bin/codex', ['app-server', '--stdio', '-c', 'model_provider="m0"', '-c', 'model="fixture-model"', '-c', `model_providers.m0={name="M0 fixture",base_url="${base}",wire_api="responses",requires_openai_auth=false}`, '-c', 'model_reasoning_effort="low"'], {
    cwd: '/workspace', env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home + '/.codex' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map(); let sequence = 0; let buffer = ''; let closing = false;
  const fail = () => { if (closing) return; const error = new Error('native command fixture failed'); rejectDone(error); for (const waiter of pending.values()) waiter.reject(error); pending.clear(); proc.kill('SIGKILL'); };
  proc.on('error', fail); proc.on('exit', fail); proc.stdin.on('error', fail); proc.stderr.resume();
  proc.stdout.on('data', chunk => {
    buffer += chunk.toString(); if (buffer.length > 1024 * 1024) return fail();
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let frame; try { frame = JSON.parse(line); } catch { return fail(); }
      if (frame.method && frame.id !== undefined) {
        // Never grant an escalation or unknown server request in the canary test.
        proc.stdin.write(JSON.stringify({ id: frame.id, error: { code: -32601, message: 'No escalations allowed in boundary fixture' } }) + '\n');
      } else if (pending.has(frame.id)) {
        const waiter = pending.get(frame.id); pending.delete(frame.id);
        if (frame.error) waiter.reject(new Error('native protocol rejected request')); else waiter.resolve(frame.result);
      } else if (frame.method === 'turn/completed') resolveDone(frame.params.turn.status);
    }
  });
  function request(method, params) {
    return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); proc.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  }
  const deadline = setTimeout(fail, 25000);
  try {
    await request('initialize', { clientInfo: { name: 'agentmeld_m0_boundary', version: '0.1.0' } });
    proc.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const started = await request('thread/start', { cwd: '/workspace', model: 'fixture-model', modelProvider: 'm0', approvalPolicy: 'on-request', ephemeral: true });
    await request('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'Run the supplied local boundary fixture once without escalation.', text_elements: [] }] });
    const status = await done;
    if (status !== 'completed' || !toolOutputSeen || requests !== 2) throw Error('native command completion unqualified');
    return { status, requests, toolOutputSeen, selectedTool, liveInference: false };
  } finally {
    clearTimeout(deadline); closing = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const exited = new Promise(resolve => { if (proc.exitCode !== null || proc.signalCode) resolve(); else proc.once('exit', resolve); });
    proc.stdin.end(); proc.kill('SIGTERM'); const kill = setTimeout(() => proc.kill('SIGKILL'), 1000); await exited; clearTimeout(kill);
  }
}
