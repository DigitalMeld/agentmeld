// Worker-side turn execution (Phase 1). This is the PoC runtime extracted
// from apps/poc/runtime.mjs and reworked to speak worker-seam/1: instead of
// mutating the service's in-memory task/conversation objects, the worker
// reports progress through worker.events.append, fetches inputs through
// worker.inputs.fetch, and delivers artifacts through worker.artifacts.deliver.
//
// Everything the worker needs arrives in service.turn.start, with two
// documented Phase 1 gap-fills (worker-seam/1 has no fields for them):
//   - the resume thread id travels in AGENTMELD_RESUME_THREAD_ID;
//   - the complete workspace snapshot travels as workspace-listing.json in
//     the staging dir (the seam's artifact manifest carries only changed
//     top-level output files).
// The service assembles the full model prompt into turn.agent_context
// (a string, per the seam schema).
// (instructions + profile context + attachment names + request), because the
// seam has no separate user-prompt field; the worker sends it verbatim.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { LiveClient } from './codex-live-client.mjs';
import { snapshotProgram, restoreProgram } from './workspace.mjs';
import { docker, context, safeName, readBinding } from './binding.mjs';
import { storeMount } from '../../experiments/codex-auth-store.mjs';

const turnConfigDigest = turn => createHash('sha256').update(JSON.stringify(turn)).digest('hex');

export async function executeTurn(start, seam) {
  const runId = start.run_id;
  const turn = start.turn;
  const resumeThreadId = process.env.AGENTMELD_RESUME_THREAD_ID || null;

  // --- event emission ---------------------------------------------------
  // Milestone events are awaited (the worker does not proceed until the
  // service has persisted them); streaming deltas are fire-and-forget and
  // ride the seam's 1/sec batching, matching the PoC's notify() throttle.
  const emit = (event_type, payload, { dedupe = false, dedupe_key = null, awaitAck = false } = {}) => {
    const event = { event_id: randomUUID(), event_type, payload };
    if (dedupe_key) event.dedupe_key = dedupe_key;
    else if (dedupe) event.dedupe_key = runId + ':' + event_type;
    const p = seam.appendEvent(event);
    return awaitAck ? p : p.catch(() => {});
  };

  // --- cancellation / fatal state ---------------------------------------
  let cancelled = false;
  let fatal = null;
  seam.onServiceError = msg => {
    fatal = Object.assign(Error(msg.rejection?.message || 'service error'), { code: msg.rejection?.code });
  };
  const checkpoint = () => {
    if (fatal) throw fatal;
    if (cancelled) throw Error('Task stopped.');
  };

  // --- streaming ----------------------------------------------------------
  // answer accumulates the full streamed text for the final-answer fallback,
  // exactly as the PoC's task.answer did; the service rebuilds its own copy
  // from the run.answer_delta events (documented multi-message drift).
  let answer = '';
  let deltaBuf = '';
  let batchSeq = 0;
  let lastActivity = null;
  const queueDelta = chunk => {
    answer += chunk;
    deltaBuf += chunk;
    while (deltaBuf.length >= 4096) {
      const text = deltaBuf.slice(0, 4096);
      deltaBuf = deltaBuf.slice(4096);
      emit('run.answer_delta', { text, batch_seq: batchSeq++ });
    }
  };
  const flushDelta = () => {
    if (!deltaBuf) return;
    const text = deltaBuf;
    deltaBuf = '';
    emit('run.answer_delta', { text, batch_seq: batchSeq++ });
  };
  const queueActivity = activity => {
    if (activity === lastActivity) return;
    lastActivity = activity;
    emit('run.activity_changed', { activity });
  };
  class POCClient extends LiveClient {
    frame(frame) {
      super.frame(frame);
      if (frame.method === 'item/agentMessage/delta') {
        if (this.messageId && this.messageId !== frame.params.itemId) queueDelta('\n\n');
        this.messageId = frame.params.itemId;
        queueDelta(frame.params.delta ?? '');
      }
      if (frame.method === 'item/started' && frame.params.item?.type === 'commandExecution') queueActivity('Working on your files');
    }
  }

  // --- turn state -----------------------------------------------------------
  const id = randomUUID(), network = 'agentmeld-poc-net-' + id;
  const proxy = 'agentmeld-poc-proxy-' + id, worker = 'agentmeld-poc-worker-' + id;
  let networkCreated = false, proxyCreated = false, workerCreated = false, client;
  let phase = 'setup';
  const stopWorker = async () => {
    if (!workerCreated) return;
    await docker(['stop','--time=5',worker]);
    const { State: { Running } } = JSON.parse(await docker(['inspect',worker]))[0];
    if (Running) throw Error('Could not confirm the task stopped.');
  };
  // Best-effort container cleanup if the worker process itself dies mid-turn.
  seam.abortHook = async () => {
    if (workerCreated) await docker(['rm','-f',worker]).catch(() => {});
    if (proxyCreated) await docker(['rm','-f',proxy]).catch(() => {});
    if (networkCreated) await docker(['network','rm',network]).catch(() => {});
  };
  seam.onTurnCancel = msg => {
    if (msg.generation !== start.generation) return; // Stale turn; ignore.
    cancelled = true;
    stopWorker().catch(() => {});
  };
  // The seam's hard wall-clock budget; expiry is treated as cancellation.
  const turnTimer = setTimeout(() => { cancelled = true; stopWorker().catch(() => {}); }, turn.turn_timeout_ms);
  turnTimer.unref?.();
  const limits = ['--read-only','--user=1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges',
    '--memory=256m','--cpus=1','--pids-limit=64','--tmpfs=/tmp:rw,nosuid,nodev,size=33554432,mode=1777'];

  try {
    phase = 'setup';
    const { binding: actual, image, storeName, storeInstance, policyPath } = await readBinding();
    for (const [key, value] of Object.entries(turn.expected_binding)) assert.equal(actual[key], value, 'Execution binding changed');
    checkpoint();
    await emit('run.started', { turn_config_digest: turnConfigDigest(turn) }, { dedupe: true, awaitAck: true });
    await docker(['network','create','--internal','--opt=com.docker.network.bridge.gateway_mode_ipv4=isolated',network]); networkCreated = true;
    await docker(['create','--name',proxy,...limits,'--network=bridge',image,'node','/opt/agentmeld/provider-egress-server.mjs']); proxyCreated = true;
    await docker(['network','connect',network,proxy]); await docker(['start',proxy]);
    let ready = false;
    for (let n = 0; n < 30; n++) { checkpoint(); if ((await docker(['logs',proxy])).includes('provider-egress-ready')) {ready=true;break;} await delay(100); }
    if (!ready) throw Error('The model connection could not start.');
    const ip = JSON.parse(await docker(['inspect',proxy]))[0].NetworkSettings.Networks[network].IPAddress;
    checkpoint();
    await docker(['create','-i','--name',worker,...limits,'--memory=1g','--pids-limit=256',
      '--tmpfs=/workspace:rw,nosuid,nodev,size=67108864,uid=1000,gid=1000,mode=700',
      '--mount='+storeMount(storeName),'--env=AGENTMELD_STORE_INSTANCE='+storeInstance,
      '--security-opt=seccomp='+policyPath,'--security-opt=apparmor=agentmeld-m0-codex',
      '--network='+network,image,'node','/opt/agentmeld/codex.mjs']); workerCreated = true;
    await docker(['start',worker]);
    client = new POCClient(worker, {timeout: 600000});

    phase = 'restore';
    // The inputs_manifest carries files only; parent directories are derived
    // from paths (the seam cannot represent empty directories — Phase 1
    // drift, documented in the handoff report).
    const uploadEntries = [];
    const seenDirs = new Set();
    let restoreBytes = 0;
    for (const item of turn.inputs_manifest) {
      const bytes = await seam.fetchInputs(item.digest, item.size);
      restoreBytes += bytes.length;
      const parts = item.name.split('/');
      let prefix = '';
      for (let i = 0; i < parts.length - 1; i++) {
        prefix = prefix ? prefix + '/' + parts[i] : parts[i];
        if (!seenDirs.has(prefix)) { seenDirs.add(prefix); uploadEntries.push({name: prefix, directory: true}); }
      }
      uploadEntries.push({name: item.name, data: bytes.toString('base64')});
    }
    await new Promise((resolve, reject) => {
      const child = spawn('docker', ['--context',context,'exec','-i',worker,'node','-e',restoreProgram]);
      child.on('error', reject);
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(uploadEntries));
      child.on('close', code => code === 0 ? resolve() : reject(Error('Workspace restore failed: ' + code)));
    });
    checkpoint();
    await emit('run.restored', {file_count: turn.inputs_manifest.length, bytes: restoreBytes}, {dedupe: true, awaitAck: true});

    phase = 'continuation';
    const params = {cwd:'/workspace',model:'gpt-5.5',allowProviderModelFallback:false,permissions:'agentmeld',approvalPolicy:'on-request'};
    const thread = resumeThreadId
      ? await client.request('thread/resume', {...params, threadId: resumeThreadId})
      : await client.request('thread/start', params);
    checkpoint();
    // The service verifies the resumed thread id against its stored session
    // when it applies this event; the binding equality check already happened
    // above against the turn's expected_binding.
    await emit('provider_session.bound', {binding: {...actual, thread_id: thread.thread.id}}, {dedupe: true, awaitAck: true});
    emit('run.thinking', {}, {dedupe: true});
    queueActivity('Thinking');

    phase = 'execution';
    const result = await client.turn(thread.thread.id, turn.agent_context);
    checkpoint();
    flushDelta();
    if (result.status !== 'completed') throw Error('The model did not finish the task.');
    const finalAnswer = result.items.filter(i => i.type === 'agentMessage' && i.text).at(-1)?.text || result.answer || answer;
    emit('run.saving', {}, {dedupe: true});
    queueActivity('Saving results');

    phase = 'snapshot';
    const listing = JSON.parse(await docker(['exec',worker,'node','-e',snapshotProgram]));
    // Write the complete snapshot as a sidecar for the service: the seam's
    // artifact manifest carries only changed top-level output files, but the
    // service must replace its whole workspace copy (unchanged files, nested
    // entries, directories) exactly as the PoC did.
    await writeFile(turn.staging_dir + '/workspace-listing.json', JSON.stringify(listing));
    const previousDigests = new Map(turn.inputs_manifest.map(m => [m.name, m.digest]));
    const inputNames = new Set(turn.inputs_manifest.filter(m => m.kind === 'attachment').map(m => m.name));
    let outputBytes = 0;
    const changed = [];
    for (const f of listing) {
      assert.ok(safeName(f.name) && !f.name.includes('/'), 'Unsupported workspace name');
      if (f.directory || inputNames.has(f.name)) continue;
      const bytes = Buffer.from(f.data, 'base64');
      if (previousDigests.get(f.name) === createHash('sha256').update(bytes).digest('hex')) continue;
      outputBytes += bytes.length;
      if (outputBytes > 8 * 1024 * 1024) throw Error('Output limit exceeded');
      changed.push({name: f.name, bytes});
    }
    let manifestDigest = null;
    for (let i = 0; i < changed.length; i += 64) {
      const files = [];
      for (const f of changed.slice(i, i + 64)) {
        const digest = createHash('sha256').update(f.bytes).digest('hex');
        const staging_ref = randomUUID().replace(/-/g, '');
        await writeFile(turn.staging_dir + '/' + staging_ref, f.bytes);
        files.push({name: f.name, digest, size: f.bytes.length, staging_ref});
      }
      const total_bytes = files.reduce((n, f) => n + f.size, 0);
      manifestDigest = createHash('sha256')
        .update(JSON.stringify(files.map(f => [f.name, f.digest, f.size]).sort((a, b) => (a[0] < b[0] ? -1 : 1))))
        .digest('hex');
      await seam.deliverArtifacts({manifest_digest: manifestDigest, files, total_bytes});
      await emit('run.artifacts_delivered',
        {manifest_digest: manifestDigest, file_count: files.length, bytes: total_bytes},
        {dedupe_key: runId + ':run.artifacts_delivered:' + manifestDigest, awaitAck: true});
    }
    await emit('run.completed',
      {answer_digest: createHash('sha256').update(finalAnswer, 'utf8').digest('hex'),
       ...(manifestDigest ? {artifact_manifest_digest: manifestDigest} : {})},
      {dedupe: true, awaitAck: true});
  } catch (error) {
    flushDelta();
    if (cancelled && !fatal) {
      await emit('run.cancelled', {stage: phase}, {dedupe: true, awaitAck: true}).catch(() => {});
    } else {
      // Snapshot-phase failures keep the PoC's user-safe mapping; raw
      // provider/process errors and credentials never reach the UI.
      const snapshotIssue = phase === 'snapshot'
        ? ['Unsupported workspace name','Workspace size limit exceeded','Workspace entry limit exceeded',
           'Workspace directory depth exceeded','Workspace changed during capture','Unsupported workspace entry']
          .find(code => error.stderr?.includes('Error: ' + code)) || 'Snapshot unavailable'
        : null;
      const error_user = snapshotIssue
        ? 'Working files could not be safely retained (' + snapshotIssue + '). Earlier saved files remain available. Start a new chat.'
        : 'The task could not finish. Check that the local VM is running and your Codex subscription is connected, start a new chat to continue. Earlier saved files remain available.';
      await emit('run.failed', {stage: phase, error_user}, {dedupe: true, awaitAck: true}).catch(() => {});
    }
  } finally {
    clearTimeout(turnTimer);
    if (client) await client.close().catch(() => {});
    const failures = [];
    // Only clean up resources that were actually created; setup failures
    // must not become false cleanup failures.
    const targets = [
      [workerCreated, 'worker container', ['rm', '-f', worker]],
      [proxyCreated, 'proxy container', ['rm', '-f', proxy]],
      [networkCreated, 'network', ['network', 'rm', network]],
    ];
    for (const [created, label, args] of targets) {
      if (!created) continue;
      try { await docker(args); } catch { failures.push(label); }
    }
    const evidence = failures.join(', ');
    await emit('run.terminated',
      {cleanup_ok: failures.length === 0, ...(evidence ? {evidence} : {})},
      {awaitAck: true}).catch(() => {});
    seam.abortHook = null;
    seam.onTurnCancel = null;
    seam.onServiceError = null;
  }
}
