import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OwnedWorker } from './owned-worker.mjs';
const id = 'a'.repeat(64); const image = 'sha256:' + 'b'.repeat(64); const workspace = '/fixture/workspace';
const record = () => ({ Id: id, Image: image, State: { Running: true }, Config: { User: '1000:1000', Labels: { 'io.digitalmeld.agentmeld.phase': 'm0' } }, HostConfig: { NetworkMode: 'none', Privileged: false, ReadonlyRootfs: true, Memory: 1073741824, NanoCpus: 1000000000, PidsLimit: 256, Init: true, CapDrop: ['ALL'], CapAdd: null, SecurityOpt: ['no-new-privileges:true'], PidMode: '', IpcMode: 'private', Devices: [], DeviceRequests: null }, Mounts: [{ Type: 'bind', Source: workspace, Destination: '/workspace' }] });
function fixture(overrides = {}) {
  const calls = [];
  const computer = { dead: false, request: async (...args) => { calls.push(args); return { sum: 5 }; }, fail: () => { computer.dead = true; } };
  const runtime = { inspect: async () => record(), stop: async () => {}, ids: async () => [], ...overrides };
  return { id, image, workspace, computer, runtime, tools: ['fixture_sum'], calls };
}
test('binding requires immutable identity, owned workspace and offline container controls', async () => {
  await assert.rejects(OwnedWorker.bind({ ...fixture(), id: 'short-name' }), /identity/);
  for (const alter of [ r => { r.Id = 'c'.repeat(64); }, r => { r.Image = 'other'; }, r => { r.State.Running = false; }, r => { r.Config.User = '0'; }, r => { r.Config.Labels = {}; }, r => { r.HostConfig.NetworkMode = 'host'; }, r => { r.HostConfig.Privileged = true; }, r => { r.HostConfig.ReadonlyRootfs = false; }, r => { r.Mounts[0].Source = '/other'; }, r => { r.Mounts.push({}); } ]) {
    const actual = record(); alter(actual);
    await assert.rejects(OwnedWorker.bind(fixture({ inspect: async () => actual })), /binding/);
  }
});
test('worker grants reject foreign scope, unknown tools and revoked dispatch', async () => {
  const setup = fixture(); const worker = await OwnedWorker.bind(setup);
  assert.throws(() => worker.authorize('fixture_sum', { worker: 'other', workspace }), /scope/);
  assert.throws(() => worker.authorize('fixture_sum', { worker: id, workspace: '/other' }), /scope/);
  await assert.rejects(worker.request('workspace_list', {}), /grant/);
  await worker.request('fixture_sum', { a: 2, b: 3 }); assert.equal(setup.calls.length, 1);
  await worker.terminate(); await assert.rejects(worker.request('fixture_sum', { a: 2, b: 3 }), /grant/);
});
test('termination cannot claim success while the container exists or runtime readback fails', async () => {
  const present = await OwnedWorker.bind(fixture({ ids: async () => [id] }));
  await assert.rejects(present.terminate(), /present/); assert.equal(present.termination, 'unconfirmed');
  const offline = await OwnedWorker.bind(fixture({ ids: async () => { throw new Error('runtime offline'); } }));
  await assert.rejects(offline.terminate(), /offline/); assert.equal(offline.termination, 'unconfirmed');
});
test('termination coalesces concurrent requests and allows reconciliation after a failed stop', async () => {
  let stops = 0; let remaining = [id];
  const setup = fixture({ stop: async () => { stops++; throw new Error('lost stop response'); }, ids: async () => remaining });
  const worker = await OwnedWorker.bind(setup);
  await Promise.all([assert.rejects(worker.terminate(), /lost/), assert.rejects(worker.terminate(), /lost/)]);
  assert.equal(stops, 1); remaining = [];
  assert.equal((await worker.terminate()).termination, 'stopped');
  assert.equal((await worker.terminate()).termination, 'stopped'); assert.equal(stops, 2);
});

test('binding rejects missing resource limits and weakened process isolation', async () => {
  for (const [key, value] of [
    ['Memory', 0], ['Memory', 2147483648], ['NanoCpus', 0], ['PidsLimit', -1],
    ['Init', false], ['CapDrop', []], ['CapAdd', ['SYS_ADMIN']], ['SecurityOpt', []],
    ['SecurityOpt', ['no-new-privileges:true', 'seccomp=unconfined']],
    ['SecurityOpt', ['no-new-privileges:true', 'apparmor=unconfined']],
    ['PidMode', 'host'], ['IpcMode', 'host'], ['Devices', [{}]], ['DeviceRequests', [{}]],
  ]) {
    const actual = record(); actual.HostConfig[key] = value;
    await assert.rejects(OwnedWorker.bind(fixture({ inspect: async () => actual })), /limits/, key);
  }
  for (const key of ['Memory', 'NanoCpus', 'PidsLimit', 'Init', 'CapDrop', 'SecurityOpt', 'IpcMode']) {
    const actual = record(); delete actual.HostConfig[key];
    await assert.rejects(OwnedWorker.bind(fixture({ inspect: async () => actual })), /limits/, key);
  }
});
