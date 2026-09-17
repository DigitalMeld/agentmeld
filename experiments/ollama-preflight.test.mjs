import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflightOllama, localEndpoint } from './ollama-preflight.mjs';
const model = 'fixture:local';
const entry = () => ({ name: model, digest: 'a'.repeat(64), size: 1024, details: { format: 'gguf' } });
function fixture(change = value => value, show = { details: { format: 'gguf' }, capabilities: ['completion', 'tools'] }) {
  const paths = [];
  return { paths, fetchImpl: async (url, options) => { paths.push(url.pathname); assert.equal(options.redirect, 'error'); const value = url.pathname === '/api/version' ? { version: 'fixture' } : url.pathname === '/api/tags' ? { models: [change(entry())] } : show; return Response.json(value); } };
}
test('preflight records the exact installed local model without inference', async () => {
  const mock = fixture(); const report = await preflightOllama({ endpoint: 'http://127.0.0.1:11434', model, fetchImpl: mock.fetchImpl });
  assert.equal(report.digest, 'a'.repeat(64)); assert.deepEqual(mock.paths, ['/api/version', '/api/tags', '/api/show']);
});
test('preflight rejects cloud aliases, remote metadata, missing weights and tool-less models', async () => {
  await assert.rejects(preflightOllama({ endpoint: 'http://127.0.0.1:11434', model: 'example:cloud', fetchImpl: () => { throw new Error('must not fetch'); } }), /local model/);
  for (const change of [ e => ({ ...e, remote_host: 'https://remote.invalid' }), e => ({ ...e, remote_model: 'remote' }), e => ({ ...e, details: { format: '' } }), e => ({ ...e, size: 0 }), e => ({ ...e, digest: 'short' }), e => ({ ...e, name: 'different' }) ]) {
    const mock = fixture(change); await assert.rejects(preflightOllama({ endpoint: 'http://127.0.0.1:11434', model, fetchImpl: mock.fetchImpl })); assert.ok(!mock.paths.includes('/api/show'));
  }
  for (const capabilities of [['completion'], 'tools']) {
    const mock = fixture(e => e, { details: { format: 'gguf' }, capabilities });
    await assert.rejects(preflightOllama({ endpoint: 'http://127.0.0.1:11434', model, fetchImpl: mock.fetchImpl }), /capability/);
  }
});
test('preflight accepts only a literal loopback origin and bounds metadata', async () => {
  for (const endpoint of ['https://remote.invalid', 'http://localhost:11434', 'http://127.0.0.1/path', 'http://user:secret@127.0.0.1', 'http://127.0.0.1?token=value']) assert.throws(() => localEndpoint(endpoint));
  await assert.rejects(preflightOllama({ endpoint: 'http://127.0.0.1', model, fetchImpl: async () => new Response('x'.repeat(1024 * 1024 + 1)) }), /metadata limit/);
});
