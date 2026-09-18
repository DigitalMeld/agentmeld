import assert from 'node:assert/strict';
export function validateVmRecovery(before, after) {
  for (const state of [before, after]) {
    assert.match(state.boot, /^[a-f0-9-]{36}$/);
    assert.ok(typeof state.engine === 'string' && state.engine.length > 0);
    assert.match(state.image, /^sha256:[a-f0-9]{64}$/);
    assert.match(state.filesystem, /^[a-f0-9-]{36}$/);
    assert.equal(state.bytes, 67108864);
  }
  assert.notEqual(before.boot, after.boot);
  for (const key of ['engine', 'image', 'filesystem', 'bytes']) assert.equal(after[key], before[key]);
}
export function validateQuotaVolume(volume, instance) {
  assert.match(instance, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(volume.Name, 'agentmeld-m0-quota-' + instance);
  assert.equal(volume.Driver, 'local');
  assert.equal(volume.Labels?.['io.digitalmeld.agentmeld.quota-instance'], instance);
  assert.match(volume.Options?.device, /^\/dev\/loop\d+$/);
  assert.deepEqual(volume.Options, { type: 'ext4', device: volume.Options.device, o: 'nodev,nosuid' });
  return 'type=volume,source=' + volume.Name + ',target=/workspace,volume-nocopy';
}
