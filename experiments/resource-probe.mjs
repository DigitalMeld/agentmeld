// Sustained offline baseline: native harness + sandboxed Chromium, synthetic work only.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { runCommandFixture } from './codex-command-fixture.mjs';
const home = '/tmp/resource-home'; await mkdir(home + '/.codex', { recursive: true });
await writeFile(home + '/.codex/config.toml', `default_permissions = "fixture"
[permissions.fixture.filesystem]
":root" = "read"
"${home}" = "deny"
"/workspace" = "write"
[permissions.fixture.network]
enabled = false
`);
const parseCounters = value => Object.fromEntries(value.trim().split('\n').map(line => { const [key, n] = line.split(/\s+/); return [key, Number(n)]; }));
async function sample() {
  return { atMs: performance.now(), memoryBytes: Number(await readFile('/sys/fs/cgroup/memory.current', 'utf8')), cpu: parseCounters(await readFile('/sys/fs/cgroup/cpu.stat', 'utf8')) };
}
function summarize(samples) {
  const first = samples[0]; const last = samples.at(-1); const elapsedMs = last.atMs - first.atMs;
  const memory = samples.map(s => s.memoryBytes).sort((a,b) => a-b);
  return { samples: samples.length, elapsedMs, memoryMinBytes: memory[0], memoryMedianBytes: memory[Math.floor(memory.length / 2)], memoryMaxBytes: memory.at(-1), memoryFirstBytes: first.memoryBytes, memoryLastBytes: last.memoryBytes, cpuPercentOfOneCore: (last.cpu.usage_usec - first.cpu.usage_usec) / (elapsedMs * 10) };
}
const initialEvents = parseCounters(await readFile('/sys/fs/cgroup/memory.events', 'utf8'));
const startedAt = performance.now();
const native = spawn('/opt/agentmeld/node_modules/.bin/codex', ['app-server', '--stdio'], { env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home + '/.codex' }, stdio: ['pipe', 'pipe', 'pipe'] });
native.stderr.resume(); let browser; let closing = false;
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(Error('native startup timeout')), 10000);
  let buffered = '';
  native.on('error', reject);
  native.on('exit', () => { if (!closing) reject(Error('native exited')); });
  native.stdout.on('data', chunk => {
    buffered += chunk; let end;
    while ((end = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
      try { const frame = JSON.parse(line); if (frame.id === 1) { clearTimeout(timeout); if (frame.error) reject(Error('native init rejected')); else resolve(); } } catch { reject(Error('native protocol invalid')); }
    }
  });
  native.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agentmeld_m0_resources', version: '0.1.0' } } }) + '\n');
});
try {
  await ready; native.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 15000 });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.setContent('<button onclick="this.textContent=Number(this.textContent)+1">0</button>');
  await writeFile('/workspace/resource-counter', '0');
  const startupMs = performance.now() - startedAt;
  const phases = {}; const latencies = []; let iterations = 0; let screenshotBytes = 0;
  for (const [name, durationMs] of [['idle', 60000], ['active', 60000], ['cooldown', 30000]]) {
    console.log(JSON.stringify({ phase: 'm0', resourcePhase: name, status: 'started' }));
    const begin = performance.now(); const samples = [await sample()];
    while (performance.now() - begin < durationMs) {
      assert.equal(native.exitCode, null); assert.equal(native.signalCode, null);
      if (name === 'active') {
        const turnStart = performance.now();
        const turn = await runCommandFixture({ home, command: `node -e "require('node:fs').writeFileSync('/workspace/resource-counter', '${iterations + 1}')"` });
        assert.equal(turn.status, 'completed');
        assert.equal(await readFile('/workspace/resource-counter', 'utf8'), String(iterations + 1));
        await page.getByRole('button').click(); iterations++;
        assert.equal(await page.getByRole('button').textContent(), String(iterations));
        const png = await page.screenshot(); assert.ok(png.length > 0 && png.length < 1024 * 1024); screenshotBytes += png.length;
        latencies.push(performance.now() - turnStart);
      }
      await delay(1000); samples.push(await sample());
    }
    phases[name] = summarize(samples);
  }
  const finalEvents = parseCounters(await readFile('/sys/fs/cgroup/memory.events', 'utf8'));
  assert.equal(finalEvents.oom_kill, initialEvents.oom_kill); assert.ok(iterations >= 10);
  latencies.sort((a,b) => a-b); const percentile = p => latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)];
  console.log(JSON.stringify({ phase: 'm0', startupMs, phases, iterations, screenshotBytes, workCycleMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: latencies.at(-1) }, memoryPeakBytes: Number(await readFile('/sys/fs/cgroup/memory.peak', 'utf8')), memoryLimitBytes: Number(await readFile('/sys/fs/cgroup/memory.max', 'utf8')), oomKills: finalEvents.oom_kill - initialEvents.oom_kill, modelConfiguration: 'gpt-5.5', liveInference: false, realCredentials: false }));
} finally {
  closing = true; if (browser) await browser.close();
  const exited = new Promise(resolve => { if (native.exitCode !== null || native.signalCode) resolve(); else native.once('exit', resolve); });
  native.stdin.end(); native.kill('SIGTERM'); const timer = setTimeout(() => native.kill('SIGKILL'), 1000); await exited; clearTimeout(timer);
}
