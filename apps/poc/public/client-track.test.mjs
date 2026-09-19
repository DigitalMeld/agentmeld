// Tests for the run.answer_delta routing in apps/poc/public/client-track.js
// (follow-up to issue #113, merged as PR #114): answer deltas go to
// ctx.onDelta and must NOT trigger a state refresh; deltas that cannot be
// painted (missing/empty text, no onDelta wired) fall back to the throttled
// queueRefresh path; terminal run events still refresh authoritatively.
// Run: node --test apps/poc/public/client-track.test.mjs

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

function sseDataFrame(seq, type, runId, payload) {
  const env = {
    v: 1, id: `ev-${seq}`, seq, type,
    workspace_id: 'default', conversation_id: 'c1', run_id: runId,
    ts: 1700000000000 + seq, payload,
  };
  return `id: ${seq}\ndata: ${JSON.stringify(env)}\n\n`;
}

// Drive one initClientTrack instance through a canned SSE stream and return
// the captured ctx calls. `frames` is the raw SSE text served on the first
// /api/v1/events fetch; the stream then stays open (never-yielding) until
// stop() is called.
async function driveTrack(frames, { onDelta, waitFor } = {}) {
  const { initClientTrack } = await import('./client-track.js');

  const onDeltaCalls = [];
  const requestRefreshCalls = [];
  const calls = { onDeltaCalls, requestRefreshCalls };
  // Default: stop waiting once two deltas landed or any refresh fired.
  // Tests with fewer expected callbacks pass their own predicate.
  const done = waitFor || (() => onDeltaCalls.length >= 2 || requestRefreshCalls.length >= 1);
  const chunks = [new TextEncoder().encode(frames)];
  let firstFetch = true;

  const readerFor = (signal) => ({
    read() {
      if (chunks.length) {
        return Promise.resolve({ done: false, value: chunks.shift() });
      }
      if (signal && signal.aborted) {
        return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }
      // The reconnect stream: stay open until the test aborts it.
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    },
  });

  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('/api/v1/events')) {
      if (firstFetch) firstFetch = false;
      return { ok: true, status: 200, body: { getReader: () => readerFor(opts.signal) } };
    }
    throw new Error('unexpected fetch ' + url);
  };

  const track = initClientTrack({
    api: async () => ({}),
    esc: (s) => String(s),
    $: () => null,
    notice: () => {},
    icon: () => '',
    token: () => 'test-token',
    getState: () => ({ tasks: [] }),
    requestRefresh: () => { requestRefreshCalls.push(Date.now()); },
    selectConversation: () => {},
    onDelta: onDelta || ((runId, text) => { onDeltaCalls.push([runId, text]); }),
  });
  track.start();

  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (done(calls)) {
      // Give the loop a beat to process any trailing frames.
      await new Promise((r) => setTimeout(r, 150));
      break;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  track.stop();
  await new Promise((r) => setTimeout(r, 100)); // let the loop unwind
  return { onDeltaCalls, requestRefreshCalls };
}

describe('client-track run.answer_delta routing', () => {
  before(() => {
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.document = { querySelectorAll: () => [], addEventListener: () => {} };
  });

  it('routes answer deltas to ctx.onDelta without a state refresh', async () => {
    const frames =
      'event: stream.hello\ndata: {"current_seq":0,"server_time_ms":1700000000000}\n\n' +
      sseDataFrame(1, 'run.answer_delta', 'run-1', { text: 'Hello ' }) +
      sseDataFrame(2, 'run.answer_delta', 'run-1', { text: 'world' });
    const { onDeltaCalls, requestRefreshCalls } = await driveTrack(frames);
    assert.deepEqual(onDeltaCalls, [['run-1', 'Hello '], ['run-1', 'world']]);
    assert.equal(requestRefreshCalls.length, 0);
  });

  it('still refreshes on the terminal run event', async () => {
    const frames =
      'event: stream.hello\ndata: {"current_seq":0,"server_time_ms":1700000000000}\n\n' +
      sseDataFrame(1, 'run.answer_delta', 'run-1', { text: 'Hello ' }) +
      sseDataFrame(2, 'run.answer_delta', 'run-1', { text: 'world' }) +
      sseDataFrame(3, 'run.completed', 'run-1', {});
    const { onDeltaCalls, requestRefreshCalls } = await driveTrack(frames);
    assert.deepEqual(onDeltaCalls, [['run-1', 'Hello '], ['run-1', 'world']]);
    // Exactly one refresh: the terminal event. The two deltas (inside the
    // 750ms queueRefresh throttle window) must not add any.
    assert.equal(requestRefreshCalls.length, 1);
  });

  it('falls back to a throttled refresh for deltas with missing or empty text', async () => {
    const frames =
      'event: stream.hello\ndata: {"current_seq":0,"server_time_ms":1700000000000}\n\n' +
      sseDataFrame(1, 'run.answer_delta', 'run-1', {}) +
      sseDataFrame(2, 'run.answer_delta', 'run-1', { text: '' }) +
      sseDataFrame(3, 'run.answer_delta', 'run-1', { text: 'kept' });
    const { onDeltaCalls, requestRefreshCalls } = await driveTrack(frames, {
      waitFor: ({ onDeltaCalls: c, requestRefreshCalls: r }) => c.length >= 1 || r.length >= 1,
    });
    assert.deepEqual(onDeltaCalls, [['run-1', 'kept']]);
    // The two unpaintable deltas take the queueRefresh path, but the 750ms
    // throttle coalesces them into a single refresh.
    assert.equal(requestRefreshCalls.length, 1);
  });

  it('a throwing onDelta does not take down the stream', async () => {
    const attempts = [];
    const frames =
      'event: stream.hello\ndata: {"current_seq":0,"server_time_ms":1700000000000}\n\n' +
      sseDataFrame(1, 'run.answer_delta', 'run-1', { text: 'one' }) +
      sseDataFrame(2, 'run.answer_delta', 'run-1', { text: 'two' });
    const { requestRefreshCalls } = await driveTrack(frames, {
      onDelta: (runId, text) => {
        attempts.push([runId, text]);
        throw new Error('app render bug');
      },
      waitFor: () => attempts.length >= 2,
    });
    // Both deltas were still offered to the app; the throw was swallowed at
    // the callback boundary instead of killing the stream loop.
    assert.deepEqual(attempts, [['run-1', 'one'], ['run-1', 'two']]);
    assert.equal(requestRefreshCalls.length, 0);
  });
});
