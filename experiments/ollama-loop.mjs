// HTTP transport spike for Rust-produced tool results. Fixture/default mode never calls
// a provider. Live callers must explicitly supply an endpoint, model and executor.
import { pathToFileURL } from 'node:url';

export async function runLoop({ endpoint, model, execute, fetchImpl = fetch, maxTurns = 4, signal }) {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('invalid operator endpoint');
  const messages = [{ role: 'user', content: 'Use the sum tool to add 2 and 3, then report its result.' }];
  const tools = [{ type: 'function', function: { name: 'sum', description: 'Add two integers', parameters: { type: 'object', additionalProperties: false, properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'] } } }];
  for (let turn = 0; turn < maxTurns; turn++) {
    signal?.throwIfAborted();
    const response = await fetchImpl(new URL('/api/chat', url), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true, messages, tools }), signal,
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    let pending = ''; let bytes = 0; let done = false;
    const message = { role: 'assistant', content: '', tool_calls: [] };
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw new Error('turn output limit');
      pending += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        if (done) throw new Error('data after terminal frame');
        const frame = JSON.parse(line);
        if (frame.error || typeof frame.done !== 'boolean') throw new Error('invalid Ollama frame');
        if (frame.message) {
          if (typeof frame.message.content !== 'string') throw new Error('invalid content');
          message.content += frame.message.content;
          if (frame.message.tool_calls) {
            if (!Array.isArray(frame.message.tool_calls)) throw new Error('invalid calls');
            message.tool_calls.push(...frame.message.tool_calls);
          }
          if (message.tool_calls.length > 8) throw new Error('tool count limit');
        } else if (!frame.done) throw new Error('missing message');
        done = frame.done;
      }
    }
    pending += decoder.decode();
    if (pending.trim() || !done) throw new Error('truncated Ollama stream');
    messages.push(message);
    if (!message.tool_calls.length) return { text: message.content, turns: turn + 1, messages };
    // Validate and execute only after the entire bounded stream is complete.
    for (const call of message.tool_calls) {
      signal?.throwIfAborted();
      const f = call?.function;
      if (f?.name !== 'sum' || !f.arguments || typeof f.arguments !== 'object' || Array.isArray(f.arguments))
        throw new Error('ungranted or malformed tool');
      const result = await execute({ name: f.name, arguments: f.arguments });
      messages.push({ role: 'tool', tool_name: f.name, content: JSON.stringify(result) });
    }
  }
  throw new Error('turn budget exhausted');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('Import runLoop from a fixture or explicitly configured experiment; no default provider endpoint.');
  process.exitCode = 1;
}
