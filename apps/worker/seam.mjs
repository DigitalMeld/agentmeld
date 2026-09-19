// Worker-side worker-seam/1 client: handshake, batched event appends with
// ack/retry, chunked input fetch, and artifact delivery.
//
// Event reliability: appends are batched (up to 64 events or 1 second,
// matching the PoC's 1/sec persistence throttle) and each batch is acked by
// the service. Transient failures (lost ack, timeout) requeue the batch with
// backoff; only an explicit service.error reply or transport death is fatal.
// This is the Phase 1 behavior change the seam spec calls for: persistence
// errors no longer cancel the turn, they retry.
import { randomUUID, createHash } from 'node:crypto';
import { sendFrame, createFrameReader, newMsgId } from './framing.mjs';

const BATCH_INTERVAL_MS = 1000;
const MAX_BATCH = 64;
const ACK_TIMEOUT_MS = 30000;
const MAX_CHUNK = 256 * 1024;
const MAX_TRANSIENT_FAILURES = 15;

const serviceError = (code, message) => Object.assign(Error(message), { code });

export class WorkerSeam {
  constructor(socket, { onServiceMessage, onServiceError, onFatal }) {
    this.socket = socket;
    this.onServiceMessage = onServiceMessage;
    this.onServiceError = onServiceError;
    this.onFatal = onFatal;
    this.pending = new Map();
    this.queue = [];
    this.flushTimer = null;
    this.flushing = false;
    this.fatal = null;
    this.transientFailures = 0;
    this.runId = null;
    this.generation = null;
    this.batchSeq = 0;
    // Hooks assigned by the turn driver (worker.mjs / runtime.mjs).
    this.onTurnCancel = null;
    this.abortHook = null;
    createFrameReader(socket, {
      onFrame: msg => this.handleMessage(msg),
      onError: err => this.fail(err),
    });
    socket.on('close', () => this.fail(Error('socket closed')));
  }

  fail(err) {
    if (this.fatal) return;
    this.fatal = err;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
    for (const item of this.queue) item.reject(err);
    this.queue.length = 0;
    this.onFatal?.(err);
  }

  handleMessage(msg) {
    if (msg?.protocol !== 'worker-seam/1') { this.fail(Error('protocol mismatch')); return; }
    const pending = msg.in_reply_to ? this.pending.get(msg.in_reply_to) : null;
    if (pending) {
      this.pending.delete(msg.in_reply_to);
      clearTimeout(pending.timer);
      if (msg.msg_type === 'service.error') pending.reject(serviceError(msg.code || 'internal', msg.message || 'service error'));
      else pending.resolve(msg);
      return;
    }
    if (msg.in_reply_to) return; // Late or duplicate ack; nothing is waiting on it.
    if (msg.msg_type === 'service.error') { this.onServiceError?.(msg); return; }
    this.onServiceMessage?.(msg);
  }

  // Sends a worker-initiated request and resolves with the service's reply.
  // A missing ack rejects transiently (the caller retries); only an explicit
  // service.error rejects as fatal-to-the-operation.
  sendRequest(obj, { timeoutMs = ACK_TIMEOUT_MS } = {}) {
    if (this.fatal) return Promise.reject(this.fatal);
    const msg_id = newMsgId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg_id);
        reject(Error('ack timeout'));
      }, timeoutMs);
      this.pending.set(msg_id, { resolve, reject, timer });
      try { sendFrame(this.socket, { ...obj, msg_id }); }
      catch (err) { this.pending.delete(msg_id); clearTimeout(timer); reject(err); }
    });
  }

  async hello(token) {
    const reply = await this.sendRequest({
      protocol: 'worker-seam/1',
      msg_type: 'worker.session.hello',
      worker_token: token,
      worker_pid: process.pid,
      worker_version: '1',
    }, { timeoutMs: 10000 });
    if (reply.msg_type !== 'service.session.welcome' || !reply.ok) throw Error('handshake rejected');
    return reply;
  }

  setTurn(run_id, generation) {
    this.runId = run_id;
    this.generation = generation;
  }

  // Queues one event for the next append batch. The returned promise resolves
  // when the service acks the batch containing the event. Callers that only
  // need progress display may ignore the promise; callers that need the event
  // persisted before proceeding must await it.
  appendEvent(event) {
    if (this.fatal) return Promise.reject(this.fatal);
    if (!this.runId) return Promise.reject(Error('no active turn'));
    return new Promise((resolve, reject) => {
      this.queue.push({ event, resolve, reject });
      if (this.queue.length >= MAX_BATCH) this.flush();
      else if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, BATCH_INTERVAL_MS);
    });
  }

  async flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.flushing || this.fatal) return;
    if (this.queue.length === 0) return;
    this.flushing = true;
    try {
      const batch = this.queue.splice(0, MAX_BATCH);
      const events = batch.map(b => ({
        event_id: b.event.event_id,
        event_type: b.event.event_type,
        payload: b.event.payload,
        ...(b.event.dedupe_key ? { dedupe_key: b.event.dedupe_key } : {}),
      }));
      try {
        const reply = await this.sendRequest({
          protocol: 'worker-seam/1',
          msg_type: 'worker.events.append',
          run_id: this.runId,
          generation: this.generation,
          events,
        });
        if (reply.msg_type !== 'service.events.stored') throw serviceError('internal', 'unexpected reply to events.append');
        this.transientFailures = 0;
        const storedById = new Map((reply.stored || []).map(s => [s.event_id, s]));
        for (const b of batch) b.resolve(storedById.get(b.event.event_id) || null);
      } catch (err) {
        if (this.fatal) return;
        if (err?.code) {
          // Explicit service.error: fatal, do not retry.
          for (const b of batch) b.reject(err);
          this.fail(err);
          return;
        }
        this.transientFailures += 1;
        if (this.transientFailures > MAX_TRANSIENT_FAILURES) {
          const fatal = Error('service unresponsive: event appends unacked');
          for (const b of batch) b.reject(fatal);
          this.fail(fatal);
          return;
        }
        this.queue.unshift(...batch);
      }
    } finally {
      this.flushing = false;
      if (!this.fatal && this.queue.length > 0 && !this.flushTimer) {
        const backoff = Math.min(8000, BATCH_INTERVAL_MS * 2 ** Math.max(0, this.transientFailures - 1));
        this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, backoff);
      }
    }
  }

  // Fetches one input by digest in 256 KiB chunks, reassembles, and verifies
  // the digest before returning. Any mismatch or service error throws: the
  // turn fails closed rather than restoring corrupt workspace state.
  async fetchInputs(digest, size) {
    if (!this.runId) throw Error('no active turn');
    const chunks = [];
    let offset = 0;
    while (offset < size) {
      const length = Math.min(MAX_CHUNK, size - offset);
      const reply = await this.sendRequest({
        protocol: 'worker-seam/1',
        msg_type: 'worker.inputs.fetch',
        run_id: this.runId,
        generation: this.generation,
        digest, offset, length,
      });
      if (reply.msg_type !== 'service.inputs.data') throw serviceError('internal', 'unexpected reply to inputs.fetch');
      const bytes = Buffer.from(reply.data || '', 'base64');
      if (bytes.length === 0) throw Error('empty input chunk');
      chunks.push(bytes);
      offset += bytes.length;
      if (reply.eof) break;
    }
    const data = Buffer.concat(chunks);
    if (data.length !== size) throw Error('input size mismatch');
    if (createHash('sha256').update(data).digest('hex') !== digest) throw Error('input digest mismatch');
    return data;
  }

  // Delivers one artifact manifest. Resolves with the service.artifacts.stored
  // reply ({accepted, ...}); a rejected delivery throws.
  async deliverArtifacts({ manifest_digest, files, total_bytes }) {
    if (!this.runId) throw Error('no active turn');
    const reply = await this.sendRequest({
      protocol: 'worker-seam/1',
      msg_type: 'worker.artifacts.deliver',
      run_id: this.runId,
      generation: this.generation,
      manifest: { manifest_digest, files, total_bytes },
    });
    if (reply.msg_type !== 'service.artifacts.stored') throw serviceError('internal', 'unexpected reply to artifacts.deliver');
    if (!reply.accepted) throw serviceError(reply.rejection?.code || 'internal', 'artifact delivery rejected: ' + (reply.rejection?.message || 'unknown'));
    return reply;
  }
}
