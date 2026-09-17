import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runLoop } from './ollama-loop.mjs';
const execute = promisify(execFile);
async function listen(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
test('a stalled HTTP stream is aborted by the overall deadline without tool execution', async () => {
  const server = await listen((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); res.write('{'); });
  let calls = 0;
  try { await assert.rejects(runLoop({ endpoint: server.endpoint, model: 'fixture', timeoutMs: 100, execute: () => { calls++; } }), error => ['TimeoutError', 'AbortError'].includes(error.name)); assert.equal(calls, 0); }
  finally { await server.close(); }
});
test('CLI qualification exercises preflight, durable tool approval, denial and interruption using synthetic HTTP only', async () => {
  let chats = 0;
  const server = await listen(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: 'synthetic-test-server' }));
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'synthetic:local', digest: 'a'.repeat(64), size: 1024, details: { format: 'gguf' } }] }));
    if (req.url === '/api/show') return res.end(JSON.stringify({ details: { format: 'gguf' }, capabilities: ['tools'] }));
    assert.equal(req.url, '/api/chat'); chats++;
    const returned = body.messages.at(-1).role === 'tool';
    if (returned) assert.equal(body.messages.at(-1).content, '{"sum":5}');
    res.end(JSON.stringify({ message: { role: 'assistant', content: returned ? '5' : '', ...(returned ? {} : { tool_calls: [{ function: { name: 'sum', arguments: { a: 2, b: 3 } } }] }) }, done: true }) + '\n');
  });
  try {
    const result = await execute(process.execPath, ['scripts/probe-ollama.mjs', '--endpoint', server.endpoint, '--model', 'synthetic:local', '--run-fixture'], { timeout: 10000, maxBuffer: 65536 });
    const report = JSON.parse(result.stdout);
    assert.equal(report.model.runtimeVersion, 'synthetic-test-server');
    assert.equal(report.fixtureTransport, true); assert.equal(report.liveInferenceQualified, false); assert.equal(report.qualificationPassed, true);
    assert.deepEqual(report.cases.map(item => item.toolExecutions), [1, 0, 0]); assert.equal(chats, 4);
    assert.equal(report.cases[0].completed, true); assert.equal(report.cases[1].denied, true); assert.equal(report.cases[2].callerStreamAborted, true); assert.equal(report.cases[2].cancellationPersisted, true);
    // This is a transport fixture, never evidence of real model inference.
  } finally { await server.close(); }
});
