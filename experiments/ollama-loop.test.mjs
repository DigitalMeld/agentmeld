import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runLoop } from './ollama-loop.mjs';

function response(frames) { return new Response(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n'); }
const toolFrame = { message: { content: '', tool_calls: [{ function: { name: 'sum', arguments: { a: 2, b: 3 } } }] }, done: false };
function execute(call) {
  const payload = JSON.stringify({ message: { content: '', tool_calls: [{ function: call }] }, done: true }) + '\n';
  const result = spawnSync('target/debug/agentmeld-m0', ['replay', 'ollama'], { input: payload, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).tool_results[0];
}

test('two-turn HTTP contract runs a Rust tool and returns its result to the model', async () => {
  let requests = 0;
  const result = await runLoop({ endpoint: 'http://fixture.invalid', model: 'fixture', execute,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests++;
      if (requests === 1) return response([toolFrame, { done: true }]);
      assert.deepEqual(body.messages.at(-1), { role: 'tool', tool_name: 'sum', content: '{"sum":5}' });
      return response([{ message: { content: '5' }, done: true }]);
    },
  });
  assert.equal(result.text, '5'); assert.equal(result.turns, 2);
});

test('a partial tool request never executes', async () => {
  let executed = false;
  await assert.rejects(runLoop({ endpoint: 'http://fixture.invalid', model: 'fixture',
    execute: () => { executed = true; }, fetchImpl: async () => response([toolFrame]),
  }), /truncated/);
  assert.equal(executed, false);
});

test('tool error, non-OK response, and abort stop the loop', async () => {
  await assert.rejects(runLoop({ endpoint: 'http://fixture.invalid', model: 'fixture', execute: () => { throw new Error('denied'); }, fetchImpl: async () => response([toolFrame, { done: true }]) }), /denied/);
  await assert.rejects(runLoop({ endpoint: 'http://fixture.invalid', model: 'fixture', execute, fetchImpl: async () => new Response('', { status: 401 }) }), /401/);
  await assert.rejects(runLoop({ endpoint: 'http://fixture.invalid', model: 'fixture', execute, signal: AbortSignal.abort(), fetchImpl: () => { throw new Error('must not fetch'); } }), { name: 'AbortError' });
});

test('turn budget bounds repeated tool requests', async () => {
  await assert.rejects(runLoop({ endpoint: 'http://fixture.invalid', model: 'fixture', execute, maxTurns: 2, fetchImpl: async () => response([toolFrame, { done: true }]) }), /budget/);
});
