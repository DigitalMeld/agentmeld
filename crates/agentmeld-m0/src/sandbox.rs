use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct SandboxPlan {
    image_id: String,
    workspace: PathBuf,
    name: String,
}

impl SandboxPlan {
    /// `root` is an operator-owned M0 workspace directory, never an API request value.
    /// Deployment code must eliminate mount TOCTOU races before multiuser use.
    pub fn new(root: &Path, name: &str, image_id: &str) -> Result<Self, String> {
        if name.is_empty()
            || name.len() > 48
            || !name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err("invalid workspace name".into());
        }
        if !image_id.starts_with("sha256:")
            || image_id.len() != 71
            || !image_id[7..].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("an inspected immutable image ID is required".into());
        }
        let root = root.canonicalize().map_err(|_| "workspace root missing")?;
        let requested = root.join(name);
        if std::fs::symlink_metadata(&requested)
            .map_err(|_| "workspace missing")?
            .file_type()
            .is_symlink()
        {
            return Err("workspace cannot be a symlink".into());
        }
        let workspace = requested.canonicalize().map_err(|_| "workspace missing")?;
        if !workspace.is_dir() || workspace.parent() != Some(root.as_path()) {
            return Err("workspace escapes configured root".into());
        }
        if workspace
            .to_str()
            .is_none_or(|p| p.contains(',') || p.contains('\n'))
        {
            return Err("workspace path cannot be encoded as a Docker mount".into());
        }
        Ok(Self {
            image_id: image_id.into(),
            workspace,
            name: name.into(),
        })
    }

    /// Offline qualification only: no network, provider secrets, sockets, or host home.
    /// Caller uses Command::args, never joins these into shell code.
    pub fn args(&self) -> Vec<String> {
        vec![
            "run".into(),
            "--rm".into(),
            "--init".into(),
            "--name".into(),
            format!("agentmeld-m0-{}", self.name),
            "--label".into(),
            "io.digitalmeld.agentmeld.phase=m0".into(),
            "--network=none".into(),
            "--read-only".into(),
            "--user=1000:1000".into(),
            "--cap-drop=ALL".into(),
            "--security-opt=no-new-privileges:true".into(),
            "--memory=1g".into(),
            "--cpus=1".into(),
            "--pids-limit=256".into(),
            "--tmpfs=/tmp:rw,nosuid,nodev,size=268435456,mode=1777".into(),
            "--env=HOME=/tmp/home".into(),
            "--env=CODEX_HOME=/tmp/home/.codex".into(),
            "--workdir=/workspace".into(),
            "--mount".into(),
            format!(
                "type=bind,source={},target=/workspace",
                self.workspace.display()
            ),
            self.image_id.clone(),
            "node".into(),
            "/opt/agentmeld/probe.mjs".into(),
        ]
    }
}
