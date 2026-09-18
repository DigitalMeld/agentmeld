// Fixed-size disposable filesystem in the dedicated M0 VM; no host block devices.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { values } = parseArgs({ options: { context: { type: 'string' }, subscription: { type: 'boolean', default: false } } });
if (values.context !== 'colima-agentmeld-m0') throw Error('this operator probe requires the dedicated colima-agentmeld-m0 context');
const docker = args => execFileSync('docker', ['--context', values.context, ...args], { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
const vm = args => execFileSync('colima', ['ssh', '--profile', 'agentmeld-m0', '--', ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
const root = fileURLToPath(new URL('../', import.meta.url)); const instance = randomUUID(); const volume = 'agentmeld-m0-quota-' + instance;
const image = docker(['image', 'inspect', 'agentmeld-m0:local', '--format', '{{.Id}}']).trim(); assert.match(image, /^sha256:[a-f0-9]{64}$/);
const containers = []; let directory; let device; let created = false;
try {
  directory = vm(['mktemp', '-d', '/var/tmp/agentmeld-m0-quota.XXXXXX']).trim(); assert.match(directory, /^\/var\/tmp\/agentmeld-m0-quota\.[A-Za-z0-9]{6}$/);
  const backing = directory + '/workspace.img';
  vm(['truncate', '-s', '67108864', backing]);
  vm(['mkfs.ext4', '-q', '-F', '-m', '0', backing]);
  device = vm(['sudo', 'losetup', '--find', '--show', '--nooverlap', backing]).trim(); assert.match(device, /^\/dev\/loop\d+$/);
  assert.ok(!docker(['volume', 'ls', '--format', '{{.Name}}']).trim().split('\n').includes(volume));
  docker(['volume', 'create', '--driver=local', '--label=io.digitalmeld.agentmeld.quota-instance=' + instance, '--opt=type=ext4', '--opt=device=' + device, '--opt=o=nodev,nosuid', volume]); created = true;
  const details = JSON.parse(docker(['volume', 'inspect', volume]))[0];
  assert.equal(details.Labels['io.digitalmeld.agentmeld.quota-instance'], instance); assert.equal(details.Options.device, device);
  const limits = ['--rm', '--read-only', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--cpus=1', '--pids-limit=64', '--mount=type=volume,source=' + volume + ',target=/workspace,volume-nocopy', '--tmpfs=/tmp:rw,nosuid,nodev,size=33554432,mode=1777'];
  const initializer = volume + '-init'; containers.push(initializer);
  docker(['run', '--name', initializer, ...limits, '--user=0:0', '--cap-add=CHOWN', image, 'node', '-e', "const fs=require('node:fs');fs.chmodSync('/workspace',0o700);fs.chownSync('/workspace',1000,1000)"]);
  const reports = [];
  for (let i = 0; i < 2; i++) {
    const name = volume + '-' + i; containers.push(name);
    reports.push(JSON.parse(docker(['run', '--name', name, ...limits, '--user=1000:1000', '--env=AGENTMELD_QUOTA_INSTANCE=' + instance, '--env=AGENTMELD_QUOTA_FIRST=' + (i === 0 ? '1' : '0'), image, 'node', '/opt/agentmeld/workspace-quota-probe.mjs'])));
  }
  const liveReports = [];
  if (values.subscription) for (const stage of ['write', 'read']) {
    liveReports.push(JSON.parse(execFileSync(process.execPath, [root + 'scripts/probe-provider-egress.mjs', '--context', values.context, '--workspace-stage', stage, '--workspace-instance', instance], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 })));
  }
  const report = { liveReports, phase: 'm0', image, budgetBytes: 67108864, backingBytes: Number(vm(['stat', '--format=%s', backing]).trim()), reports, synthetic: true };
  assert.equal(report.backingBytes, report.budgetBytes);
  await mkdir(root + '.local/m0/quota', { recursive: true }); await writeFile(root + '.local/m0/quota/' + instance + '.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally {
  // Stop only owned containers before unmounting; retain evidence if identity cannot be verified.
  for (const name of containers) if (docker(['ps', '-a', '--format', '{{.Names}}']).trim().split('\n').includes(name)) docker(['rm', '-f', name]);
  if (created) {
    const details = JSON.parse(docker(['volume', 'inspect', volume]))[0];
    assert.equal(details.Labels['io.digitalmeld.agentmeld.quota-instance'], instance); assert.equal(details.Options.device, device);
    docker(['volume', 'rm', volume]);
  }
  if (device) {
    const loops = JSON.parse(vm(['sudo', 'losetup', '--json', '--list', '--output', 'NAME,BACK-FILE', device])).loopdevices;
    assert.equal(loops.length, 1); assert.equal(loops[0].name, device); assert.equal(loops[0]['back-file'], directory + '/workspace.img');
    vm(['sudo', 'losetup', '--detach', device]);
  }
  if (directory && /^\/var\/tmp\/agentmeld-m0-quota\.[A-Za-z0-9]{6}$/.test(directory)) {
    vm(['rm', '-f', directory + '/workspace.img']); vm(['rmdir', directory]);
  }
}
