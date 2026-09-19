// JSON-lines framing over a Unix socket for worker-seam/1.
//
// PHASE 1 TRANSPORT NOTE: the Phase 0 seam spec authenticates the worker at
// the transport layer (boot-issued token in the spawn environment, a 0700
// socket file, and a server-side pid check against the spawned child). Phase 1
// implements exactly that over a real Unix socket with JSON-lines frames and
// a 1 MiB frame cap. The worker is spawned per turn as a child of the service,
// so "boot-issued" means issued at spawn. A future phase may move to a
// long-lived worker process; the framing and checks here carry over unchanged.
// What Phase 1 does NOT prove: SO_PEERCRED-level peer authentication (the pid
// check covers the spawn-per-turn case instead), or token rotation.
import { randomUUID } from 'node:crypto';

export const MAX_FRAME_BYTES = 1024 * 1024;
export const newMsgId = () => randomUUID();

export function sendFrame(socket, obj) {
  socket.write(JSON.stringify(obj) + '\n');
}

// Reads newline-delimited JSON frames from socket. Calls onFrame(msg) for
// each complete frame; onError(err) is terminal (the caller should fail the
// turn and tear the socket down). Frames larger than maxBytes are rejected
// rather than buffered.
export function createFrameReader(socket, { onFrame, onError, maxBytes = MAX_FRAME_BYTES }) {
  let buffer = Buffer.alloc(0);
  let ended = false;
  const fail = err => { if (!ended) { ended = true; onError(err); } };
  socket.on('data', chunk => {
    if (ended) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > maxBytes) { fail(Error('frame exceeds 1 MiB cap')); return; }
    let idx;
    while ((idx = buffer.indexOf(0x0a)) !== -1) {
      const line = buffer.subarray(0, idx);
      buffer = buffer.subarray(idx + 1);
      if (line.length === 0) continue;
      let msg;
      try { msg = JSON.parse(line.toString('utf8')); }
      catch { fail(Error('malformed JSON frame')); return; }
      try { onFrame(msg); } catch (err) { fail(err); }
    }
  });
  socket.on('error', fail);
}
