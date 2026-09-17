// Explicit local qualification. The host owns control; the container owns only its computer.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { RustAuthority, RustBrowserControl } from '../experiments/rust-browser-control.mjs';
import { ContainerComputer } from '../experiments/container-computer.mjs';
import { OwnedWorker, dockerRuntime } from '../experiments/owned-worker.mjs';
import { startViewer } from '../experiments/viewer-server.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--context' || !args[1]) throw new Error('usage: node scripts/probe-separated.mjs --context CONTEXT');
const context = args[1];
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runId = randomUUID(); const workspaceName = `split-${runId}`;
const name = `agentmeld-m0-${runId}`;
const controlDirectory = join(root, '.local/m0/control', runId);
const workspaceRoot = join(root, '.local/m0/workspaces');
const workspace = join(workspaceRoot, workspaceName);
await mkdir(controlDirectory, { recursive: true, mode: 0o700 });
await mkdir(workspace, { recursive: true });
const journal = join(controlDirectory, 'journal.jsonl');
const canary = join(controlDirectory, 'isolation-canary.txt');
const canaryValue = `synthetic-${randomUUID()}`;
await writeFile(canary, canaryValue, { mode: 0o600 });
const binary = join(root, 'target/debug/agentmeld-m0');
const docker = args => execFileSync('docker', ['--context', context, ...args], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
const image = docker(['image', 'inspect', 'agentmeld-m0:local', '--format', '{{.Id}}']).trim();
const profile = execFileSync('python3', ['-c', 'import importlib.util,sys,pathlib; r=pathlib.Path(sys.argv[1]); s=importlib.util.spec_from_file_location("policy", r/"scripts/prepare-seccomp.py"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.verify_prepared(r))', root], { encoding: 'utf8', timeout: 15000 }).trim();
const plan = JSON.parse(execFileSync(binary, ['sandbox-plan', workspaceRoot, workspaceName, image], { encoding: 'utf8', timeout: 15000 }));
plan[plan.indexOf('--name') + 1] = name;
plan.splice(1, 0, '--cidfile', join(controlDirectory, 'worker.cid'), '-i', `--security-opt=seccomp=${profile}`);
plan[plan.length - 1] = '/opt/agentmeld/computer-worker.mjs';
let authority; let computer; let viewer;
const report = { phase: 'm0', architecture: 'host_supervisor_container_computer', image, runId, inferenceQualified: false, checks: {} };
const started = performance.now();
const stop = () => { try { docker(['stop', '--time', '1', name]); } catch { /* --rm may already have removed this exact owned container. */ } };
const deadline = setTimeout(() => { computer?.fail(new Error('probe deadline')); stop(); }, 90000);
try {
  authority = await RustAuthority.open(binary, journal, () => { computer?.fail(new Error('authority lost')); stop(); });
  computer = new ContainerComputer('docker', ['--context', context, ...plan], () => { authority?.request({ op: 'disconnect' }).catch(() => {}); stop(); });
  assert.equal((await computer.request('init')).ready, true);
  const inspected = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(inspected.Mounts.length, 1);
  assert.equal(inspected.Mounts[0].Destination, '/workspace');
  assert.equal(inspected.Mounts[0].Source, workspace);
  assert.equal(inspected.HostConfig.NetworkMode, 'none');
  assert.equal(inspected.HostConfig.Privileged, false);
  assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
  const boundary = await computer.request('boundary', { canary });
  assert.deepEqual(boundary, { readable: false, writable: false, socket: false, controlMount: false, uid: 1000, noNewPrivileges: true, zeroCapabilities: true, routes: 0 });
  assert.equal(await readFile(canary, 'utf8'), canaryValue);
  report.checks.controlStorage = { passed: true, onlyWorkspaceMounted: true, canaryReadDenied: true, canaryWriteDenied: true };
  const id = (await readFile(join(controlDirectory, 'worker.cid'), 'utf8')).trim();
  const worker = await OwnedWorker.bind({ id, image, workspace, computer, runtime: dockerRuntime(context) });
  const control = new RustBrowserControl(computer, authority, worker);
  viewer = await startViewer(control);
  const headers = { Authorization: `Bearer ${viewer.token}`, Origin: viewer.origin, 'Content-Type': 'application/json' };
  const post = async (path, body = {}) => {
    const response = await fetch(viewer.origin + path, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  };
  assert.equal((await fetch(viewer.origin + '/frame')).status, 401);
  await control.agentClick(0);
  let human = await post('/takeover');
  const hidden = await post('/private-begin', { generation: human.generation });
  assert.equal((await fetch(viewer.origin + '/frame', { headers })).status, 409);
  human = await post('/private-end', { generation: hidden.generation });
  report.checks.privateScreen = { passed: true, frameDenied: true, revealStaysHuman: human.mode === 'human' };
  await assert.rejects(control.agentClick(0), /stale/);
  await post('/input', { generation: human.generation, x: 320, y: 180 });
  const resumed = await post('/resume', { generation: human.generation });
  assert.equal(resumed.observation.counter, '2');
  await control.agentClick(resumed.generation);
  const observed = await control.frame(); assert.equal(observed.counter, '3');
  await writeFile(join(controlDirectory, 'computer.png'), Buffer.from(observed.png, 'base64'));
  await post('/disconnect');
  assert.equal(control.state().mode, 'paused');
  assert.equal((await fetch(viewer.origin + '/frame', { headers })).status, 410);
  report.checks.viewer = { passed: true, hostAuthenticated: true, takeover: true, freshObservation: true, finalCounter: '3', disconnectedPaused: true };
  report.resources = await computer.request('metrics');
  await viewer.close(); viewer = null;
  await computer.close(); computer = null;
  await authority.close();
  authority = await RustAuthority.open(binary, journal);
  assert.equal(authority.current.mode, 'paused');
  assert.equal(authority.current.pending, null);
  await assert.rejects(authority.request({ op: 'admit', actor: 'agent', generation: resumed.generation, action: { tool: 'fixture' } }), /stale/);
  report.checks.recovery = { passed: true, paused: true, staleGenerationRejected: true };
  report.journalSha256 = createHash('sha256').update(await readFile(journal)).digest('hex');
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  clearTimeout(deadline);
  try { if (viewer) await viewer.close(); } catch { /* Other cleanup must continue. */ }
  try { if (computer) await computer.close(); } catch { /* Stop owned container below. */ }
  try { if (authority) await authority.close(); } catch { /* Evidence stays intact. */ }
  stop();
  report.elapsedSeconds = Number(((performance.now() - started) / 1000).toFixed(3));
  await writeFile(join(controlDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
