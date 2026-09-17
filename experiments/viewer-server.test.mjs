import { test } from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { startViewer } from './viewer-server.mjs';
import { BrowserControl } from './browser-control.mjs';
const computer = () => ({ observe: async () => ({ png: 'fixture' }), humanClick: async () => {}, agentClick: async () => {} });

test('viewer requires capability, exact origin, bounded coordinates and current generation', async () => {
  const control = new BrowserControl(computer()); const viewer = await startViewer(control);
  const headers = { Authorization: `Bearer ${viewer.token}`, Origin: viewer.origin, 'Content-Type': 'application/json' };
  const post = (path, body, override = headers) => fetch(viewer.origin + path, { method: 'POST', headers: override, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(viewer.origin + '/frame')).status, 401);
    assert.equal((await post('/takeover', {}, { ...headers, Authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await post('/takeover', {}, { ...headers, Origin: 'http://evil.invalid' })).status, 403);
    assert.equal((await post('/takeover', {}, { Authorization: headers.Authorization, 'Content-Type': 'application/json' })).status, 403);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(viewer.origin + '/state', { headers: { ...headers, Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHost, 403);
    const state = await (await post('/takeover', {})).json();
    assert.equal(state.mode, 'human');
    assert.equal((await post('/input', { generation: state.generation, x: 640, y: 10 })).status, 400);
    assert.equal((await post('/input', { generation: 0, x: 10, y: 10 })).status, 409);
    assert.equal((await post('/disconnect', {})).status, 200);
    assert.equal((await fetch(viewer.origin + '/frame', { headers })).status, 410);
    assert.equal(control.state().mode, 'paused');
  } finally { await viewer.close(); }
});

test('lost viewer expires and cannot renew itself or resume automation', async () => {
  const control = new BrowserControl(computer()); const viewer = await startViewer(control, { leaseMs: 40 });
  const headers = { Authorization: `Bearer ${viewer.token}` };
  try {
    assert.equal((await fetch(viewer.origin + '/state', { headers })).status, 200);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await fetch(viewer.origin + '/state', { headers })).status, 410);
    assert.equal(control.state().mode, 'paused');
    await assert.rejects(control.agentClick(control.generation), /stale/);
  } finally { await viewer.close(); }
});

test('revocation during capture withholds the completed screenshot', async () => {
  let release; let began;
  const started = new Promise(resolve => { began = resolve; });
  const control = new BrowserControl({ observe: async () => { began(); return new Promise(resolve => { release = resolve; }); } });
  const viewer = await startViewer(control, { leaseMs: 40 });
  try {
    const request = fetch(viewer.origin + '/frame', { headers: { Authorization: `Bearer ${viewer.token}` } });
    await started; await new Promise(resolve => setTimeout(resolve, 100));
    release({ png: 'must-not-be-returned' });
    const response = await request; assert.equal(response.status, 410);
    assert.ok(!(await response.text()).includes('must-not-be-returned'));
  } finally { await viewer.close(); }
});
