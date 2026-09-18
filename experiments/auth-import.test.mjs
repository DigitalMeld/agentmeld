import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionAuthBytes } from './auth-import.mjs';
const fixture = () => ({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { access_token: 'synthetic-a', refresh_token: 'synthetic-r', id_token: 'synthetic-i', account_id: 'synthetic-account' }, last_refresh: '2026-09-18T00:00:00Z' });
test('subscription import copies only required authentication fields', () => {
  const data = fixture(); data.unrelated = 'private-settings'; data.tokens.extra = 'exclude';
  assert.deepEqual(JSON.parse(subscriptionAuthBytes(Buffer.from(JSON.stringify(data)))), fixture());
});
test('subscription import rejects API mode, missing tokens and malformed input without echo', () => {
  for (const mutate of [x => x.auth_mode = 'apikey', x => x.OPENAI_API_KEY = 'synthetic-api-secret', x => delete x.tokens.refresh_token, x => x.last_refresh = 'invalid']) {
    const data = fixture(); mutate(data); assert.throws(() => subscriptionAuthBytes(Buffer.from(JSON.stringify(data))), error => !error.message.includes('synthetic'));
  }
  assert.throws(() => subscriptionAuthBytes(Buffer.from('not json')));
});
test('subscription import bounds input before parsing', () => {
  assert.throws(() => subscriptionAuthBytes(Buffer.alloc(1048577)));
  assert.throws(() => subscriptionAuthBytes('not a buffer'));
});
