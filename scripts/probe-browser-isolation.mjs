// Explicit two-container boundary; synthetic credentials only, no public listeners.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ContainerComputer } from '../experiments/container-computer.mjs';
import { RustAuthority, RustBrowserControl } from '../experiments/rust-browser-control.mjs';
const { values } = parseArgs({ options: { context: { type: 'string' } } });
if (!values.context) throw Error('explicit context required');
const docker = args => execFileSync('docker', ['--context', values.context, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
const root = fileURLToPath(new URL('../', import.meta.url)); const id = randomUUID();
const directory = root + '.local/m0/browser-isolation/' + id; await mkdir(directory, { recursive: true, mode: 0o700 });
const image = docker(['image', 'inspect', 'agentmeld-m0:local', '--format', '{{.Id}}']).trim(); assert.match(image, /^sha256:[a-f0-9]{64}$/);
const policy = JSON.parse(execFileSync('python3', ['-c', `import importlib.util,json,pathlib
root=pathlib.Path(${JSON.stringify(root)})
s=importlib.util.spec_from_file_location('policy',root/'scripts/prepare-codex-policy.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps([str(p) for p in m.verify_prepared(root)]))`], { encoding: 'utf8' }));
const names = ['agentmeld-m0-browser-' + id, 'agentmeld-m0-harness-' + id];
const options = ['--rm', '--network=none', '--read-only', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--security-opt=apparmor=agentmeld-m0-codex', '--security-opt=seccomp=' + policy[0], '--memory=1g', '--cpus=1', '--pids-limit=256', '--tmpfs=/tmp:rw,nosuid,nodev,size=268435456,mode=1777', '--tmpfs=/workspace:rw,nosuid,nodev,size=33554432,uid=1000,gid=1000,mode=700'];
let browser; let authority;
try {
  browser = new ContainerComputer('docker', ['--context', values.context, 'run', '--name', names[0], '-i', ...options, image, 'node', '/opt/agentmeld/private-browser-fixture.mjs']);
  const initial = await browser.request('init'); assert.equal(initial.ready, true);
  const inspected = JSON.parse(docker(['inspect', names[0]]))[0];
  assert.equal(inspected.HostConfig.NetworkMode, 'none'); assert.equal(inspected.HostConfig.PidMode, '');
  assert.equal(inspected.Mounts.length, 0); assert.deepEqual(inspected.HostConfig.PortBindings, {});
  authority = await RustAuthority.open(root + 'target/debug/agentmeld-m0', directory + '/journal.jsonl');
  const control = new RustBrowserControl(browser, authority);
  await control.takeover(); await control.privacy(control.generation, true);
  assert.deepEqual(await browser.request('fixture_private_entry'), { entered: true });
  await assert.rejects(control.frame(), /unavailable/);
  await assert.rejects(control.resume(control.generation));
  const harness = JSON.parse(docker(['run', '--name', names[1], ...options, image, 'node', '/opt/agentmeld/browser-isolation-probe.mjs']));
  assert.notEqual(harness.pidNamespace, initial.pidNamespace); assert.notEqual(harness.networkNamespace, initial.networkNamespace);
  assert.deepEqual(await browser.request('fixture_verify'), { profileIntact: true, sessionIntact: true });
  await browser.request('fixture_finish_login');
  await control.privacy(control.generation, false);
  const resumed = await control.resume(control.generation); assert.equal(resumed.mode, 'agent'); assert.equal(resumed.observation.counter, '1');
  await browser.request('fixture_verify');
  const report = { image, synthetic: true, separateContainers: true, sharedMounts: false, publishedPorts: false, namespaceIsolationVerified: true, nativeDeniedPaths: harness.deniedPaths, privateFrameDenied: true, privateResumeDenied: true, browserProfileAndSessionIntact: true, clearedFormBeforeResume: true, freshObservationVerified: true, realCredentials: false, liveInference: false };
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally {
  if (authority) await authority.close(); if (browser) await browser.close();
  for (const name of names) if (docker(['ps', '-a', '--format', '{{.Names}}']).trim().split('\n').includes(name)) docker(['rm', '-f', name]);
}
