// Pure SSE frame parser for the AgentMeld client track.
//
// No DOM, no fetch, no timers — safe to import from Node tests and from
// the browser module. Implements the subset of the SSE wire format the
// server emits:
//
//   retry: <ms>            — server-controlled reconnect delay
//   :comment               — heartbeat / comment, ignored but counts as liveness
//   event: <name>          — named frame (stream.hello, stream.resync_required)
//   id: <seq>              — numeric journal sequence for data frames
//   data: <json>           — one or more data lines, joined with "\n"
//
// A blank line dispatches the accumulated frame. Frames split across
// chunk boundaries are reassembled.

export const RETRY_MIN_MS = 500;
export const RETRY_MAX_MS = 30000;

/** Clamp a server-sent retry delay to sane bounds. */
export function clampRetry(ms) {
  const s = String(ms).trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, Math.round(n)));
}

export function newFrame() {
  return { event: '', data: [], id: '' };
}

export class SseParser {
  constructor() {
    this.buf = '';
    this.frame = newFrame();
    this.retryMs = null; // last valid retry: value seen on this connection
    this.linesSeen = 0; // any line (incl. :ping) counts as liveness
  }

  /**
   * Feed a decoded text chunk. Returns { frames, retryMs } where frames is
   * the list of complete frames terminated by a blank line in this chunk,
   * and retryMs is the latest clamped server retry hint (or null).
   */
  push(chunk) {
    const frames = [];
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, '');
      this.buf = this.buf.slice(idx + 1);
      this.linesSeen += 1;
      if (line === '') {
        frames.push(this.frame);
        this.frame = newFrame();
      } else if (line[0] === ':') {
        // comment / heartbeat — liveness only
      } else if (line.indexOf('data:') === 0) {
        this.frame.data.push(line.slice(5).replace(/^ /, ''));
      } else if (line.indexOf('event:') === 0) {
        this.frame.event = line.slice(6).trim();
      } else if (line.indexOf('id:') === 0) {
        this.frame.id = line.slice(3).trim();
      } else if (line.indexOf('retry:') === 0) {
        const clamped = clampRetry(line.slice(6).trim());
        if (clamped !== null) this.retryMs = clamped;
      }
      // unknown fields are ignored per the SSE spec
    }
    const out = { frames, retryMs: this.retryMs };
    return out;
  }

  /** Frame data joined as the SSE spec defines. */
  static frameData(frame) {
    return frame.data.join('\n');
  }
}
