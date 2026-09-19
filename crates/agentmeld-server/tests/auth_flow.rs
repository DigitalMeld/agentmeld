// Device-auth flows: pairing single-use, 401/403 distinction, expiry,
// and revocation-version behavior.
mod common;

use agentmeld_server::auth::{Auth, AuthError};

fn status_of(e: &AuthError) -> u16 {
    e.status()
}

#[test]
fn pairing_token_is_single_use() {
    let (db, dir) = common::test_db();
    let auth = Auth::new(db.clone());

    let pairing = auth.mint_pairing_token().expect("mint");
    let (device_id, session) = auth
        .pair(&pairing, "Test iPhone", None)
        .expect("first redemption");
    assert!(!device_id.is_empty());

    // The same token redeemed again is rejected: no oracle between
    // used and expired.
    let err = auth
        .pair(&pairing, "Second device", None)
        .expect_err("second redemption must fail");
    assert_eq!(status_of(&err), 401);

    // The issued session authenticates.
    let ctx = auth
        .authenticate(Some(&format!("Bearer {session}")))
        .expect("session works");
    assert_eq!(ctx.device_id, device_id);
    assert_eq!(ctx.device_name, "Test iPhone");
    common::cleanup(&dir);
}

#[test]
fn enrolled_device_cannot_enroll_another() {
    let (db, dir) = common::test_db();
    let auth = Auth::new(db.clone());

    let pairing = auth.mint_pairing_token().expect("mint");
    let (_, session) = auth.pair(&pairing, "Device A", None).expect("enroll A");

    // An already-enrolled device presenting its session at the pairing
    // endpoint gets 403, not a new enrollment.
    let pairing2 = auth.mint_pairing_token().expect("mint 2");
    let err = auth
        .pair(&pairing2, "Device B", Some(&format!("Bearer {session}")))
        .expect_err("enrolled device re-pairing must fail");
    assert_eq!(status_of(&err), 403);
    common::cleanup(&dir);
}

#[test]
fn expired_pairing_token_rejected() {
    let (db, dir) = common::test_db();
    let auth = Auth::new(db.clone());

    // A token minted with a negative TTL is already expired.
    let (raw, _hash) = db.mint_pairing_token(-60).expect("mint expired token");
    let err = auth
        .pair(&raw, "Late device", None)
        .expect_err("expired token must fail");
    assert_eq!(status_of(&err), 401);
    common::cleanup(&dir);
}

#[test]
fn revocation_kills_sessions_and_version_filters_stale_rows() {
    let (db, dir) = common::test_db();
    let auth = Auth::new(db.clone());

    let pairing = auth.mint_pairing_token().expect("mint");
    let (device_id, session) = auth.pair(&pairing, "Lost phone", None).expect("enroll");
    auth.authenticate(Some(&format!("Bearer {session}")))
        .expect("session valid before revocation");

    auth.revoke_device(&device_id).expect("revoke");

    // The pre-revocation session no longer authenticates.
    let err = auth
        .authenticate(Some(&format!("Bearer {session}")))
        .expect_err("revoked session must fail");
    assert_eq!(status_of(&err), 401);

    // A fresh pairing after revocation works: the revocation-version
    // filter only excludes sessions issued before the bump.
    let pairing2 = auth.mint_pairing_token().expect("mint 2");
    let (_, session2) = auth
        .pair(&pairing2, "Replacement phone", None)
        .expect("re-enroll after revocation");
    auth.authenticate(Some(&format!("Bearer {session2}")))
        .expect("post-revocation session works");
    common::cleanup(&dir);
}

#[test]
fn wrong_token_is_unauthorized() {
    let (db, dir) = common::test_db();
    let auth = Auth::new(db.clone());
    let err = auth
        .authenticate(Some("Bearer not-a-real-session-token"))
        .expect_err("bogus token must fail");
    assert_eq!(status_of(&err), 401);
    let err = auth.authenticate(None).expect_err("missing auth must fail");
    assert_eq!(status_of(&err), 401);
    common::cleanup(&dir);
}

#[test]
fn device_list_reports_sessions_and_revocation() {
    let (db, dir) = common::test_db();
    let auth = Auth::new(db.clone());

    let pairing = auth.mint_pairing_token().expect("mint");
    let (d1, _s1) = auth.pair(&pairing, "Browser", None).expect("pair 1");
    let pairing2 = auth.mint_pairing_token().expect("mint");
    let (d2, _s2) = auth.pair(&pairing2, "Phone", None).expect("pair 2");

    let list = db.list_devices().expect("list");
    assert_eq!(list.len(), 2);
    // Oldest first.
    assert_eq!(list[0].id, d1);
    assert_eq!(list[0].name, "Browser");
    assert_eq!(list[0].active_sessions, 1);
    assert!(!list[0].revoked);
    assert_eq!(list[1].id, d2);
    assert_eq!(list[1].active_sessions, 1);

    // The kill switch: sessions die and the device flags revoked.
    db.revoke_device_and_settle(&d2).expect("revoke device");
    let list = db.list_devices().expect("list after revoke");
    let phone = list.iter().find(|d| d.id == d2).expect("phone listed");
    assert_eq!(phone.active_sessions, 0);
    assert!(phone.revoked);
    let browser = list.iter().find(|d| d.id == d1).expect("browser listed");
    assert_eq!(browser.active_sessions, 1);
    assert!(!browser.revoked);
    common::cleanup(&dir);
}
