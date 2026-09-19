// agentmeld-server: the Phase 2 Rust service front.
//
// Modes:
//   serve   [--dir DIR] [--port PORT] [--repo-root PATH] [--node PATH]
//   pair    [--dir DIR]
//   import  --from STATE.JSON [--dir DIR]
//
// The service is the only writer to its SQLite state under the state dir
// (default ~/.agentmeld). The serve mode takes a PID-checked startup lock;
// a stale lock is reclaimed with a logged warning.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use agentmeld_server::api::{pump_loop, router, AppState};
use agentmeld_server::approvals::{self, PendingApprovals};
use agentmeld_server::auth::Auth;
use agentmeld_server::db::Db;
use agentmeld_server::supervisor::Supervisor;

const DEFAULT_PORT: u16 = 4317;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(|s| s.as_str()).unwrap_or("serve");
    let result = match mode {
        "serve" => cmd_serve(&args[2..]),
        "pair" => cmd_pair(&args[2..]),
        "import" => cmd_import(&args[2..]),
        "-h" | "--help" | "help" => {
            print_usage(&args[0]);
            Ok(())
        }
        other => {
            eprintln!("unknown mode: {other}");
            print_usage(&args[0]);
            std::process::exit(2);
        }
    };
    if let Err(e) = result {
        eprintln!("agentmeld-server: {e}");
        std::process::exit(1);
    }
}

fn print_usage(argv0: &str) {
    eprintln!(
        "usage:\n  {argv0} serve [--dir DIR] [--port PORT] [--repo-root PATH] [--node PATH]\n  {argv0} pair [--dir DIR] [--port PORT]\n  {argv0} import --from STATE.JSON [--dir DIR]"
    );
}

fn flag_value(args: &[String], name: &str) -> Option<String> {
    let mut iter = args.iter().peekable();
    while let Some(arg) = iter.next() {
        if arg == name {
            return iter.next().cloned();
        }
        if let Some(rest) = arg.strip_prefix(&format!("{name}=")) {
            return Some(rest.to_string());
        }
    }
    None
}

fn default_state_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("AGENTMELD_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".agentmeld")
}

fn state_dir_from(args: &[String]) -> PathBuf {
    flag_value(args, "--dir")
        .map(PathBuf::from)
        .unwrap_or_else(default_state_dir)
}

fn ensure_state_dir(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("create state dir: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("chmod state dir: {e}"))?;
    }
    Ok(())
}

// ------------------------------------------------------------ startup lock.

// PID-checked single-instance lock: a live owner PID refuses startup; a
// stale lock is reclaimed with a logged warning (the locked decision).
struct StartupLock {
    path: PathBuf,
}

fn pid_alive(pid: i32) -> bool {
    // kill(pid, 0) returns 0 for a live process we can signal, -1/EPERM
    // for a live process we cannot signal, and -1/ESRCH when it is gone.
    if unsafe { libc::kill(pid, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

fn create_lock_file(path: &std::path::Path, pid: u32) -> std::io::Result<()> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    f.write_all(pid.to_string().as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).ok();
    }
    Ok(())
}

fn acquire_startup_lock(dir: &std::path::Path) -> Result<StartupLock, String> {
    let path = dir.join("service.lock");
    let me = std::process::id();
    // Atomic first claim: two racing startups cannot both win.
    match create_lock_file(&path, me) {
        Ok(()) => return Ok(StartupLock { path }),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("write lock: {e}")),
    }
    // A lock file already exists: refuse while its owner is alive.
    if let Ok(existing) = std::fs::read_to_string(&path) {
        if let Ok(pid) = existing.trim().parse::<i32>() {
            if pid != me as i32 && pid_alive(pid) {
                return Err(format!(
                    "another agentmeld-server is already running (pid {pid}); refusing startup"
                ));
            }
            eprintln!(
                "[serve] warning: reclaiming stale startup lock (previous pid {pid} is gone)"
            );
        }
    }
    // Remove the stale lock and re-create atomically: a racing peer that
    // slips in between makes this fail instead of double-claiming.
    std::fs::remove_file(&path).ok();
    create_lock_file(&path, me).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            "another agentmeld-server claimed the startup lock during reclaim; refusing startup"
                .to_string()
        } else {
            format!("write lock: {e}")
        }
    })?;
    Ok(StartupLock { path })
}

impl Drop for StartupLock {
    fn drop(&mut self) {
        std::fs::remove_file(&self.path).ok();
    }
}

// ------------------------------------------------------------------ serve.

fn find_node(flag: Option<String>) -> Result<PathBuf, String> {
    if let Some(p) = flag {
        return Ok(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("AGENTMELD_NODE") {
        return Ok(PathBuf::from(p));
    }
    let path = std::env::var("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join("node");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("node not found on PATH; pass --node PATH".to_string())
}

fn find_repo_root(flag: Option<String>) -> Result<PathBuf, String> {
    if let Some(p) = flag {
        return Ok(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("AGENTMELD_REPO") {
        return Ok(PathBuf::from(p));
    }
    // Walk up from the executable looking for apps/worker.
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(PathBuf::from);
        while let Some(d) = dir {
            if d.join("apps").join("worker").join("binding.mjs").is_file() {
                return Ok(d);
            }
            dir = d.parent().map(PathBuf::from);
        }
    }
    Err("could not locate the agentmeld repo (apps/worker); pass --repo-root PATH".to_string())
}

fn cmd_serve(args: &[String]) -> Result<(), String> {
    let dir = state_dir_from(args);
    ensure_state_dir(&dir)?;
    let _lock = acquire_startup_lock(&dir)?;

    let port: u16 = flag_value(args, "--port")
        .map(|p| p.parse().map_err(|_| "invalid --port".to_string()))
        .transpose()?
        .unwrap_or(DEFAULT_PORT);
    let repo_root = find_repo_root(flag_value(args, "--repo-root"))?;
    let node = find_node(flag_value(args, "--node"))?;

    let db_path = dir.join("agentmeld.db");
    let blob_root = dir.join("blobs");
    std::fs::create_dir_all(&blob_root).map_err(|e| format!("create blob root: {e}"))?;
    let db = Arc::new(Db::open(&db_path, &blob_root)?);
    db.run_migrations()?;
    db.seed_bootstrap()?;
    let interrupted = db.mark_interrupted_on_startup()?;
    if interrupted > 0 {
        eprintln!("[serve] marked {interrupted} in-flight run(s) interrupted by restart");
    }

    let auth = Arc::new(Auth::new(db.clone()));

    // Bootstrap pairing: no devices enrolled yet, so mint a one-time token
    // and print the pairing link the owner opens in a browser.
    let host = format!("127.0.0.1:{port}");
    if db.count_devices()? == 0 {
        let token = auth
            .mint_pairing_token()
            .map_err(|e| format!("mint pairing token: {}", e.message()))?;
        println!("No devices enrolled yet.");
        println!("Open this link in a browser to pair the first device:");
        println!("  http://{host}/api/v1/pair?token={token}");
    }

    // Phase 3 approval path: startup recovery first — pending rows from a
    // dead server are revoked (service_restart) or expired past their
    // deadline, the lease generation is fenced — then the serve-mode
    // sweep keeps expiry and lease auto-release alive.
    match db.recover_approvals_on_startup() {
        Ok((revoked, expired, lease_gen)) => {
            if expired > 0 || revoked > 0 {
                println!(
                    "[approvals] startup recovery: revoked {revoked}, expired {expired}, lease generation {lease_gen}"
                );
            }
        }
        Err(e) => eprintln!("[approvals] startup recovery failed: {e}"),
    }

    let pending = Arc::new(PendingApprovals::new());
    let supervisor = Arc::new(Supervisor::new(
        db.clone(),
        dir.clone(),
        repo_root.clone(),
        node,
        pending.clone(),
    ));

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio runtime: {e}"))?;

    runtime.block_on(async {
        let (kick_tx, kick_rx) = tokio::sync::mpsc::channel::<()>(16);
        let state = AppState {
            db: db.clone(),
            auth,
            supervisor: supervisor.clone(),
            pending: pending.clone(),
            public_dir: repo_root_public_dir(&repo_root),
            host: host.clone(),
            origin: format!("http://{host}"),
            pump_kick: kick_tx,
        };
        let app = router(state.clone());
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
            .await
            .map_err(|e| format!("bind 127.0.0.1:{port}: {e}"))?;
        println!("agentmeld-server listening on http://{host}");
        let pump = tokio::spawn(pump_loop(state, kick_rx));
        // Phase 3: server-time approval expiry + controller-lease
        // auto-release, roughly every second.
        let sweeper = tokio::spawn(approvals::sweep_loop(db.clone(), pending.clone()));
        let server = axum::serve(listener, app);
        let shutdown = shutdown_signal();
        tokio::select! {
            result = server => {
                if let Err(e) = result {
                    eprintln!("[serve] server error: {e}");
                }
            }
            _ = shutdown => {
                eprintln!("[serve] shutting down");
            }
        }
        pump.abort();
        sweeper.abort();
        Ok::<(), String>(())
    })
}

fn repo_root_public_dir(repo_root: &Path) -> PathBuf {
    repo_root.join("apps").join("poc").join("public")
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        let mut int = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
            .expect("SIGINT handler");
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await.ok();
    }
}

// ------------------------------------------------------------------- pair.

// The explicit on-host re-pairing action: mint a fresh single-use pairing
// token and print its link.
fn cmd_pair(args: &[String]) -> Result<(), String> {
    let dir = state_dir_from(args);
    ensure_state_dir(&dir)?;
    let db_path = dir.join("agentmeld.db");
    let blob_root = dir.join("blobs");
    let db = Arc::new(Db::open(&db_path, &blob_root)?);
    db.run_migrations()?;
    let auth = Auth::new(db);
    let token = auth
        .mint_pairing_token()
        .map_err(|e| format!("mint pairing token: {}", e.message()))?;
    println!("Pairing token (single use, expires in 10 minutes):");
    let port: u16 = flag_value(args, "--port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    println!("  http://127.0.0.1:{port}/api/v1/pair?token={token}");
    Ok(())
}

// ----------------------------------------------------------------- import.

fn cmd_import(args: &[String]) -> Result<(), String> {
    let from = flag_value(args, "--from")
        .ok_or_else(|| "import requires --from STATE.JSON".to_string())?;
    let dir = state_dir_from(args);
    ensure_state_dir(&dir)?;
    agentmeld_server::import::run_import(&dir, &PathBuf::from(from))
}
