// Owns two ephemeral containers and one isolated network in an explicit Docker context.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const { values } = parseArgs({ options: { context: { type: 'string' } } });
if (!values.context) throw Error('explicit --context required');
const root = fileURLToPath(new URL('../', import.meta.url));
const docker = args => execFileSync('docker', ['--context', values.context, ...args], { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
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
  docker(['create', '--name', worker, ...limits, '--security-opt=seccomp=' + policyPaths[0], '--security-opt=apparmor=agentmeld-m0-codex', '--network=' + network, '--dns=127.0.0.1', '--env=AGENTMELD_PROXY_IP=' + proxyIp, '--env=AGENTMELD_GATEWAY_IP=' + hostBridge, image, 'node', '/opt/agentmeld/provider-egress-probe.mjs']); createdWorker = true;
  const workerDetails = JSON.parse(docker(['inspect', worker]))[0];
  assert.deepEqual(Object.keys(workerDetails.NetworkSettings.Networks), [network]);
  assert.deepEqual(workerDetails.HostConfig.Dns, ['127.0.0.1']); assert.deepEqual(workerDetails.Mounts, []);
  const output = docker(['start', '-a', worker]);
  const exitCode = JSON.parse(docker(['inspect', worker]))[0].State.ExitCode;
  await writeFile(directory + '/report.json', output, { mode: 0o600 });
  assert.equal(exitCode, 0);
  const report = { image, networkMode: 'internal-isolated', ...JSON.parse(output) };
  await writeFile(directory + '/metadata.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally {
  const failures = [];
  for (const [created, command] of [[createdWorker, ['rm', '-f', worker]], [createdProxy, ['rm', '-f', proxy]], [createdNetwork, ['network', 'rm', network]]]) {
    if (created) { try { docker(command); } catch { failures.push(command[0]); } }
  }
  if (failures.length) throw Error('M0 cleanup incomplete; inspect the run-specific container/network names');
}
