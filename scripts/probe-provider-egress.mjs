// Owns two ephemeral containers and one isolated network in an explicit Docker context.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateStore, storeMount } from '../experiments/codex-auth-store.mjs';
import assert from 'node:assert/strict';
import { validateQuotaVolume } from '../experiments/quota-volume.mjs';
import { runLiveBrowser } from '../experiments/live-browser-qualification.mjs';
import { setTimeout as delay } from 'node:timers/promises';
const { values } = parseArgs({ options: { context: { type: 'string' }, 'device-login': { type: 'boolean', default: false }, subscription: { type: 'boolean', default: false }, execution: { type: 'boolean', default: false }, control: { type: 'boolean', default: false }, browser: { type: 'boolean', default: false }, 'workspace-stage': { type: 'string' }, 'workspace-instance': { type: 'string' } } });
const workspaceStage = values['workspace-stage'];
if (workspaceStage || values['workspace-instance']) {
  assert.ok(['write', 'read'].includes(workspaceStage));
  assert.equal(values.context, 'colima-agentmeld-m0');
  assert.ok(!values.browser && !values.control && !values.execution && !values['device-login']);
  values.subscription = true;
}
if ([values.control, values.execution, values.browser].filter(Boolean).length > 1) throw Error('select one probe mode');
if (values.execution || values.control || values.browser) values.subscription = true;
if (values.subscription && values['device-login']) throw Error('select one probe mode');
if (!values.context) throw Error('explicit --context required');
const root = fileURLToPath(new URL('../', import.meta.url));
const docker = args => execFileSync('docker', ['--context', values.context, ...args], { encoding: 'utf8', timeout: (values.execution || values.control) ? 300000 : values.subscription ? 90000 : 45000, maxBuffer: 1024 * 1024 });
const run = randomUUID(); const network = 'agentmeld-m0-net-' + run; const proxy = 'agentmeld-m0-proxy-' + run; const worker = 'agentmeld-m0-egress-' + run;
const directory = root + '.local/m0/egress/' + run; await mkdir(directory, { recursive: true });
const image = docker(['image', 'inspect', 'agentmeld-m0:local', '--format', '{{.Id}}']).trim();
assert.match(image, /^sha256:[a-f0-9]{64}$/);
const policyPaths = JSON.parse(execFileSync('python3', ['-c', `import importlib.util,json,pathlib
root=pathlib.Path(${JSON.stringify(root)})
spec=importlib.util.spec_from_file_location("policy",root/"scripts/prepare-codex-policy.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps([str(p) for p in module.verify_prepared(root)]))`], { encoding: 'utf8' }));
const limits = ['--read-only', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--cpus=1', '--pids-limit=64', '--tmpfs=/tmp:rw,nosuid,nodev,size=33554432,mode=1777'];
let workspaceMount;
if (workspaceStage) {
  const name = 'agentmeld-m0-quota-' + values['workspace-instance'];
  workspaceMount = validateQuotaVolume(JSON.parse(docker(['volume', 'inspect', name]))[0], values['workspace-instance']);
}
let store;
if (values.subscription) {
  const events = (await readFile(root + '.local/m0/subscription/store.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  store = events[0]; assert.equal(store.context, values.context);
  assert.equal(docker(['info', '--format', '{{.ID}}']).trim(), store.engine);
  assert.ok(events.some(e => e.status === 'subscription-auth-imported' && e.instance === store.instance));
  validateStore(JSON.parse(docker(['volume', 'inspect', store.name]))[0], store.name, store.instance);
}
let createdNetwork = false; let createdProxy = false; let createdWorker = false;
try {
  docker(['network', 'create', '--internal', '--opt=com.docker.network.bridge.gateway_mode_ipv4=isolated', network]); createdNetwork = true;
  const net = JSON.parse(docker(['network', 'inspect', network]))[0];
  assert.equal(net.Internal, true); assert.equal(net.Options['com.docker.network.bridge.gateway_mode_ipv4'], 'isolated');
  assert.equal(net.IPAM.Config[0].Gateway, undefined);
  const hostBridge = JSON.parse(docker(['network', 'inspect', 'bridge']))[0].IPAM.Config[0].Gateway;
  assert.match(hostBridge, /^\d+\.\d+\.\d+\.\d+$/);
  docker(['create', '--name', proxy, ...limits, '--network=bridge', image, 'node', '/opt/agentmeld/provider-egress-server.mjs']); createdProxy = true;
  docker(['network', 'connect', network, proxy]); docker(['start', proxy]);
  let ready = false;
  for (let i = 0; i < 30; i++) { if (docker(['logs', proxy]).includes('provider-egress-ready')) { ready = true; break; } await delay(100); }
  assert.ok(ready);
  const details = JSON.parse(docker(['inspect', proxy]))[0];
  assert.equal(details.HostConfig.Privileged, false); assert.deepEqual(details.Mounts, []);
  assert.equal(Object.keys(details.HostConfig.PortBindings ?? {}).length, 0);
  const proxyIp = details.NetworkSettings.Networks[network].IPAddress;
  docker(['create', '--name', worker, ...(values.browser ? ['-i'] : []), ...limits, ...(store ? ['--memory=1g', '--pids-limit=256', ...(workspaceMount ? ['--mount=' + workspaceMount, '--env=AGENTMELD_QUOTA_INSTANCE=' + values['workspace-instance'], '--env=AGENTMELD_WORKSPACE_STAGE=' + workspaceStage] : ['--tmpfs=/workspace:rw,nosuid,nodev,size=33554432,uid=1000,gid=1000,mode=700']), '--mount=' + storeMount(store.name), '--env=AGENTMELD_STORE_INSTANCE=' + store.instance] : []), '--security-opt=seccomp=' + policyPaths[0], '--security-opt=apparmor=agentmeld-m0-codex', '--network=' + network, '--dns=127.0.0.1', '--env=AGENTMELD_PROXY_IP=' + proxyIp, '--env=AGENTMELD_GATEWAY_IP=' + hostBridge, image, 'node', values.browser ? '/opt/agentmeld/codex-live-server.mjs' : workspaceStage ? '/opt/agentmeld/codex-live-workspace-probe.mjs' : values.control ? '/opt/agentmeld/codex-live-control-probe.mjs' : values.execution ? '/opt/agentmeld/codex-live-execution-probe.mjs' : values.subscription ? '/opt/agentmeld/codex-subscription-probe.mjs' : values['device-login'] ? '/opt/agentmeld/codex-device-egress-probe.mjs' : '/opt/agentmeld/provider-egress-probe.mjs']); createdWorker = true;
  const workerDetails = JSON.parse(docker(['inspect', worker]))[0];
  assert.deepEqual(Object.keys(workerDetails.NetworkSettings.Networks), [network]);
  assert.deepEqual(workerDetails.HostConfig.Dns, ['127.0.0.1']); if (store) { assert.equal(workerDetails.Mounts.length, workspaceMount ? 2 : 1); assert.equal(workerDetails.Mounts.find(m => m.Destination === '/agentmeld-home')?.Name, store.name); if (workspaceMount) assert.equal(workerDetails.Mounts.find(m => m.Destination === '/workspace')?.Name, 'agentmeld-m0-quota-' + values['workspace-instance']); }
  else assert.deepEqual(workerDetails.Mounts, []);
  let output;
  try { output = values.browser ? JSON.stringify(await runLiveBrowser({ context: values.context, root, directory, worker, image, policy: policyPaths[0], docker })) : docker(['start', '-a', worker]); }
  catch (error) { if (!Number.isInteger(error.status) || typeof error.stdout !== 'string') throw error; output = error.stdout; }
  await writeFile(directory + '/routing.jsonl', docker(['logs', proxy]), { mode: 0o600 });
  if (values.browser) docker(['wait', worker]);
  const exitCode = JSON.parse(docker(['inspect', worker]))[0].State.ExitCode;
  await writeFile(directory + '/report.json', output, { mode: 0o600 });
  const report = { image, networkMode: 'internal-isolated', ...JSON.parse(output) };
  await writeFile(directory + '/metadata.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
  assert.equal(exitCode, 0);
} finally {
  const failures = [];
  for (const [created, command] of [[createdWorker, ['rm', '-f', worker]], [createdProxy, ['rm', '-f', proxy]], [createdNetwork, ['network', 'rm', network]]]) {
    if (created) { try { docker(command); } catch { failures.push(command[0]); } }
  }
  if (failures.length) throw Error('M0 cleanup incomplete; inspect the run-specific container/network names');
}
