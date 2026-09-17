import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RustAuthority } from './rust-browser-control.mjs';
import { durableSum } from './ollama-durable-tool.mjs';
const binary = 'target/debug/agentmeld-m0';
const scope = { workspace: 'fixture', worker: 'fixture', thread: 'fixture', turn: 'fixture' };
test('Ollama executor journals allow and settlement but never executes denied or aborted calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentmeld-ollama-')); let authority;
  try {
    authority = await RustAuthority.open(binary, join(directory, 'journal'));
    const stats = { executions: 0, results: [] }; const call = { name: 'sum', arguments: { a: 2, b: 3 } };
    const allowed = durableSum({ authority, binary, scope, allow: true, stats });
    assert.deepEqual(await allowed(call), { sum: 5 }); assert.equal(authority.current.pending, null);
    const denied = durableSum({ authority, binary, scope: { ...scope, turn: 'deny' }, allow: false, stats });
    await assert.rejects(denied(call), /approval denied/); assert.equal(stats.executions, 1); assert.equal(authority.current.pending, null);
    await assert.rejects(allowed(call, AbortSignal.abort()), { name: 'AbortError' }); assert.equal(stats.executions, 1);
  } finally { if (authority) await authority.close(); await rm(directory, { recursive: true }); }
});
