// agentmeld-server: Phase 2 Rust service front.
//
// The host's single writer: device auth, idempotent admission, SQLite state,
// static assets, and supervision of the Node worker over worker-seam/1.
// Design: docs/design/rust-service-front.md (issue #80).

pub mod api;
pub mod approvals;
pub mod auth;
pub mod backup;
pub mod db;
pub mod domain;
pub mod events;
pub mod import;
pub mod seam;
pub mod supervisor;
