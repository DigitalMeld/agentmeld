import assert from 'node:assert/strict';
export function validateQuotaVolume(volume, instance) {
  assert.match(instance, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.equal(volume.Name, 'agentmeld-m0-quota-' + instance);
  assert.equal(volume.Driver, 'local');
  assert.equal(volume.Labels?.['io.digitalmeld.agentmeld.quota-instance'], instance);
  assert.match(volume.Options?.device, /^\/dev\/loop\d+$/);
  assert.deepEqual(volume.Options, { type: 'ext4', device: volume.Options.device, o: 'nodev,nosuid' });
  return 'type=volume,source=' + volume.Name + ',target=/workspace,volume-nocopy';
}
