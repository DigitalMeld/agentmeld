import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authConfig, storeLabels, validateStore, initializeStoreProgram, storeMount } from './codex-auth-store.mjs';
const name = 'agentmeld-m0-codex-auth'; const instance = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const volume = { Name: name, Driver: 'local', Scope: 'local', Options: null, Labels: { ...storeLabels, 'io.digitalmeld.agentmeld.instance': instance } };
test('auth store mounts only the designated VM-local volume without image-data copy', () => {
  assert.equal(storeMount(name), 'type=volume,source=agentmeld-m0-codex-auth,target=/agentmeld-home,volume-nocopy');
  assert.match(storeMount('agentmeld-m0-auth-fixture-' + instance), /volume-nocopy$/);
  for (const bad of ['/Users/owner/.codex', 'unrelated', name + ',readonly', name + '\n']) assert.throws(() => storeMount(bad));
});
test('auth volume identity rejects foreign, remapped and wrong-generation stores', () => {
  assert.deepEqual(validateStore(volume, name, instance), { name, instance });
  assert.throws(() => validateStore(volume, name, undefined));
  for (const change of [{ Name: 'other' }, { Driver: 'nfs' }, { Scope: 'global' }, { Options: { device: '/secret' } }, { Labels: {} }, { Labels: { ...volume.Labels, 'io.digitalmeld.agentmeld.instance': 'other' } }]) assert.throws(() => validateStore({ ...volume, ...change }, name, instance));
});
test('dedicated configuration restricts login to subscription and denies native tool access', () => {
  assert.match(authConfig, /forced_login_method = "chatgpt"/);
  assert.match(authConfig, /cli_auth_credentials_store = "file"/);
  assert.match(authConfig, /"\/agentmeld-home" = "deny"/);
  assert.match(authConfig, /network\]\nenabled = false/);
  assert.throws(() => initializeStoreProgram('bad";process.exit()'));
  assert.match(initializeStoreProgram(instance), /auth store must be empty/);
});

test('runtime configuration tolerates only the exact native workspace trust entry', async () => {
  const { authConfig, validateRuntimeAuthConfig } = await import('./codex-auth-store.mjs');
  validateRuntimeAuthConfig(authConfig);
  validateRuntimeAuthConfig(authConfig + '\n[projects."/workspace"]\ntrust_level = "trusted"\n');
  assert.throws(() => validateRuntimeAuthConfig(authConfig.replace('"deny"', '"read"')));
  assert.throws(() => validateRuntimeAuthConfig(authConfig.replace('enabled = false', 'enabled = true')));
  assert.throws(() => validateRuntimeAuthConfig(authConfig + '\n[projects."/other"]\ntrust_level = "trusted"\n'));
});
