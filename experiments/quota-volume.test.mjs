import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateQuotaVolume, validateVmRecovery } from './quota-volume.mjs';
const id = '12345678-1234-1234-1234-123456789abc';
const fixture = () => ({ Name: 'agentmeld-m0-quota-' + id, Driver: 'local', Labels: { 'io.digitalmeld.agentmeld.quota-instance': id }, Options: { type: 'ext4', device: '/dev/loop7', o: 'nodev,nosuid' } });
test('quota mount requires exact owned identity and constrained filesystem options', () => {
  assert.equal(validateQuotaVolume(fixture(), id), 'type=volume,source=agentmeld-m0-quota-' + id + ',target=/workspace,volume-nocopy');
  for (const delta of [{ Name: 'other' }, { Driver: 'nfs' }, { Labels: {} }, { Options: { type: 'ext4', device: '/dev/sda', o: 'nodev,nosuid' } }, { Options: { type: 'ext4', device: '/dev/loop7', o: 'bind' } }, { Options: { ...fixture().Options, other: 'x' } }]) assert.throws(() => validateQuotaVolume({ ...fixture(), ...delta }, id));
  assert.throws(() => validateQuotaVolume(fixture(), 'bad,source=other'));
});
test('VM recovery requires a new boot and the same engine, image and bounded filesystem', () => {
  const before = { boot: id, engine: 'engine', image: 'sha256:' + 'a'.repeat(64), filesystem: id, bytes: 67108864 };
  const after = { ...before, boot: 'abcdefab-1234-1234-1234-123456789abc' };
  validateVmRecovery(before, after);
  for (const delta of [{ boot: id }, { engine: 'other' }, { image: 'sha256:' + 'b'.repeat(64) }, { filesystem: after.boot }, { bytes: 67108865 }]) {
    assert.throws(() => validateVmRecovery(before, { ...after, ...delta }));
  }
});
