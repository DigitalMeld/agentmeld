import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBrowserCall } from './live-browser-qualification.mjs';
const call = () => ({ method: 'item/tool/call', params: { threadId: 'thread', turnId: 'turn', tool: 'browser_fixture_increment', arguments: {}, callId: 'call' } });
const events = [{ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } }];
test('browser callback requires current thread and turn evidence', () => {
  validateBrowserCall(call(), 'thread', events, new Set());
  for (const evidence of [[], [{ ...events[0], params: { threadId: 'other', turn: { id: 'turn' } } }], [{ ...events[0], params: { threadId: 'thread', turn: { id: 'previous' } } }]]) {
    assert.throws(() => validateBrowserCall(call(), 'thread', evidence, new Set()));
  }
  assert.throws(() => validateBrowserCall(call(), 'other', events, new Set()));
});
test('browser callback rejects arbitrary tools, arguments and namespaces', () => {
  for (const change of [{ tool: 'exec_command' }, { arguments: { x: 1 } }, { arguments: [] }, { namespace: 'untrusted' }, { callId: '' }]) {
    const frame = call(); Object.assign(frame.params, change);
    assert.throws(() => validateBrowserCall(frame, 'thread', events, new Set()));
  }
});
test('browser callback cannot replay its call ID or exceed the fixture budget', () => {
  const seen = new Set(); validateBrowserCall(call(), 'thread', events, seen);
  assert.throws(() => validateBrowserCall(call(), 'thread', events, seen));
  assert.throws(() => validateBrowserCall(call(), 'thread', events, new Set(['a', 'b', 'c'])));
});
