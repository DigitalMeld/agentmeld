// Real Unix-socket worker lifecycle: a stub Node worker that speaks
// worker-seam/1 completes a turn end to end against the supervisor.
mod common;

use agentmeld_server::db::{AdmitInput, Db};
use agentmeld_server::domain::new_uuid;
use agentmeld_server::seam::Binding;
use agentmeld_server::supervisor::{Supervisor, TurnContext};
use std::sync::Arc;

const STUB_WORKER: &str = r#"// Stub worker-seam/1 worker for the supervisor lifecycle test.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const socketPath = process.env.AGENTMELD_WORKER_SOCKET;
const token = process.env.AGENTMELD_WORKER_TOKEN;
if (!socketPath || !token) { console.error('missing worker env'); process.exit(2); }

const sock = net.createConnection(socketPath);
let buf = '';
const queue = [];
let waiter = null;
sock.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (waiter) { const w = waiter; waiter = null; w(msg); }
    else queue.push(msg);
  }
});
sock.on('error', (e) => { console.error('socket error', e.message); process.exit(7); });
function nextMsg() {
  if (queue.length) return Promise.resolve(queue.shift());
  return new Promise((res) => { waiter = res; });
}
function send(obj) { sock.write(JSON.stringify(obj) + '\n'); }

(async () => {
  send({ protocol: 'worker-seam/1', msg_id: 'hello-1',
         msg_type: 'worker.session.hello', worker_pid: process.pid, worker_token: token });
  const welcome = await nextMsg();
  if (welcome.msg_type !== 'service.session.welcome' || welcome.ok !== true) process.exit(3);
  const start = await nextMsg();
  if (start.msg_type !== 'service.turn.start') process.exit(4);
  // The completed event requires a workspace snapshot in the staging dir.
  fs.writeFileSync(path.join(start.turn.staging_dir, 'workspace-listing.json'), '[]');
  send({ protocol: 'worker-seam/1', msg_id: 'ev-1', msg_type: 'worker.events.append',
         run_id: start.run_id, generation: start.generation,
         events: [{ event_id: 'ev-1', event_type: 'run.completed', payload: {} }] });
  const stored = await nextMsg();
  if (stored.msg_type !== 'service.events.stored') process.exit(5);
  const dup = stored.stored.find((s) => s.event_id === 'ev-1');
  if (!dup || dup.duplicate) process.exit(8);
  // Teardown evidence, exactly like the real worker's finally block.
  send({ protocol: 'worker-seam/1', msg_id: 'ev-2', msg_type: 'worker.events.append',
         run_id: start.run_id, generation: start.generation,
         events: [{ event_id: 'ev-2', event_type: 'run.terminated',
                    payload: { cleanup_ok: true } }] });
  const termAck = await nextMsg();
  if (termAck.msg_type !== 'service.events.stored') process.exit(9);
  sock.end();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(6); });
"#;

fn binding() -> Binding {
    Binding {
        image_digest: "img".to_string(),
        store_instance: "store".to_string(),
        model: "model".to_string(),
        policy_digest: "policy".to_string(),
    }
}

fn setup() -> (Arc<Db>, std::path::PathBuf, std::path::PathBuf) {
    let (db, dir) = common::test_db();
    let repo_root = dir.join("repo");
    std::fs::create_dir_all(repo_root.join("apps/worker")).unwrap();
    std::fs::write(repo_root.join("apps/worker/worker.mjs"), STUB_WORKER).unwrap();
    let state_dir = dir.join("state");
    std::fs::create_dir_all(&state_dir).unwrap();
    (db, dir, repo_root)
}

#[tokio::test]
async fn stub_worker_completes_turn_over_unix_socket() {
    let (db, dir, repo_root) = setup();
    let state_dir = dir.join("state");

    let run_id = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "lifecycle probe".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit")
        .run_id;
    let claimed = db.claim_queued_run().expect("claim").expect("a run");
    let conversation_id = claimed.conversation_id.clone();

    let supervisor = Supervisor::new(
        db.clone(),
        state_dir,
        repo_root,
        std::path::PathBuf::from("node"),
    );
    supervisor
        .run_turn(TurnContext {
            run_id: run_id.clone(),
            conversation_id,
            agent_context: "You are a test agent.".to_string(),
            resume_thread_id: None,
            binding: Some(binding()),
        })
        .await
        .expect("turn completes");

    let run = db.get_run(&run_id).expect("read run");
    assert_eq!(run.status.as_str(), "completed");
    common::cleanup(&dir);
}

#[tokio::test]
async fn wrong_handshake_token_rejects_worker() {
    let (db, dir, repo_root) = setup();
    let state_dir = dir.join("state");

    // A worker that presents a bad token must be rejected; the run fails
    // closed as interrupted, never as completed.
    std::fs::write(
        repo_root.join("apps/worker/worker.mjs"),
        STUB_WORKER.replace("worker_token: token", "worker_token: 'wrong-token'"),
    )
    .unwrap();

    let run_id = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "rejection probe".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit")
        .run_id;
    let claimed = db.claim_queued_run().expect("claim").expect("a run");
    let conversation_id = claimed.conversation_id.clone();

    let supervisor = Supervisor::new(
        db.clone(),
        state_dir,
        repo_root,
        std::path::PathBuf::from("node"),
    );
    let err = supervisor
        .run_turn(TurnContext {
            run_id: run_id.clone(),
            conversation_id,
            agent_context: "x".to_string(),
            resume_thread_id: None,
            binding: Some(binding()),
        })
        .await
        .expect_err("bad token must reject the worker");
    assert!(
        err.to_string().contains("worker hello rejected"),
        "got: {err}"
    );

    let run = db.get_run(&run_id).expect("read run");
    assert_eq!(run.status.as_str(), "interrupted", "fail closed");
    common::cleanup(&dir);
}

#[tokio::test]
async fn worker_crash_during_handshake_fails_fast() {
    let (db, dir, repo_root) = setup();
    let state_dir = dir.join("state");

    // A worker that dies before its hello must surface as a crash, not a
    // 15-second hello timeout.
    std::fs::write(
        repo_root.join("apps/worker/worker.mjs"),
        "process.exit(42);\n",
    )
    .unwrap();

    let run_id = db
        .admit(
            &AdmitInput {
                conversation_id: None,
                prompt: "crash probe".to_string(),
                request_key: new_uuid(),
                files: vec![],
            },
            "owner",
        )
        .expect("admit")
        .run_id;
    let claimed = db.claim_queued_run().expect("claim").expect("a run");
    let conversation_id = claimed.conversation_id.clone();

    let supervisor = Supervisor::new(
        db.clone(),
        state_dir,
        repo_root,
        std::path::PathBuf::from("node"),
    );
    let start = std::time::Instant::now();
    let err = supervisor
        .run_turn(TurnContext {
            run_id: run_id.clone(),
            conversation_id,
            agent_context: "x".to_string(),
            resume_thread_id: None,
            binding: Some(binding()),
        })
        .await
        .expect_err("crashed worker must fail the turn");
    assert!(
        err.to_string().contains("worker exited during handshake"),
        "got: {err}"
    );
    assert!(
        start.elapsed() < std::time::Duration::from_secs(10),
        "crash must not wait out the hello timeout"
    );

    let run = db.get_run(&run_id).expect("read run");
    assert_eq!(run.status.as_str(), "interrupted", "fail closed");
    common::cleanup(&dir);
}
