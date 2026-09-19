// Client track: wires the browser UI to the approval and event-stream APIs.
//
// Additive only — the existing UI stays the source of truth. This module
// owns four things the PoC never had:
//   1. Approval prompts: ChangedAction digest, expiry countdown, one-tap
//      approve/deny.
//   2. A live run view over SSE: run events and tool steps, resume from the
//      persisted cursor, visible disconnected/reconnecting state.
//   3. Controller-lease visibility: who holds it, observing vs controlling.
//   4. Inline tool steps in the run view.
//
// Security: the execution ticket never reaches this module. Decision
// receipts carry state only, and this code never reads `ticket` or
// `ticket_hash` fields — it doesn't know they exist.

import { SseParser, RETRY_MIN_MS, RETRY_MAX_MS } from './sse-parse.js';

const CURSOR_KEY = 'agentmeld.eventCursor';
const SEEN_CAP = 2000;
const STALL_MS = 45000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const POLL_INTERVAL_MS = 10000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadCursor() {
  try {
    const v = localStorage.getItem(CURSOR_KEY);
    const n = v === null ? NaN : parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch (e) { return null; }
}
function saveCursor(seq) {
  try { localStorage.setItem(CURSOR_KEY, String(seq)); } catch (e) {}
}

export function initClientTrack(ctx) {
  // NOTE: ctx.$ is getElementById — it takes a bare id, NOT a '#'-prefixed
  // selector. Calling $('#approvalBar') silently resolves to null and every
  // paint below becomes a no-op, with no error. Keep the '#' off.
  const { api, esc, $, notice, icon, token, getState, requestRefresh, selectConversation } = ctx;

  // ---- state ------------------------------------------------------------
  let pending = [];        // pending approval public-JSON rows, oldest-expiry first
  let history = [];        // recent terminal approvals
  let lease = null;        // lease public-JSON receipt
  let sessionDeviceId = null; // this browser's device id, from /api/v1/session
  let clockOffsetMs = 0;   // server_time_ms - Date.now(), from stream.hello
  let serverRetryMs = null; // last clamped retry: hint from the server
  let streamOn = false;
  let streamAbort = null;
  let streamStatus = 'idle'; // idle|connecting|live|reconnecting
  let lastFrameAt = 0;
  let lastPollAt = 0;
  let deciding = null;     // approval id with a decision in flight
  let leaseBusy = null;    // lease action in flight
  let armedTakeover = 0;   // timestamp: takeover two-step confirm arming
  const seenSeq = new Set();
  const steps = new Map(); // runId -> Map(callKey -> step)
  const hydratedRuns = new Set(); // runIds whose persisted steps were fetched
  const hydrating = new Map(); // runId -> in-flight hydration Promise<boolean>
  let refreshTimer = 0;
  let countdownTimer = 0;

  const serverNow = () => Date.now() + clockOffsetMs;

  // ---- tool steps -------------------------------------------------------
  function stepMap(runId, create) {
    let m = steps.get(runId);
    if (!m && create) { m = new Map(); steps.set(runId, m); }
    return m;
  }
  function stepStarted(runId, p) {
    if (!runId || !p || !p.call_key) return;
    const m = stepMap(runId, true);
    if (m.has(p.call_key)) return; // idempotent on the worker-stable key
    m.set(p.call_key, {
      key: p.call_key,
      tool: String(p.tool_name || 'tool'),
      title: String(p.title || ''),
      state: 'running',
    });
    paintSteps();
  }
  function stepFinished(runId, p) {
    if (!runId || !p || !p.call_key) return;
    const s = stepMap(runId, false)?.get(p.call_key);
    if (!s) return; // finish-before-start is a worker bug; fail closed, show nothing
    s.state = ['completed', 'failed', 'cancelled'].includes(p.state) ? p.state : 'unknown';
    paintSteps();
  }
  // ---- tool-step hydration ------------------------------------------------
  // After a reload the persisted SSE cursor skips historical tool events,
  // so the per-run step map starts empty. Backfill it once per run from
  // the persisted projection (GET /api/v1/runs/{id}/tool_steps). The merge
  // is insert-if-absent on the worker-stable call_key, so live SSE state
  // always wins for in-flight steps; the fetch only completes what the
  // resumed stream skipped. Resolves true when the map gained entries.
  // A completed fetch is never retried this page load — the SSE stream
  // stays the live source of truth.
  async function hydrateSteps(runId) {
    if (!runId || hydratedRuns.has(runId)) return false;
    let inflight = hydrating.get(runId);
    if (!inflight) {
      inflight = (async () => {
        try {
          const res = await api('/api/v1/runs/' + encodeURIComponent(runId) + '/tool_steps');
          const rows = Array.isArray(res.steps) ? res.steps : [];
          const m = stepMap(runId, true);
          let added = false;
          for (const s of rows) {
            const key = s && typeof s.call_key === 'string' ? s.call_key : '';
            if (!key || m.has(key)) continue;
            m.set(key, {
              key,
              tool: String(s.tool || 'tool'),
              title: String(s.title || ''),
              state: STEP_STATE_LABEL[s.state] ? s.state : 'unknown',
            });
            added = true;
          }
          return added;
        } catch (e) {
          return false; // keep the SSE-only projection on failure
        } finally {
          hydratedRuns.add(runId);
          hydrating.delete(runId);
        }
      })();
      hydrating.set(runId, inflight);
    }
    return inflight;
  }
  // The denied/cancelled projection steps are service-written to the
  // tool_steps table but never streamed; the approval poll carries the
  // same fact, so project it client-side from the authoritative row.
  function projectTerminalStep(a) {
    const state = a.state === 'denied' ? 'denied' : 'cancelled';
    const m = stepMap(a.run_id, true);
    const key = 'approval:' + a.id;
    const tool = String((a.action && (a.action.tool || a.action.tool_name || a.action.kind)) || 'tool');
    m.set(key, {
      key,
      tool: String(tool),
      title: String(a.description_user || ''),
      state,
    });
  }

  const STEP_STATE_LABEL = { running: 'Running', completed: 'Done', failed: 'Failed', denied: 'Denied', cancelled: 'Cancelled', unknown: 'Unknown' };
  function stepsHtml(runId) {
    const m = stepMap(runId, false);
    if (!m || !m.size) return '';
    const items = [...m.values()].map(s =>
      `<li class="toolStep toolStep--${esc(s.state)}">` +
      `<span class="toolStepDot" aria-hidden="true"></span>` +
      `<span class="toolStepTool">${esc(s.tool)}</span>` +
      (s.title ? `<span class="toolStepTitle">${esc(s.title)}</span>` : '') +
      `<span class="toolStepState">${esc(STEP_STATE_LABEL[s.state] || s.state)}</span>` +
      `</li>`
    ).join('');
    return `<ul class="toolSteps" aria-label="Tool steps">${items}</ul>`;
  }
  function paintSteps() {
    for (const el of document.querySelectorAll('[data-steps-for]')) {
      const runId = el.getAttribute('data-steps-for');
      // Backfill persisted steps once per run (no-op after the first fetch);
      // a re-paint applies whatever the fetch added.
      void hydrateSteps(runId).then(added => { if (added) paintSteps(); });
      const html = stepsHtml(runId);
      if (el.innerHTML !== html) el.innerHTML = html;
    }
  }

  // ---- approvals --------------------------------------------------------
  async function pollApprovals() {
    let rows;
    try {
      const res = await api('/api/v1/approvals');
      rows = res.approvals || [];
    } catch (e) { return; } // keep the last good render on failure
    const wasPending = new Set(pending.map(a => a.id));
    pending = rows.filter(a => a.state === 'pending')
      .sort((a, b) => (a.expires_at_ms || 0) - (b.expires_at_ms || 0));
    history = rows.filter(a => a.state !== 'pending')
      .sort((a, b) => (b.decided_at_ms || b.created_at_ms || 0) - (a.decided_at_ms || a.created_at_ms || 0))
      .slice(0, 10);
    // Newly terminal rows that never streamed a step get their projection.
    for (const a of rows) {
      if (wasPending.has(a.id) && a.state !== 'pending' && ['denied', 'expired', 'revoked'].includes(a.state)) {
        projectTerminalStep(a);
      }
    }
    paintSteps();
    paintApprovals();
  }

  function shortDigest(d) {
    if (!d || typeof d !== 'string' || d.length < 16) return '—';
    return d.slice(0, 8) + '…' + d.slice(-4);
  }
  function actionSummary(a) {
    const action = a.action || {};
    const tool = action.tool || action.tool_name || action.kind || 'action';
    let args = '';
    try {
      const parts = [];
      if (action.target) parts.push('target: ' + action.target);
      const rest = action.arguments && typeof action.arguments === 'object'
        ? JSON.stringify(action.arguments) : '';
      if (rest && rest !== '{}') parts.push(rest);
      const s = parts.join(' ');
      if (s) args = s.length > 140 ? s.slice(0, 140) + '…' : s;
    } catch (e) {}
    return { tool, args };
  }
  function countdownText(a) {
    const ms = (a.expires_at_ms || 0) - serverNow();
    if (ms <= 0) return 'Expired';
    const s = Math.floor(ms / 1000);
    if (s < 60) return 'Expires in ' + s + 's';
    const m = Math.floor(s / 60);
    return 'Expires in ' + m + 'm ' + String(s % 60).padStart(2, '0') + 's';
  }
  function conversationTitle(id) {
    return getState().conversations.find(c => c.id === id)?.title || 'Conversation';
  }

  function approvalCard(a, { compact } = {}) {
    const { tool, args } = actionSummary(a);
    const expired = (a.expires_at_ms || 0) <= serverNow();
    const busy = deciding === a.id;
    const state = getState();
    const onThisConversation = state.selectedConversationId &&
      state.tasks.some(t => t.id === a.run_id && t.conversationId === state.selectedConversationId);
    return `<div class="approvalCard" data-approval="${esc(a.id)}">` +
      `<div class="approvalCardHead">${icon('shield')}<strong>${expired ? 'Approval expired' : 'Approval needed'}</strong>` +
      `<span class="approvalCardConv">${esc(conversationTitle(state.tasks.find(t => t.id === a.run_id)?.conversationId))}</span></div>` +
      `<p class="approvalCardDesc">${esc(a.description_user || 'The agent is requesting permission to act.')}</p>` +
      `<div class="approvalCardMeta"><code>${esc(tool)}</code>` +
      (args ? `<span class="approvalCardArgs">${esc(args)}</span>` : '') + `</div>` +
      `<div class="approvalCardMeta"><span>Digest <code title="${esc(a.action_digest || '')}">${esc(shortDigest(a.action_digest))}</code></span>` +
      `<span class="approvalCountdown" data-expires="${a.expires_at_ms || 0}">${esc(countdownText(a))}</span></div>` +
      (expired
        ? `<p class="approvalCardNote">This request passed its deadline. The agent was told no.</p>`
        : `<div class="approvalCardActions">` +
          `<button class="approvalBtn approvalBtn--approve" data-decide="approve" data-id="${esc(a.id)}" ${busy ? 'disabled' : ''}>${busy ? 'Sending…' : 'Approve'}</button>` +
          `<button class="approvalBtn approvalBtn--deny" data-decide="deny" data-id="${esc(a.id)}" ${busy ? 'disabled' : ''}>${busy ? 'Sending…' : 'Deny'}</button>` +
          (onThisConversation || compact ? '' : `<button class="approvalBtn approvalBtn--ghost" data-view-run="${esc(a.id)}">View run</button>`) +
          `</div>`) +
      `</div>`;
  }

  function pendingSig() {
    const now = serverNow();
    return pending.map(a => a.id + ':' + ((a.expires_at_ms || 0) <= now ? 'x' : 'p')).join(',') +
      '|' + (deciding || '') + '|' + (getState().selectedConversationId || '');
  }
  function fullSig() {
    return pendingSig() + '|' + history.map(a => a.id + ':' + a.state).join(',');
  }

  function paintApprovals() {
    // The prompt bar: the most urgent pending approval, anywhere. Re-renders
    // only when the set (or an expiry flip, or a decision in flight) changes;
    // the per-second countdown tick mutates the time text in place.
    const bar = $('approvalBar');
    if (bar) {
      const sig = pendingSig();
      if (bar.dataset.sig !== sig) {
        bar.dataset.sig = sig;
        if (pending.length) {
          bar.hidden = false;
          bar.innerHTML = approvalCard(pending[0]);
        } else {
          bar.hidden = true;
          bar.innerHTML = '';
        }
      } else if (!pending.length && !bar.hidden) {
        bar.hidden = true;
        bar.innerHTML = '';
      }
    }
    // The approvals panel: every pending request plus recent history.
    const panel = $('approvalsBody');
    if (panel) {
      const sig = fullSig();
      if (panel.dataset.sig !== sig) {
        panel.dataset.sig = sig;
        let html = '';
        if (!pending.length && !history.length) {
          html = `<p class="muted">No approval requests right now.</p>` +
            `<p class="muted">When the agent needs permission to act, the request appears here with its digest and deadline.</p>`;
        } else {
          if (pending.length) {
            html += `<h4 class="approvalsHead">Pending (${pending.length})</h4>` +
              pending.map(a => approvalCard(a, { compact: true })).join('');
          }
          if (history.length) {
            const label = { approved: 'Approved', denied: 'Denied', expired: 'Expired', revoked: 'Revoked' };
            html += `<h4 class="approvalsHead">Recent</h4><ul class="approvalHistory">` +
              history.map(a =>
                `<li class="approvalHistoryItem approvalHistoryItem--${esc(a.state)}">` +
                `<span class="approvalHistoryState">${esc(label[a.state] || a.state)}</span>` +
                `<span class="approvalHistoryDesc">${esc(a.description_user || actionSummary(a).tool)}</span>` +
                (a.revoked_reason ? `<span class="approvalHistoryMeta">reason: ${esc(a.revoked_reason)}</span>` : '') +
                `</li>`
              ).join('') + `</ul>`;
          }
        }
        panel.innerHTML = html;
      }
    }
  }

  function tickCountdowns() {
    for (const el of document.querySelectorAll('[data-expires]')) {
      const at = parseInt(el.getAttribute('data-expires'), 10) || 0;
      const ms = at - serverNow();
      const text = ms <= 0 ? 'Expired' : countdownText({ expires_at_ms: at });
      if (el.textContent !== text) el.textContent = text;
    }
    // An approval that just passed its deadline flips to the expired card.
    const bar = $('approvalBar');
    if (bar && !bar.hidden && bar.dataset.sig !== pendingSig()) paintApprovals();
  }

  async function decide(id, decision) {
    if (deciding) return;
    deciding = id;
    paintApprovals();
    try {
      if (!lease) await pollLease();
      const res = await fetch('/api/v1/approvals/' + encodeURIComponent(id) + '/decision', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, lease_generation: lease ? lease.generation : 0 }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        notice(decision === 'approve' ? 'Approved.' : 'Denied.');
      } else if (body.error === 'stale_lease' || body.error === 'stale_grant') {
        await pollLease();
        notice('Control changed since you reviewed this — the lease moved. Review it again before deciding.');
      } else if (body.error === 'already_settled' || body.error === 'expired') {
        notice(body.message || 'That approval already settled.');
      } else if (body.error === 'digest_mismatch') {
        notice('The action changed after it was proposed. It was revoked, not approved.');
      } else if (body.error === 'run_not_waiting') {
        notice('The run is no longer waiting on this approval.');
      } else {
        notice(body.message || 'The decision could not be recorded.');
      }
    } catch (e) {
      notice('The decision could not be recorded. Check the connection and try again.');
    }
    deciding = null;
    await pollApprovals();
    requestRefresh();
  }

  // ---- lease ------------------------------------------------------------
  async function pollLease() {
    try {
      lease = await api('/api/v1/lease');
    } catch (e) { return; } // keep the last good render on failure
    paintLease();
  }

  async function pollSession() {
    try {
      const s = await api('/api/v1/session');
      sessionDeviceId = s && s.device_id ? String(s.device_id) : null;
    } catch (e) { /* keep null: pill falls back to the neutral label */ }
    paintLease();
  }

  // ---- lease mutations --------------------------------------------------
  // Fenced by expected_generation: the server rejects a stale generation
  // with 409 stale_lease, and the client re-reads instead of retrying.
  // Takeover is destructive (cancels the live turn, revokes pending
  // approvals), so it arms in two steps — a confirm without a modal.
  async function leaseMutate(action) {
    if (leaseBusy || !lease) return;
    if (action === 'takeover' && Date.now() - armedTakeover > 6000) {
      armedTakeover = Date.now();
      paintLease();
      return;
    }
    armedTakeover = 0;
    leaseBusy = action;
    paintLease();
    try {
      const body = action === 'takeover' ? {} : { expected_generation: lease.generation };
      const res = await api('/api/v1/lease/' + action, { method: 'POST', body: JSON.stringify(body) });
      await res.json().catch(() => ({}));
    } catch (e) {
      if (e && e.message === 'stale_lease') {
        notice('Control changed since you acted — the lease moved. Review it and try again.');
      } else if (e && e.message === 'not_holder') {
        notice('Another device holds the lease now.');
      } else {
        notice('The lease action could not be completed. Check the connection and try again.');
      }
    }
    leaseBusy = null;
    await pollLease();
    requestRefresh();
  }

  // While this device holds the lease as a human, heartbeat often enough
  // that a closed tab can't squat the computer (server TTL is 5 minutes).
  async function maybeHeartbeat() {
    if (!lease || lease.state !== 'human') return;
    const holder = lease.holder_device_id ? String(lease.holder_device_id) : null;
    if (!holder || !sessionDeviceId || holder !== sessionDeviceId) return;
    if (serverNow() - (lease.heartbeat_at_ms || 0) < 60000) return;
    try {
      const res = await api('/api/v1/lease/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ expected_generation: lease.generation }),
      });
      const body = await res.json().catch(() => ({}));
      if (body && body.lease) { lease = body.lease; paintLease(); }
    } catch (e) { /* the next poll cycle retries; a dead hold auto-releases */ }
  }

  const LEASE_LABEL = {
    agent: 'Observing',
    observed: 'Observing',
    human: 'Human control',
    pausing: 'Handing over…',
    resuming: 'Resuming…',
    paused: 'Paused',
  };
  function paintLease() {
    const pill = $('leasePill');
    const controls = $('leaseControls');
    if (!pill) return;
    if (!lease) { pill.hidden = true; if (controls) controls.innerHTML = ''; return; }
    const human = lease.state === 'human';
    // Honest ownership: only claim "this device" when the session's device
    // id matches the holder. Otherwise the holder is another device (or
    // unknown when the session hasn't loaded yet).
    const holder = lease.holder_device_id ? String(lease.holder_device_id) : null;
    const mine = holder && sessionDeviceId && holder === sessionDeviceId;
    const label = human
      ? (mine ? 'Controlling on this device' : holder ? 'Controlled by another device' : 'Human control')
      : (LEASE_LABEL[lease.state] || lease.state);
    pill.hidden = false;
    pill.className = 'leasePill' + (human ? ' leasePill--human' : '');
    const held = lease.held_since_ms ? new Date(lease.held_since_ms).toLocaleString() : 'unknown time';
    pill.title = `Controller lease: ${lease.state} · generation ${lease.generation}\n` +
      `Holder: ${holder || 'unknown device'}${mine ? ' (this device)' : ''}${lease.private_bracket ? ' (private session)' : ''}\nHeld since ${held}`;
    const html = `<span class="leaseDot" aria-hidden="true"></span>${esc(label)}`;
    if (pill.innerHTML !== html) pill.innerHTML = html;
    paintLeaseControls(controls, { human, mine });
  }

  // Contextual lease actions. Only the states this device can legally drive
  // get buttons; everything else stays a readout. The server fences every
  // mutation on expected_generation, so a stale UI re-reads instead of
  // acting on old state.
  function paintLeaseControls(controls, { human, mine }) {
    if (!controls) return;
    const busy = leaseBusy;
    const btn = (action, text, cls) =>
      `<button class="leaseBtn${cls ? ' ' + cls : ''}" data-lease="${action}"${busy ? ' disabled' : ''}>${busy === action ? 'Working…' : esc(text)}</button>`;
    let html = '';
    if (busy) {
      html = btn(leaseBusy, 'Working…');
    } else if (lease.state === 'agent' || lease.state === 'observed') {
      const armed = Date.now() - armedTakeover < 6000;
      html = armed
        ? btn('takeover', 'Confirm take control', 'leaseBtn--primary')
        : btn('takeover', 'Take control');
    } else if (lease.state === 'pausing' && mine) {
      html = btn('takeover/ack', 'Confirm handover', 'leaseBtn--primary');
    } else if (human && mine) {
      html = btn('resume', 'Release control') +
        (lease.private_bracket
          ? btn('private/end', 'End private session', 'leaseBtn--active')
          : btn('private/begin', 'Private session'));
    }
    if (controls.innerHTML !== html) controls.innerHTML = html;
  }

  // ---- event stream -----------------------------------------------------
  function paintStream() {
    const el = $('streamStatus');
    if (!el) return;
    const label = {
      idle: 'Updates paused',
      connecting: 'Connecting…',
      live: 'Live',
      reconnecting: 'Reconnecting…',
    }[streamStatus] || streamStatus;
    const html = `<span class="streamDot streamDot--${esc(streamStatus)}" aria-hidden="true"></span>${esc(label)}`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function dispatchFrame(frame) {
    const data = frame.data.join('\n');
    if (frame.event === 'stream.hello') {
      // First frame per connection: server time anchors the expiry countdown.
      let msg = null;
      try { msg = JSON.parse(data); } catch (e) { return; }
      if (msg && typeof msg.server_time_ms === 'number') {
        clockOffsetMs = msg.server_time_ms - Date.now();
      }
      return;
    }
    if (frame.event === 'control') {
      let msg = null;
      try { msg = JSON.parse(data); } catch (e) { return; }
      if (msg && msg.type === 'stream.resync_required') {
        void onResync(msg.current_seq);
      }
      return;
    }
    if (!frame.data.length) return;
    let env = null;
    try { env = JSON.parse(frame.data.join('\n')); } catch (e) { return; }
    if (!env || typeof env.seq !== 'number') return;
    if (seenSeq.has(env.seq)) return; // at-least-once: dedupe on the journal seq
    seenSeq.add(env.seq);
    if (seenSeq.size > SEEN_CAP) seenSeq.delete(seenSeq.values().next().value);
    saveCursor(env.seq);
    handleEvent(env);
  }

  function handleEvent(env) {
    const t = env.type || '', p = env.payload || {};
    if (t === 'tool.call_started') stepStarted(env.run_id, p);
    else if (t === 'tool.call_finished') stepFinished(env.run_id, p);
    else if (t.indexOf('approval.') === 0) void pollApprovals();
    else if (t.indexOf('lease.') === 0) void pollLease();
    else if (t.indexOf('run.') === 0) queueRefresh();
  }

  async function pumpFrames(reader) {
    const decoder = new TextDecoder();
    const parser = new SseParser();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error('stream closed');
      const { frames } = parser.push(decoder.decode(value, { stream: true }));
      if (parser.linesSeen > 0) lastFrameAt = Date.now(); // any line — incl. :ping — is liveness
      if (parser.retryMs !== null) serverRetryMs = parser.retryMs;
      for (const frame of frames) dispatchFrame(frame);
    }
  }

  async function onResync(currentSeq) {
    // The server says our cursor is too old to replay. Refetch
    // authoritative state and resume from the server's current position.
    if (typeof currentSeq === 'number' && currentSeq >= 0) saveCursor(currentSeq);
    requestRefresh();
    await pollApprovals();
    await pollLease();
  }

  async function streamLoop() {
    let attempt = 0;
    const stall = setInterval(() => {
      if (streamOn && streamStatus === 'live' && Date.now() - lastFrameAt > STALL_MS && streamAbort) {
        streamAbort.abort(); // the read throws; the loop reconnects
      }
    }, 5000);
    try {
      while (streamOn) {
        streamStatus = attempt ? 'reconnecting' : 'connecting';
        paintStream();
        streamAbort = new AbortController();
        lastFrameAt = Date.now();
        const headers = { Authorization: 'Bearer ' + token() };
        const cursor = loadCursor();
        if (cursor !== null) headers['Last-Event-ID'] = String(cursor);
        try {
          const res = await fetch('/api/v1/events', { headers, signal: streamAbort.signal });
          if (res.status === 410) {
            let body = null;
            try { body = await res.json(); } catch (e) {}
            await onResync(body && body.current_seq);
            attempt = 0;
            continue;
          }
          if (!res.ok || !res.body) throw new Error('events HTTP ' + res.status);
          streamStatus = 'live';
          attempt = 0;
          paintStream();
          await pumpFrames(res.body.getReader());
          throw new Error('stream closed');
        } catch (e) {
          if (!streamOn) break;
          if (e && e.name === 'AbortError' && !streamOn) break;
        }
        attempt += 1;
        // The server's retry: hint wins when present (already clamped to
        // RETRY_MIN_MS..RETRY_MAX_MS by the parser); otherwise exponential
        // backoff with the same ceiling.
        const delay = serverRetryMs !== null
          ? serverRetryMs
          : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt, 5));
        await sleep(delay);
      }
    } finally {
      clearInterval(stall);
    }
    streamStatus = 'idle';
    paintStream();
  }

  function queueRefresh() {
    // SSE run events arrive ahead of the 1s poll; pull state forward, but
    // don't let a busy stream stampede the server.
    const now = Date.now();
    if (now - refreshTimer < 750) return;
    refreshTimer = now;
    requestRefresh();
  }

  // ---- public API -------------------------------------------------------
  async function poll(force) {
    const now = Date.now();
    if (!force && now - lastPollAt < POLL_INTERVAL_MS) return;
    lastPollAt = now;
    await Promise.all([pollApprovals(), pollLease()]);
    void maybeHeartbeat();
  }

  function start() {
    if (!countdownTimer) countdownTimer = setInterval(tickCountdowns, 1000);
    if (!streamOn) {
      streamOn = true;
      void streamLoop();
    }
    void pollSession(); // this device's identity, once per session
    void poll(true); // populate approvals + lease immediately
  }
  function stop() {
    streamOn = false;
    if (streamAbort) { try { streamAbort.abort(); } catch (e) {} streamAbort = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = 0; }
    streamStatus = 'idle';
    paintStream();
  }

  function paintAll() {
    paintLease();
    paintStream();
    paintApprovals();
    paintSteps();
  }

  // Delegated clicks: approve/deny/view-run buttons and lease controls
  // rendered by this module.
  document.addEventListener('click', e => {
    const decideBtn = e.target.closest('[data-decide]');
    if (decideBtn) {
      e.preventDefault();
      void decide(decideBtn.getAttribute('data-id'), decideBtn.getAttribute('data-decide'));
      return;
    }
    const leaseBtn = e.target.closest('[data-lease]');
    if (leaseBtn) {
      e.preventDefault();
      void leaseMutate(leaseBtn.getAttribute('data-lease'));
      return;
    }
    const viewBtn = e.target.closest('[data-view-run]');
    if (viewBtn) {
      const a = pending.find(x => x.id === viewBtn.getAttribute('data-view-run'));
      const task = a && getState().tasks.find(t => t.id === a.run_id);
      if (task) selectConversation(task.conversationId);
    }
  });

  return { start, stop, poll, paintAll, stepsHtml, hydrateSteps };
}
