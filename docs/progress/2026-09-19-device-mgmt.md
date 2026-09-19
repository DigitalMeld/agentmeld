# Device management: paired-device list + revoke UI (issue #107)

**Date:** 2026-09-19 UTC · **Branch:** `impl/2026-09-19-device-mgmt`

Devices paired and a server-side kill switch existed
(`POST /devices/{id}/revoke`), but there was no way to *see* paired
devices and no UI to revoke one. A lost browser kept its session until
expiry.

## Server

- **New endpoint** `GET /api/v1/devices` (device-authed):
  `[{id, name, enrolled_at_ms, active_sessions, revoked, is_current_device}]`.
  `revoked` = the kill switch was pulled (revocation_version > 1); a device
  whose sessions merely expired is inactive, not revoked.
- `Db::list_devices()` — one query, oldest first; a session counts as
  active when neither revoked nor past its expiry.

## UI

- Clicking the "This Mac" host block in the sidebar opens a **Devices**
  dialog (native `<dialog>`, keyboard accessible).
- Each row: name, enrolled date, active session count, a violet
  **This device** badge on the caller's own device, a **Revoked** badge on
  killed devices.
- Other devices with live sessions get a two-step **Revoke** button (arm →
  Confirm revoke, 6s, red) calling the existing kill switch; the list
  refreshes in place.
- Revoking the *current* device is allowed and honest: its sessions die,
  the next poll 401s, and the expired-session pairing flow ("Pair a new
  device") takes over.

## Verification

- New Rust test `device_list_reports_sessions_and_revocation` in
  `tests/auth_flow.rs`: two paired devices list oldest-first with session
  counts; the kill switch zeroes sessions and flags revoked.
- E2E: second device pairs via the API, dialog opens from the host block,
  rows + "This device" badge asserted, revoke arms/confirms/notices, the
  row flips to Revoked — **33/33 green**.
- Headless-Firefox screenshots of the dialog (list, armed, revoked) at
  1440×900 inspected. Fixed a real CSS bug in passing: `--border` is not a
  defined theme token (the scale uses `--line`), so the new device-row
  borders use `var(--line)`.
- `sh scripts/check-local.sh` green.

## Out of scope (noted)

- Device rename — a future device-list power, not MVP.
- The pre-existing approval-history Revoke pill also references the
  undefined `--border` token; left untouched to keep this diff focused.
