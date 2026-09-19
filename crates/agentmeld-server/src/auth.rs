// Device authentication for the Rust service front.
//
// Bootstrap-minimum model from docs/design/rust-service-front.md:
//   - One-time pairing via a single-use 10-minute pairing token, minted by an
//     explicit on-host CLI action (`agentmeld-server pair`).
//   - Session tokens are 256-bit, base64url, hashed (SHA-256) at rest.
//   - The presented token's hash is compared in constant time against the
//     stored hashes; the raw token is shown once at pairing and never stored.
//   - Revocation marks sessions revoked and bumps the device's
//     revocation_version; validity is rechecked on every request.
//   - 401 = unauthenticated (missing/invalid/expired/revoked token).
//     403 = authenticated but forbidden (an enrolled device may not enroll
//     another; re-pairing goes through the on-host CLI).
//   - The service binds loopback only and never 0.0.0.0.

use std::sync::Arc;

use crate::db::Db;
use crate::domain::{constant_time_eq, new_token_b64url, now_ms, sha256_hex};

pub const PAIRING_TOKEN_TTL_SECS: i64 = 600; // single-use, 10 minutes
pub const SESSION_TTL_SECS: i64 = 90 * 24 * 3600; // 90 days

#[derive(Debug, Clone)]
pub struct SessionContext {
    pub device_id: String,
    pub device_name: String,
}

#[derive(Debug)]
pub enum AuthError {
    Unauthorized(String),
    Forbidden(String),
    Internal(String),
}

impl AuthError {
    pub fn status(&self) -> u16 {
        match self {
            AuthError::Unauthorized(_) => 401,
            AuthError::Forbidden(_) => 403,
            AuthError::Internal(_) => 500,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            AuthError::Unauthorized(m) | AuthError::Forbidden(m) | AuthError::Internal(m) => m,
        }
    }
}

pub struct Auth {
    db: Arc<Db>,
}

impl Auth {
    pub fn new(db: Arc<Db>) -> Self {
        Auth { db }
    }

    /// Validate a bearer token against the stored session hashes.
    /// Comparisons are constant-time over the (small) session set so a
    /// wrong token reveals nothing about which hash is close.
    pub fn authenticate(&self, authorization: Option<&str>) -> Result<SessionContext, AuthError> {
        let raw = authorization
            .and_then(|h| h.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| AuthError::Unauthorized("Authentication required.".to_string()))?;
        let presented = sha256_hex(raw.as_bytes());
        let candidates = self.db.session_hashes().map_err(AuthError::Internal)?;
        // Compare every candidate: breaking on the first match would make
        // the response time depend on which row matched.
        let mut matched: Option<(String, String, Option<i64>, Option<i64>)> = None;
        for (hash, device_id, device_name, expires_at, revoked_at) in candidates {
            if constant_time_eq(hash.as_bytes(), presented.as_bytes()) {
                matched = Some((device_id, device_name, expires_at, revoked_at));
            }
        }
        let (device_id, device_name, expires_at, revoked_at) =
            matched.ok_or_else(|| AuthError::Unauthorized("Invalid session token.".to_string()))?;
        if revoked_at.is_some() {
            return Err(AuthError::Unauthorized("Session revoked.".to_string()));
        }
        if let Some(exp) = expires_at {
            if exp < now_ms() {
                return Err(AuthError::Unauthorized("Session expired.".to_string()));
            }
        }
        // Revocation-version recheck happens inside session_hashes: sessions
        // issued before a revocation-version bump are not returned, so a
        // revoked device cannot authenticate on a stale session row.
        self.db.touch_device(&device_id).ok();
        Ok(SessionContext {
            device_id,
            device_name,
        })
    }

    /// Redeem a pairing token for a new device enrollment. The token is
    /// consumed atomically with enrollment: one transaction, no double use.
    /// An already-enrolled device presenting a session token here gets 403;
    /// re-pairing after bootstrap requires the on-host CLI.
    pub fn pair(
        &self,
        pairing_token: &str,
        device_name: &str,
        existing_session: Option<&str>,
    ) -> Result<(String, String), AuthError> {
        if let Some(authz) = existing_session {
            if self.authenticate(Some(authz)).is_ok() {
                return Err(AuthError::Forbidden(
                    "This device is already enrolled. Re-pairing requires an on-host pairing token.".to_string(),
                ));
            }
        }
        let name = device_name.trim();
        if name.is_empty() || name.len() > 64 {
            return Err(AuthError::Unauthorized("Invalid device name.".to_string()));
        }
        let token_hash = sha256_hex(pairing_token.trim().as_bytes());
        let token = self
            .db
            .find_pairing_token(&token_hash)
            .map_err(AuthError::Internal)?
            .ok_or_else(|| AuthError::Unauthorized("Invalid pairing token.".to_string()))?;
        if token.used_at.is_some() || token.expires_at < now_ms() {
            // Used and expired are indistinguishable to the caller: no oracle.
            return Err(AuthError::Unauthorized(
                "Invalid pairing token.".to_string(),
            ));
        }
        let raw_session = new_token_b64url();
        let session_hash = sha256_hex(raw_session.as_bytes());
        let device_id = self
            .db
            .redeem_pairing_token(
                &token_hash,
                name,
                &session_hash,
                now_ms() + SESSION_TTL_SECS * 1000,
            )
            .map_err(|e| {
                if e == "already-used" {
                    AuthError::Unauthorized("Invalid pairing token.".to_string())
                } else {
                    AuthError::Internal(e)
                }
            })?;
        Ok((device_id, raw_session))
    }

    /// Mint a single-use pairing token (the on-host CLI action).
    pub fn mint_pairing_token(&self) -> Result<String, AuthError> {
        let (raw, _hash) = self
            .db
            .mint_pairing_token(PAIRING_TOKEN_TTL_SECS)
            .map_err(AuthError::Internal)?;
        Ok(raw)
    }

    /// Revoke all sessions for a device and bump its revocation version.
    pub fn revoke_device(&self, device_id: &str) -> Result<usize, AuthError> {
        self.db
            .revoke_device_sessions(device_id)
            .map_err(AuthError::Internal)
    }
}
