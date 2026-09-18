import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateQuotaVolume } from './quota-volume.mjs';
const id = '12345678-1234-1234-1234-123456789abc';
const fixture = () => ({ Name: 'agentmeld-m0-quota-' + id, Driver: 'local', Labels: { 'io.digitalmeld.agentmeld.quota-instance': id }, Options: { type: 'ext4', device: '/dev/loop7', o: 'nodev,nosuid' } });
test('quota mount requires exact owned identity and constrained filesystem options', () => {
  assert.equal(validateQuotaVolume(fixture(), id), 'type=volume,source=agentmeld-m0-quota-' + id + ',target=/workspace,volume-nocopy');
  for (const delta of [{ Name: 'other' }, { Driver: 'nfs' }, { Labels: {} }, { Options: { type: 'ext4', device: '/dev/sda', o: 'nodev,nosuid' } }, { Options: { type: 'ext4', device: '/dev/loop7', o: 'bind' } }, { Options: { ...fixture().Options, other: 'x' } }]) assert.throws(() => validateQuotaVolume({ ...fixture(), ...delta }, id));
  assert.throws(() => validateQuotaVolume(fixture(), 'bad,source=other'));
});
