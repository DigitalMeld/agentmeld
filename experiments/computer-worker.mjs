// Runs in the agent container. It has no journal handle, supervisor connection or viewer capability.
import { listWorkspace } from './workspace-tools.mjs';
import { normalizeArguments } from './tool-contract.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { startNativeFixture } from './codex-native-fixture.mjs';
import { readFile, access, appendFile, mkdir } from 'node:fs/promises';
let browser; let page; let native;
async function handle(op, args) {
  if (op === 'init' && !browser) {
    await mkdir('/tmp/home', { recursive: true });
    browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 15000 });
    page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.setContent('<title>Separated counter</title><style>button{position:absolute;left:280px;top:150px;width:80px;height:60px}</style><output>0</output><button>+1</button><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent++;</script>');
    return { ready: true };
  }
  if (op === 'native_start' && !native) {
    native = await startNativeFixture(args.tool || 'fixture_sum');
    return { frame: native.frame, threadId: native.threadId, turnId: native.turnId };
  }
  if (op === 'native_finish' && native) {
    try { return await native.finish(args.result); } finally { await native.close(); native = null; }
  }
  if (op === 'workspace_list') {
    normalizeArguments(op, args);
    return listWorkspace('/workspace');
  }
  if (op === 'fixture_sum') {
    normalizeArguments(op, args);
    return { sum: args.a + args.b };
  }
  if (op === 'linger_fixture') {
    spawn(process.execPath, ['/opt/agentmeld/linger-fixture.mjs', 'child'], { stdio: 'ignore' });
    for (let attempt = 0; attempt < 100; attempt++) {
      const lines = await readFile('/workspace/termination.jsonl', 'utf8').catch(() => '');
      if (lines.includes('"grandchild"')) return { started: true };
      await delay(20);
    }
    throw new Error('descendants did not start');
  }
  if (op === 'metrics') {
    return { cgroupPeakBytes: Number(await readFile('/sys/fs/cgroup/memory.peak', 'utf8')), workerRssBytes: process.memoryUsage().rss };
  }
  if (!page) throw new Error('not initialized');
  if (op === 'agent_click') { await page.getByRole('button', { name: '+1', exact: true }).click(); return { completed: true }; }
  if (op === 'human_click') {
    if (![args.x, args.y].every(Number.isFinite) || args.x < 0 || args.y < 0 || args.x >= 640 || args.y >= 360) throw new Error('invalid coordinates');
    await page.mouse.click(args.x, args.y); return { completed: true };
  }
  if (op === 'observe') return { counter: await page.locator('output').textContent(), png: (await page.screenshot()).toString('base64') };
  if (op === 'boundary') {
    // Synthetic canary only: the caller never passes credentials or a real retained data path.
    if (typeof args.canary !== 'string' || !args.canary.endsWith('/isolation-canary.txt')) throw new Error('invalid canary');
    const readable = await readFile(args.canary, 'utf8').then(() => true, () => false);
    const writable = await appendFile(args.canary, 'container-attempt').then(() => true, () => false);
    const socket = await access('/var/run/docker.sock').then(() => true, () => false);
    const controlMount = await access('/control').then(() => true, () => false);
    const status = await readFile('/proc/self/status', 'utf8');
    const routes = (await readFile('/proc/net/route', 'utf8')).trim().split('\n').length - 1;
    return { readable, writable, socket, controlMount, uid: process.getuid(), noNewPrivileges: /NoNewPrivs:\s+1/.test(status), zeroCapabilities: /CapEff:\s+0+\n/.test(status), routes };
  }
  throw new Error('unsupported operation');
}
let buffer = Buffer.alloc(0);
try {
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 65536) throw new Error('input limit');
    let end;
    while ((end = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
      const command = JSON.parse(line);
      if (!Number.isSafeInteger(command.id) || typeof command.op !== 'string' || !command.args || typeof command.args !== 'object') throw new Error('invalid request');
      try { console.log(JSON.stringify({ id: command.id, result: await handle(command.op, command.args) })); }
      catch { console.log(JSON.stringify({ id: command.id, error: 'operation rejected' })); }
    }
  }
  if (buffer.length) throw new Error('truncated input');
} finally { if (native) await native.close(); if (browser) await browser.close(); }
