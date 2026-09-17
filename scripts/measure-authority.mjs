// Local filesystem/stdio sample only; not provider throughput or a sizing recommendation.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { RustAuthority } from '../experiments/rust-browser-control.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = join(root, '.local/m0/control', randomUUID());
await mkdir(directory, { recursive: true, mode: 0o700 });
const owner = await RustAuthority.open(join(root, 'target/debug/agentmeld-m0'), join(directory, 'measure.jsonl'));
const action = { tool: 'fixture_sum', arguments: { a: 2, b: 3 } };
const scope = { workspace: 'measurement', worker: 'fixture', thread: 'fixture', turn: 'fixture', request: 'fixture' };
try {
  const samples = [];
  for (let index = 0; index < 110; index++) {
    const start = performance.now();
    const proposal = await owner.request({ op: 'propose', generation: 0, action, scope: { ...scope, request: String(index) }, ttl_ms: 30000 });
    const allowed = await owner.request({ op: 'decide', approval_id: proposal.approval.id, action, scope: proposal.approval.scope, allow: true });
    await owner.request({ op: 'dispatch', generation: 0, actor: 'agent', ticket: allowed.pending, action });
    await owner.request({ op: 'settle', ticket: allowed.pending, action });
    if (index >= 10) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const rounded = value => Number(value.toFixed(3));
  const report = { platform: process.platform, architecture: process.arch, samples: samples.length, warmupCycles: 10, operation: 'propose/allow/dispatch/settle, four synced journal writes, no tool I/O', cycleMs: { p50: rounded(samples[49]), p95: rounded(samples[94]), max: rounded(samples.at(-1)) }, supervisorRssKiB: Number(execFileSync('ps', ['-o', 'rss=', '-p', String(owner.process.pid)], { encoding: 'utf8', timeout: 5000 }).trim()), liveInference: false };
  await writeFile(join(directory, 'authority-measurement.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await owner.close(); }
