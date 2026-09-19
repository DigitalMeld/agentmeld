// Tests for the SSE frame parser (apps/poc/public/sse-parse.js).
// Run: node --test apps/poc/public/sse-parse.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SseParser,
  clampRetry,
  RETRY_MIN_MS,
  RETRY_MAX_MS,
} from './sse-parse.js';

describe('SseParser', () => {
  it('parses a basic data frame with id', () => {
    const p = new SseParser();
    const { frames } = p.push('id: 14\ndata: {"seq":14}\n\n');
    assert.equal(frames.length, 1);
    assert.equal(frames[0].id, '14');
    assert.equal(frames[0].event, '');
    assert.deepEqual(frames[0].data, ['{"seq":14}']);
  });

  it('parses named frames (stream.hello)', () => {
    const p = new SseParser();
    const { frames } = p.push('event: stream.hello\ndata: {"current_seq":23,"server_time_ms":123}\n\n');
    assert.equal(frames.length, 1);
    assert.equal(frames[0].event, 'stream.hello');
    const msg = JSON.parse(frames[0].data.join('\n'));
    assert.equal(msg.current_seq, 23);
    assert.equal(msg.server_time_ms, 123);
  });

  it('reassembles frames split across chunk boundaries', () => {
    const p = new SseParser();
    let out = p.push('id: 1\ndata: {"par');
    assert.equal(out.frames.length, 0);
    out = p.push('tial":true}\n\nevent: stream.hel');
    assert.equal(out.frames.length, 1);
    assert.equal(out.frames[0].id, '1');
    out = p.push('lo\ndata: {}\n\n');
    assert.equal(out.frames.length, 1);
    assert.equal(out.frames[0].event, 'stream.hello');
  });

  it('joins multi-line data with newlines', () => {
    const p = new SseParser();
    const { frames } = p.push('data: line1\ndata: line2\n\n');
    assert.equal(frames.length, 1);
    assert.equal(SseParser.frameData(frames[0]), 'line1\nline2');
  });

  it('ignores comments but counts them as liveness', () => {
    const p = new SseParser();
    const before = p.linesSeen;
    const { frames } = p.push(':ping\n\n');
    assert.equal(frames.length, 1); // blank line still dispatches (empty frame)
    assert.equal(frames[0].data.length, 0);
    assert.ok(p.linesSeen > before);
  });

  it('handles CRLF line endings', () => {
    const p = new SseParser();
    const { frames } = p.push('id: 5\r\ndata: x\r\n\r\n');
    assert.equal(frames.length, 1);
    assert.equal(frames[0].id, '5');
  });

  it('ignores unknown fields per the SSE spec', () => {
    const p = new SseParser();
    const { frames } = p.push('id: 7\nbogus: field\ndata: ok\n\n');
    assert.equal(frames.length, 1);
    assert.equal(frames[0].id, '7');
    assert.deepEqual(frames[0].data, ['ok']);
  });

  it('parses retry: and clamps to bounds', () => {
    const p = new SseParser();
    let out = p.push('retry: 3000\n\n');
    assert.equal(out.retryMs, 3000);
    assert.equal(p.retryMs, 3000);
  });

  it('clamps an excessive retry to the max', () => {
    const p = new SseParser();
    p.push('retry: 999999\n\n');
    assert.equal(p.retryMs, RETRY_MAX_MS);
  });

  it('clamps a tiny retry to the min', () => {
    const p = new SseParser();
    p.push('retry: 10\n\n');
    assert.equal(p.retryMs, RETRY_MIN_MS);
  });

  it('ignores malformed retry values, keeping the last good one', () => {
    const p = new SseParser();
    p.push('retry: 2000\n\n');
    p.push('retry: banana\n\n');
    assert.equal(p.retryMs, 2000);
    p.push('retry: -50\n\n');
    assert.equal(p.retryMs, 2000);
  });
});

describe('clampRetry', () => {
  it('passes through in-range values', () => {
    assert.equal(clampRetry('3000'), 3000);
    assert.equal(clampRetry(1500), 1500);
  });
  it('clamps out-of-range values', () => {
    assert.equal(clampRetry('1'), RETRY_MIN_MS);
    assert.equal(clampRetry('1000000'), RETRY_MAX_MS);
  });
  it('rejects non-numeric and negative values', () => {
    assert.equal(clampRetry('nope'), null);
    assert.equal(clampRetry(''), null);
    assert.equal(clampRetry('-5'), null);
  });
});
