// Creates and removes only a uniquely named synthetic auth fixture, never the real store.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { storeLabels, validateStore, initializeStoreProgram, storeMount } from '../experiments/codex-auth-store.mjs';
import assert from 'node:assert/strict';
const { values } = parseArgs({ options: { context: { type: 'string' } } });
if (!values.context) throw Error('explicit context required');
const docker = args => execFileSync('docker', ['--context', values.context, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
const root = fileURLToPath(new URL('../', import.meta.url));
const instance = randomUUID(); const name = 'agentmeld-m0-auth-fixture-' + instance;
const image = docker(['image', 'inspect', 'agentmeld-m0:local', '--format', '{{.Id}}']).trim(); assert.match(image, /^sha256:[a-f0-9]{64}$/);
const paths = JSON.parse(execFileSync('python3', ['-c', `import importlib.util,json,pathlib
root=pathlib.Path(${JSON.stringify(root)})
spec=importlib.util.spec_from_file_location("policy",root/"scripts/prepare-codex-policy.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
print(json.dumps([str(p) for p in module.verify_prepared(root)]))`], { encoding: 'utf8' }));
const limits = ['--rm', '--read-only', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--cpus=1', '--pids-limit=64', '--mount=' + storeMount(name)];
const containers = []; let created = false;
try {
  assert.ok(!docker(['volume', 'ls', '--format', '{{.Name}}']).trim().split('\n').includes(name));
  docker(['volume', 'create', ...Object.entries({ ...storeLabels, 'io.digitalmeld.agentmeld.instance': instance }).map(([k,v]) => '--label=' + k + '=' + v), name]); created = true;
  validateStore(JSON.parse(docker(['volume', 'inspect', name]))[0], name, instance);
  const initializer = name + '-init'; containers.push(initializer);
  docker(['run', '--name', initializer, ...limits, '--user=0:0', '--cap-add=CHOWN', image, 'node', '-e', initializeStoreProgram(instance)]);
  const repeated = name + '-reinit'; containers.push(repeated);
  assert.throws(() => docker(['run', '--name', repeated, ...limits, '--user=0:0', '--cap-add=CHOWN', image, 'node', '-e', initializeStoreProgram(instance)]), error => error.status === 1 && String(error.stderr).includes("EACCES: permission denied, scandir '/agentmeld-home'"));
  const reports = [];
  for (let i = 0; i < 2; i++) {
    validateStore(JSON.parse(docker(['volume', 'inspect', name]))[0], name, instance);
    const worker = name + '-' + i; containers.push(worker);
    reports.push(JSON.parse(docker(['run', '--name', worker, ...limits, '--user=1000:1000', '--security-opt=seccomp=' + paths[0], '--security-opt=apparmor=agentmeld-m0-codex', '--tmpfs=/tmp:rw,nosuid,nodev,size=33554432,mode=1777', '--tmpfs=/workspace:rw,nosuid,nodev,size=8388608,uid=1000,gid=1000,mode=0700', '--env=AGENTMELD_STORE_INSTANCE=' + instance, '--env=AGENTMELD_STORE_FIRST=' + (i === 0 ? '1' : '0'), image, 'node', '/opt/agentmeld/auth-store-probe.mjs'])));
  }
  const report = { phase: 'm0', image, volumeKind: 'disposable-synthetic', nonemptyReinitializationDenied: true, replacementContainers: reports.length, reports, realCredentials: false };
  await mkdir(root + '.local/m0/auth-store', { recursive: true });
  await writeFile(root + '.local/m0/auth-store/' + instance + '.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally {
  for (const container of containers) {
    if (docker(['ps', '-a', '--format', '{{.Names}}']).trim().split('\n').includes(container)) docker(['rm', '-f', container]);
  }
  if (created) { validateStore(JSON.parse(docker(['volume', 'inspect', name]))[0], name, instance); docker(['volume', 'rm', name]); }
}
