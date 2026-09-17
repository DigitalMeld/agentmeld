// Runs only in the offline, credential-free M0 image. Never imports host settings.
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { chromium } from 'playwright';
import { RustAuthority, RustBrowserControl } from './rust-browser-control.mjs';
import { randomUUID } from 'node:crypto';
import { startViewer } from './viewer-server.mjs';

const report = { phase: 'm0', offline: true, inferenceQualified: false, checks: {} };
async function check(name, fn) {
  const start = performance.now();
  try { report.checks[name] = { status: 'passed', ...(await fn()), elapsedMs: Math.round(performance.now() - start) }; }
  catch (error) { report.checks[name] = { status: 'failed', reason: String(error.message).slice(0, 16000), elapsedMs: Math.round(performance.now() - start) }; }
}
await mkdir('/tmp/home/.codex', { recursive: true });

await check('os_boundary', async () => {
  assert.equal(process.getuid(), 1000);
  const status = await readFile('/proc/self/status', 'utf8');
  const chroot = spawnSync('chroot', ['/tmp', '/bin/true'], { encoding: 'utf8' });
  assert.notEqual(chroot.status, 0);
  assert.match(chroot.stderr, /Operation not permitted/, 'outer container must not gain chroot capability');
  assert.match(status, /CapEff:\s+0+\n/);
  assert.match(status, /NoNewPrivs:\s+1/);
  assert.match(status, /Seccomp:\s+2/);
  for (const path of ['/var/run/docker.sock', '/Users', '/root/.ssh', '/app.db', '/browser-profile']) {
    await assert.rejects(access(path));
  }
  await assert.rejects(writeFile('/opt/agentmeld/should-not-write', 'fixture'));
  const routes = await readFile('/proc/net/route', 'utf8');
  assert.equal(routes.trim().split('\n').length, 1, 'offline container has a route');
  const interfaces = (await readFile('/proc/net/dev', 'utf8')).trim().split('\n').slice(2);
  assert.equal(interfaces.length, 1, 'offline container has non-loopback interface');
  await writeFile('/workspace/result.txt', 'agentmeld-m0 fixture artifact\n');
  assert.equal(await readFile('/workspace/result.txt', 'utf8'), 'agentmeld-m0 fixture artifact\n');
  return { uid: process.getuid(), rootReadOnly: true, noNewPrivileges: true, seccomp: true, externalNetwork: false };
});

await check('codex_stdio_handshake', async () => {
  const proc = spawn('/opt/agentmeld/node_modules/.bin/codex', ['app-server', '--stdio'], {
    cwd: '/workspace', env: { PATH: process.env.PATH, HOME: '/tmp/home', CODEX_HOME: '/tmp/home/.codex' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map(); let buffer = ''; let stderrBytes = 0; let stderrTail = '';
  const fail = error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); };
  proc.on('error', fail);
  proc.on('exit', () => fail(new Error(`Codex exited before response: ${stderrTail}`)));
  proc.stderr.on('data', chunk => { stderrBytes += chunk.length; stderrTail = (stderrTail + chunk.toString()).slice(-2000); if (stderrBytes > 1024 * 1024) { fail(new Error('stderr limit')); proc.kill(); } });
  proc.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer) > 1024 * 1024) { fail(new Error('stdout frame limit')); proc.kill(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const frame = JSON.parse(line);
        if (frame.method && frame.id !== undefined) {
          // No server request is automatically approved during handshake.
          proc.stdin.write(JSON.stringify({ id: frame.id, error: { code: -32601, message: 'M0 request denied' } }) + '\n');
        } else if (pending.has(frame.id)) {
          const waiter = pending.get(frame.id); pending.delete(frame.id);
          waiter.resolve(frame);
        }
      } catch { fail(new Error('Codex emitted invalid JSON')); }
    }
  });
  function request(id, method, params) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, 15000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  try {
    const initialized = await request(1, 'initialize', { clientInfo: { name: 'agentmeld_m0', title: 'AgentMeld M0', version: '0.1.0' }, capabilities: { experimentalApi: false } });
    assert.ok(initialized.result, 'initialize did not return result');
    proc.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const threads = await request(2, 'thread/list', { limit: 1 });
    assert.ok(Array.isArray(threads.result?.data), 'thread/list did not return data');
    assert.equal(threads.result.data.length, 0, 'unexpected inherited session');
    const missing = await request(3, 'thread/resume', { threadId: '00000000-0000-0000-0000-000000000000' });
    assert.ok(missing.error, 'missing continuation must fail');
    return { initialized: true, inheritedThreads: 0, missingContinuationRejected: true, inferenceAttempted: false };
  } finally {
    proc.stdin.end(); proc.kill('SIGTERM');
    const timer = setTimeout(() => proc.kill('SIGKILL'), 1000); timer.unref();
    await new Promise(resolve => { if (proc.exitCode !== null || proc.signalCode) resolve(); else proc.once('exit', resolve); });
    clearTimeout(timer);
  }
});

await check('claude_sdk_unauthenticated', async () => {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 20000);
  let result; let frames = 0;
  const session = query({ prompt: 'Reply with the single word READY. Do not use tools.', options: {
    cwd: '/workspace', env: { PATH: process.env.PATH, HOME: '/tmp/home' },
    settingSources: [], tools: [], maxTurns: 1, persistSession: false,
    includePartialMessages: true, permissionMode: 'default', abortController,
    canUseTool: async () => ({ behavior: 'deny', message: 'No tools granted in M0 auth probe' }),
  } });
  try {
    for await (const frame of session) {
      if (++frames > 1000) throw new Error('Claude output limit exceeded');
      if (frame.type === 'result') result = frame;
    }
    assert.ok(result?.is_error, 'credential-free run must return an error');
    return { initialized: true, missingCredentialsRejected: true, resultSubtype: result.subtype, liveInference: false };
  } catch (error) {
    if (!abortController.signal.aborted && /Claude Code returned an error result: Not logged in/.test(String(error.message))) {
      return { initialized: true, missingCredentialsRejected: true, errorPath: 'sdk_exception', liveInference: false };
    }
    throw error;
  } finally { clearTimeout(timer); abortController.abort(); session.close(); }
});

await check('chromium_with_renderer_sandbox', async () => {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 15000 });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>M0 fixture</title><button id="increment">Increment</button><output>0</output><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent++;</script>');
    await page.getByRole('button', { name: 'Increment' }).click();
    assert.equal(await page.locator('output').textContent(), '1');
    await page.screenshot({ path: '/workspace/browser.png' });
    const outer = await readFile('/proc/self/status', 'utf8');
    const outerFilters = Number(outer.match(/Seccomp_filters:\s+(\d+)/)?.[1]);
    const outerDepth = outer.match(/NSpid:\s+([^\n]+)/)[1].trim().split(/\s+/).length;
    const renderers = [];
    const cdp = await browser.newBrowserCDPSession();
    const processes = await cdp.send('SystemInfo.getProcessInfo');
    for (const process of processes.processInfo.filter(item => item.type === 'renderer')) {
      const pid = process.id;
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      assert.match(status, /CapEff:\s+0+\n/);
      assert.match(status, /NoNewPrivs:\s+1/);
      assert.match(status, /Seccomp:\s+2/);
      const filters = Number(status.match(/Seccomp_filters:\s+(\d+)/)?.[1]);
      const depth = status.match(/NSpid:\s+([^\n]+)/)[1].trim().split(/\s+/).length;
      assert.ok(filters > outerFilters, 'renderer needs its own additional seccomp filter');
      assert.ok(depth > outerDepth, 'renderer needs a nested PID namespace');
      renderers.push({ filters, pidNamespaceDepth: depth });
    }
    assert.ok(renderers.length > 0, 'no renderer processes observed');
    return { isolatedFixture: true, rendererSandboxEnabled: true, renderers, screenshot: 'browser.png' };
  } finally { await browser.close(); }
});

await check('browser_viewer_takeover', async () => {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 15000 });
  let viewer; let authority;
  try {
    const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const target = await context.newPage();
    await target.setContent('<title>Isolated counter</title><style>body{font:20px system-ui;background:#eef2f4}button{position:absolute;left:280px;top:150px;width:80px;height:60px}</style><h1>Counter fixture</h1><output>0</output><button>+1</button><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent++;</script>');
    let observed;
    const journal = `/workspace/control-${randomUUID()}.jsonl`;
    authority = await RustAuthority.open('/usr/local/bin/agentmeld-m0', journal, () => browser.close().catch(() => {}));
    const control = new RustBrowserControl({
      agentClick: () => target.getByRole('button', { name: '+1', exact: true }).click(),
      humanClick: (x, y) => target.mouse.click(x, y),
      observe: async () => {
        observed = { counter: await target.locator('output').textContent(), png: (await target.screenshot()).toString('base64') };
        return observed;
      },
    }, authority);
    await control.agentClick(0);
    viewer = await startViewer(control);
    assert.equal((await fetch(viewer.origin + '/frame')).status, 401);
    const uiContext = await browser.newContext({ viewport: { width: 1000, height: 800 }, extraHTTPHeaders: { Authorization: `Bearer ${viewer.token}` } });
    const ui = await uiContext.newPage();
    await ui.goto(viewer.origin);
    await ui.getByRole('button', { name: 'Take control', exact: true }).click();
    await ui.getByText('You have control', { exact: true }).waitFor();
    await assert.rejects(control.agentClick(0), /stale/);
    await ui.locator('#screen').click({ position: { x: 320, y: 180 } });
    await target.waitForFunction(() => document.querySelector('output').textContent === '2');
    await ui.getByRole('button', { name: 'Resume agent', exact: true }).click();
    await ui.getByText('Agent has control', { exact: true }).waitFor();
    assert.equal(observed.counter, '2');
    await control.agentClick(control.generation);
    assert.equal(await target.locator('output').textContent(), '3');
    await ui.waitForFunction(() => document.querySelector('#screen').dataset.counter === '3');
    await ui.screenshot({ path: '/workspace/viewer.png' });
    await ui.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await ui.getByText('Disconnected · agent remains paused', { exact: true }).waitFor();
    assert.equal(control.state().mode, 'paused');
    await assert.rejects(control.agentClick(control.generation), /stale/);
    await viewer.close(); viewer = null;
    const lastGeneration = control.generation;
    await authority.close();
    authority = await RustAuthority.open('/usr/local/bin/agentmeld-m0', journal);
    assert.equal(authority.current.mode, 'paused');
    assert.ok(authority.current.generation > lastGeneration);
    await assert.rejects(authority.request({ op: 'admit', generation: lastGeneration, actor: 'agent' }), /stale/);
    return { authority: 'rust_journal', restartPaused: true, authenticated: true, takeover: true, staleAgentRejected: true, freshObservationCounter: '2', resumedCounter: '3', disconnectPaused: true, screenshot: 'viewer.png', transport: 'container_loopback' };
  } finally { if (viewer) await viewer.close(); if (authority) await authority.close(); await browser.close(); }
});

await check('persistent_workspace', async () => {
  const prior = JSON.parse(await readFile('/workspace/boot-count.json', 'utf8').catch(() => '0'));
  await writeFile('/workspace/boot-count.json', JSON.stringify(prior + 1));
  return { priorRuns: prior, currentRun: prior + 1 };
});

console.log(JSON.stringify(report, null, 2));
if (Object.values(report.checks).some(check => check.status === 'failed')) process.exitCode = 1;
