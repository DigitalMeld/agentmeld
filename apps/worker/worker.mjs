// Worker process entry point (Phase 1). The service spawns one worker
// process per turn: the worker connects to the service's Unix socket, shakes
// hands, waits for service.turn.start, executes the turn, and exits once the
// terminal events are acked.
//
//   AGENTMELD_WORKER_SOCKET      the service's Unix socket path (required)
//   AGENTMELD_WORKER_TOKEN       the boot-issued credential (required)
//   AGENTMELD_RESUME_THREAD_ID   the provider thread to resume, if the turn
//                                continues an existing native session
//                                (Phase 1 gap-fill: worker-seam/1 has no field
//                                for it; the service sets it at spawn).
import { connect } from 'node:net';
import { WorkerSeam } from './seam.mjs';
import { executeTurn } from './runtime.mjs';

const socketPath = process.env.AGENTMELD_WORKER_SOCKET;
const token = process.env.AGENTMELD_WORKER_TOKEN;
if (!socketPath || !token) { console.error('worker: AGENTMELD_WORKER_SOCKET and AGENTMELD_WORKER_TOKEN are required'); process.exit(2); }

const socket = connect(socketPath);
const seam = new WorkerSeam(socket, {
  onServiceMessage: msg => {
    if (msg.msg_type === 'service.turn.start') void handleTurnStart(msg);
    else if (msg.msg_type === 'service.turn.cancel') seam.onTurnCancel?.(msg);
    else if (msg.msg_type === 'service.lease.command') {
      // Phase 1 stub: accepted and logged. There is no UI to surface lease
      // commands yet; the worker records the latest generation it was told.
      console.error(`worker: lease command ${msg.command} accepted (lease_generation ${msg.lease_generation})`);
    } else console.error('worker: unknown service message', msg?.message);
  },
  onServiceError: msg => seam.onServiceError?.(msg),
  onFatal: err => {
    console.error('worker: fatal transport error:', err.message);
    (async () => { try { await seam.abortHook?.(); } finally { process.exit(1); } })();
  },
});
socket.on('error', err => console.error('worker: socket error:', err.message));

let turnActive = false;
async function handleTurnStart(msg) {
  if (turnActive) { console.error('worker: turn already active; ignoring duplicate turn.start'); return; }
  turnActive = true;
  seam.setTurn(msg.run_id, msg.generation);
  try {
    await executeTurn(msg, seam);
  } catch (err) {
    console.error('worker: turn threw:', err.message);
  } finally {
    // The turn's terminal events were acked inside executeTurn; exit so the
    // service can reap this per-turn worker.
    process.exit(0);
  }
}

try {
  await seam.hello(token);
} catch (err) {
  console.error('worker: handshake failed:', err.message);
  process.exit(1);
}
