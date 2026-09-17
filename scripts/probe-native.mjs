// Explicit local qualification. The host owns control; the container owns only its computer.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { RustAuthority } from '../experiments/rust-browser-control.mjs';
import { ContainerComputer } from '../experiments/container-computer.mjs';
import { NativeToolBroker } from '../experiments/native-tool-broker.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--context' || !args[1]) throw new Error('usage: node scripts/probe-native.mjs --context CONTEXT');
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
plan.splice(1, 0, '-i', `--security-opt=seccomp=${profile}`);
plan[plan.length - 1] = '/opt/agentmeld/computer-worker.mjs';
let authority; let computer;
const report = { phase: 'm0', native: 'codex_dynamic_tools', fixtureModel: true, liveInference: false, image, runId, cases: [] };
const stop = () => { try { docker(['stop', '--time', '1', name]); } catch { } };
const deadline = setTimeout(() => { computer?.fail(new Error('probe deadline')); stop(); }, 90000);
try {
  computer = new ContainerComputer('docker', ['--context', context, ...plan], () => { authority?.request({ op: 'disconnect' }).catch(() => {}); stop(); });
  for (const scenario of ['allow', 'deny', 'revoke']) {
    const start = performance.now();
    authority = await RustAuthority.open(binary, join(controlDirectory, scenario + '.jsonl'), () => { computer?.fail(new Error('authority lost')); stop(); });
    const native = await computer.request('native_start');
    const broker = new NativeToolBroker(authority, computer, { workspace: workspaceName, worker: name, thread: native.threadId, turn: native.turnId });
    const proposal = await broker.propose(native.frame);
    if (scenario === 'revoke') await authority.request({ op: 'cancel' });
    const toolResult = await broker.decide(proposal.id, scenario !== 'deny');
    assert.equal(toolResult.success, scenario === 'allow');
    const result = await computer.request('native_finish', { result: toolResult });
    assert.equal(result.turnStatus, 'completed');
    assert.equal(result.modelRequests, 2);
    assert.equal(result.toolOutputSeen, true);
    report.cases.push({ scenario, nativeCallback: native.frame.method, toolSuccess: toolResult.success, turnCompleted: true, toolOutputReturned: true, nativeVmHwmKiB: result.nativeVmHwmKiB, launcherVmHwmKiB: result.launcherVmHwmKiB, elapsedMs: Math.round(performance.now() - start) });
    await authority.close(); authority = null;
  }
  report.resources = await computer.request('metrics');
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  clearTimeout(deadline);
  try { if (computer) await computer.close(); } catch { }
  try { if (authority) await authority.close(); } catch { }
  stop();
  await writeFile(join(controlDirectory, 'native-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
