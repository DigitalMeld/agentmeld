// Explicit local qualification. The host owns control; the container owns only its computer.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { RustAuthority, RustBrowserControl } from '../experiments/rust-browser-control.mjs';
import { ContainerComputer } from '../experiments/container-computer.mjs';
import { OwnedWorker, dockerRuntime } from '../experiments/owned-worker.mjs';
import { startViewer } from '../experiments/viewer-server.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--context' || !args[1]) throw new Error('usage: node scripts/probe-cancellation.mjs --context CONTEXT');
const context = args[1];
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runId = randomUUID(); const workspaceName = `split-${runId}`;
const name = `agentmeld-m0-${runId}`;
const controlDirectory = join(root, '.local/m0/control', runId);
const workspaceRoot = join(root, '.local/m0/workspaces');
const workspace = join(workspaceRoot, workspaceName);
await mkdir(controlDirectory, { recursive: true, mode: 0o700 });
await mkdir(workspace, { recursive: true });
const binary = join(root, 'target/debug/agentmeld-m0');
const docker = args => execFileSync('docker', ['--context', context, ...args], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
const image = docker(['image', 'inspect', 'agentmeld-m0:local', '--format', '{{.Id}}']).trim();
const profile = execFileSync('python3', ['-c', 'import importlib.util,sys,pathlib; r=pathlib.Path(sys.argv[1]); s=importlib.util.spec_from_file_location("policy", r/"scripts/prepare-seccomp.py"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.verify_prepared(r))', root], { encoding: 'utf8', timeout: 15000 }).trim();
const plan = JSON.parse(execFileSync(binary, ['sandbox-plan', workspaceRoot, workspaceName, image], { encoding: 'utf8', timeout: 15000 }));
plan[plan.indexOf('--name') + 1] = name;
plan.splice(1, 0, '--cidfile', join(controlDirectory, 'worker.cid'), '-i', `--security-opt=seccomp=${profile}`);
plan[plan.length - 1] = '/opt/agentmeld/computer-worker.mjs';
let authority; let computer; let viewer;
const report = { phase: 'm0', image, runId, liveInference: false, checks: {} };
const stop = () => { try { docker(['stop', '--time', '1', name]); } catch { } };
const deadline = setTimeout(stop, 30000);
try {
  authority = await RustAuthority.open(binary, join(controlDirectory, 'cancel.jsonl'), stop);
  computer = new ContainerComputer('docker', ['--context', context, ...plan], stop);
  assert.equal((await computer.request('linger_fixture')).started, true);
  const id = (await readFile(join(controlDirectory, 'worker.cid'), 'utf8')).trim();
  const worker = await OwnedWorker.bind({ id, image, workspace, computer, runtime: dockerRuntime(context) });
  const control = new RustBrowserControl(computer, authority, worker);
  viewer = await startViewer(control);
  const beats = await readFile(join(workspace, 'termination.jsonl'), 'utf8');
  const roles = new Set(beats.trim().split('\n').map(line => JSON.parse(line).role));
  assert.deepEqual([...roles].sort(), ['child', 'grandchild']);
  await delay(100);
  assert.ok((await readFile(join(workspace, 'termination.jsonl'), 'utf8')).length > beats.length);
  const before = performance.now();
  const response = await fetch(viewer.origin + '/cancel', { method: 'POST', headers: { Authorization: `Bearer ${viewer.token}`, Origin: viewer.origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).termination, 'stopped');
  await viewer.close(); viewer = null;
  const remaining = docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}}']).trim().split('\n');
  assert.equal(remaining.includes(id), false);
  const stopped = await readFile(join(workspace, 'termination.jsonl'), 'utf8');
  await delay(200);
  assert.equal(await readFile(join(workspace, 'termination.jsonl'), 'utf8'), stopped);
  await assert.rejects(computer.request('metrics'), /unavailable|disconnected/);
  await authority.close();
  authority = await RustAuthority.open(binary, join(controlDirectory, 'cancel.jsonl'));
  assert.equal(authority.current.mode, 'cancelled');
  report.checks = { descendantsStarted: [...roles].sort(), httpCancellationConfirmed: true, runtimeIdentityVerified: true, heartbeatActiveBeforeCancel: true, containerAbsent: true, heartbeatStopped: true, restartCancelled: true, elapsedMs: Math.round(performance.now() - before) };
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  clearTimeout(deadline); stop();
  try { if (viewer) await viewer.close(); } catch { }
  try { if (computer) await computer.close(); } catch { }
  try { if (authority) await authority.close(); } catch { }
  await writeFile(join(controlDirectory, 'cancellation-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
