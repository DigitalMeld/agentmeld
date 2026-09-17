"""Prepare the M0 browser policy from a hash-verified upstream configuration.

The only local rule allows chroot so Chromium can finish its nested namespace
sandbox after capabilities are dropped. This never adds container capabilities.
The download is explicit and retained under ignored .local, not vendored.
"""
import hashlib
import json
from pathlib import Path
import subprocess

UPSTREAM_COMMIT = "1b025d7e20a026371cd5f98ba0cdce48892737c8"
UPSTREAM_URL = f"https://raw.githubusercontent.com/microsoft/playwright/{UPSTREAM_COMMIT}/utils/docker/seccomp_profile.json"
UPSTREAM_SHA256 = "cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849"


def browser_policy(source):
    if hashlib.sha256(source).hexdigest() != UPSTREAM_SHA256:
        raise ValueError("upstream seccomp checksum mismatch")
    policy = json.loads(source)
    if policy["defaultAction"] != "SCMP_ACT_ERRNO":
        raise ValueError("seccomp must deny by default")
    policy["syscalls"].append({
        "names": ["chroot"], "action": "SCMP_ACT_ALLOW", "args": [],
        "includes": {}, "excludes": {},
    })
    return (json.dumps(policy, indent=2) + "\n").encode()


def verify_prepared(root):
    directory = root / ".local/m0/seccomp"
    source = (directory / "upstream.json").read_bytes()
    target = directory / "browser.json"
    if target.read_bytes() != browser_policy(source):
        raise ValueError("prepared seccomp profile changed; rerun prepare-seccomp.py")
    return target


def main():
    root = Path(__file__).resolve().parents[1]
    directory = root / ".local/m0/seccomp"
    directory.mkdir(parents=True, exist_ok=True)
    source = subprocess.check_output([
        "curl", "--fail", "--silent", "--show-error", "--location",
        "--proto", "=https", "--proto-redir", "=https", "--max-time", "30", UPSTREAM_URL,
    ])
    output = browser_policy(source)
    (directory / "upstream.json").write_bytes(source)
    (directory / "browser.json").write_bytes(output)
    print("Prepared browser seccomp policy:", verify_prepared(root))
    print("SHA256:", hashlib.sha256(output).hexdigest())


if __name__ == "__main__":
    main()
