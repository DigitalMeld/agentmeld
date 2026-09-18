// Explicit live subscription qualification. Host owns browser authority and viewer capability.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { ContainerComputer } from './container-computer.mjs';
import { RustAuthority, RustBrowserControl } from './rust-browser-control.mjs';
import { LiveClient } from './codex-live-client.mjs';
import { startViewer } from './viewer-server.mjs';

export function validateBrowserCall(frame, threadId, events, seen) {
  assert.equal(frame.method, 'item/tool/call'); assert.equal(frame.params?.threadId, threadId);
  assert.ok(events.some(f => f.method === 'turn/started' && f.params?.threadId === threadId && f.params?.turn?.id === frame.params.turnId));
  assert.equal(frame.params.namespace ?? null, null);
  assert.equal(frame.params.tool, 'browser_fixture_increment'); assert.deepEqual(frame.params.arguments, {});
  const id = frame.params.callId;
  assert.ok(typeof id === 'string' && id.length > 0 && id.length <= 256 && seen.size < 3 && !seen.has(id));
  seen.add(id);
}

export async function runLiveBrowser({ context, root, directory, worker, image, policy, docker }) {
  const name = 'agentmeld-m0-live-browser-' + randomUUID();
  let browser; let authority; let client; let viewer;
  let threadId; let generation; let phase; let callbacks = 0; let dispatched = 0; let eventOffset = 0; const seenCalls = new Set();
  const report = { phase: 'm0', model: 'gpt-5.5', liveInference: true, syntheticBrowser: true,
    separateBrowser: false, initialClick: false, staleCallbackDenied: false,
    humanInput: false, freshResume: false, resumedClick: false, disconnectedDenied: false };
  try {
    browser = new ContainerComputer('docker', ['--context', context, 'run', '--name', name, '-i', '--rm',
      '--network=none', '--read-only', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--security-opt=apparmor=agentmeld-m0-codex', '--security-opt=seccomp=' + policy,
      '--memory=1g', '--cpus=1', '--pids-limit=256', '--tmpfs=/tmp:rw,nosuid,nodev,size=268435456,mode=1777',
      '--tmpfs=/workspace:rw,nosuid,nodev,size=33554432,uid=1000,gid=1000,mode=700',
      image, 'node', '/opt/agentmeld/computer-worker.mjs']);
    assert.equal((await browser.request('init')).ready, true);
    const inspected = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(inspected.HostConfig.NetworkMode, 'none');
    assert.equal(inspected.HostConfig.PidMode, '');
    assert.deepEqual(inspected.Mounts, []); assert.deepEqual(inspected.HostConfig.PortBindings, {});
    report.separateBrowser = true;
    authority = await RustAuthority.open(root + 'target/debug/agentmeld-m0', directory + '/browser-journal.jsonl');
    const control = new RustBrowserControl(browser, authority);
    // Lease remains bounded but accommodates deliberately slow live-model fixture turns.
    viewer = await startViewer(control, { leaseMs: 180000 });
    const request = async (path, body) => {
      const response = await fetch(viewer.origin + path, { method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + viewer.token, Origin: viewer.origin, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200); return response.json();
    };
    assert.equal((await request('/frame')).counter, '0');
    client = new LiveClient(spawn('docker', ['--context', context, 'start', '-ai', worker], { stdio: ['pipe', 'pipe', 'pipe'] }), 150000, async frame => {
      validateBrowserCall(frame, threadId, client.events.slice(eventOffset), seenCalls);
      assert.equal(callbacks++, 0);
      if (phase === 'takeover') {
        const human = await request('/takeover', {}); assert.equal(human.mode, 'human');
        await assert.rejects(control.agentClick(generation));
        assert.equal((await request('/frame')).counter, '1');
        report.staleCallbackDenied = true;
        return { success: false, contentItems: [{ type: 'inputText', text: 'Human control acquired. This stale action was denied. Do not retry.' }] };
      }
      await control.agentClick(generation); dispatched++;
      const observation = await control.frame();
      return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ counter: observation.counter }) }] };
    });
    await client.initialize(); await client.qualifyModel('gpt-5.5');
    const thread = await client.request('thread/start', { cwd: '/workspace', model: 'gpt-5.5', allowProviderModelFallback: false,
      permissions: 'agentmeld', approvalPolicy: 'on-request', ephemeral: true,
      dynamicTools: [{ type: 'function', name: 'browser_fixture_increment', description: 'Increment the isolated browser counter once.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
    threadId = thread.thread.id;
    const turn = async mode => {
      phase = mode; callbacks = 0; generation = control.generation; eventOffset = client.events.length;
      const result = await client.turn(threadId, 'Call browser_fixture_increment exactly once with empty arguments. Use no other tool. If denied, report the denial without retrying.');
      await Promise.all([...client.callbackTasks]);
      assert.equal(client.failed, undefined); assert.equal(callbacks, 1); assert.equal(result.status, 'completed');
    };
    await turn('initial'); assert.equal(dispatched, 1); assert.equal((await request('/frame')).counter, '1'); report.initialClick = true;
    await turn('takeover'); assert.equal(dispatched, 1);
    await request('/input', { generation: control.generation, x: 320, y: 180 });
    assert.equal((await request('/frame')).counter, '2'); report.humanInput = true;
    const resumed = await request('/resume', { generation: control.generation });
    assert.equal(resumed.mode, 'agent'); assert.equal(resumed.observation.counter, '2');
    await assert.rejects(control.agentClick(generation)); report.freshResume = true;
    await turn('resumed'); assert.equal(dispatched, 2);
    const final = await request('/frame'); assert.equal(final.counter, '3'); report.resumedClick = true;
    await writeFile(directory + '/browser-final.png', Buffer.from(final.png, 'base64'), { mode: 0o600 });
    await request('/disconnect', {}); await assert.rejects(control.agentClick(control.generation));
    assert.equal((await browser.observe()).counter, '3'); report.disconnectedDenied = true;
    report.qualified = true;
    return report;
  } finally {
    let cleanupFailed = false;
    for (const resource of [client, viewer, authority, browser]) {
      try { if (resource) await resource.close(); } catch { cleanupFailed = true; }
    }
    try {
      if (docker(['ps', '-a', '--format', '{{.Names}}']).trim().split('\n').includes(name)) docker(['rm', '-f', name]);
    } catch { cleanupFailed = true; }
    if (cleanupFailed) throw Error('Live browser cleanup incomplete; inspect run-specific resources');
  }
}
