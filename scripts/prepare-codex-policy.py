"""Prepare explicit M0 Codex policies. Does not load AppArmor or alter Docker defaults."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location("browser_seccomp", Path(__file__).with_name("prepare-seccomp.py"))
browser_seccomp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(browser_seccomp)
APPARMOR_URL = "https://raw.githubusercontent.com/moby/moby/v28.0.4/profiles/apparmor/template.go"
APPARMOR_SHA256 = "42130ca5908f45263facef820961d9e1a988e82f8a2937f4658e7bcccc96cc07"
PROFILE = "agentmeld-m0-codex"
MOUNTS = """  # Bubblewrap setup paths; outer capabilities remain dropped.
  mount options=(rw, silent, rslave) -> /,
  mount fstype=tmpfs -> /tmp/,
  mount options=(rw, silent, rbind) /tmp/newroot/ -> /tmp/newroot/,
  pivot_root /tmp/,
  mount options=(rw, rbind) /oldroot/{,**} -> /newroot/{,**},
  mount options=(rw, bind) /oldroot/{,**} -> /newroot/{,**},
  mount options in (ro, rw, remount, bind, nosuid, nodev, noexec, silent, relatime) -> /newroot/{,**},
  mount fstype=tmpfs -> /newroot/{,**},
  mount fstype=proc -> /newroot/proc/,
  mount fstype=devpts -> /newroot/dev/pts/,
  mount options=(rw, silent, rprivate) -> /oldroot/,
  pivot_root /newroot/,
"""


def codex_seccomp(source):
    policy = json.loads(browser_seccomp.browser_policy(source))
    policy["syscalls"].append({"names": ["mount", "umount2", "pivot_root"], "action": "SCMP_ACT_ALLOW", "args": [], "includes": {}, "excludes": {}})
    return (json.dumps(policy, indent=2) + "\n").encode()


def codex_apparmor(source):
    if hashlib.sha256(source).hexdigest() != APPARMOR_SHA256:
        raise ValueError("AppArmor upstream checksum mismatch")
    policy = source.decode().split("const baseTemplate = `", 1)[1].rsplit("`", 1)[0]
    policy = policy.replace("{{range $value := .Imports}}\n{{$value}}\n{{end}}", "#include <tunables/global>")
    policy = policy.replace("{{range $value := .InnerImports}}\n  {{$value}}\n{{end}}", "  #include <abstractions/base>")
    policy = policy.replace("{{.Name}}", PROFILE).replace("{{.DaemonProfile}}", "unconfined")
    if policy.count("  deny mount,") != 1 or "{{" in policy:
        raise ValueError("unexpected AppArmor template")
    return policy.replace("  deny mount,", MOUNTS).encode()


def verify_prepared(root):
    directory = root / ".local/m0/seccomp"
    seccomp = directory / "codex.json"
    apparmor = directory / (PROFILE + ".apparmor")
    if seccomp.read_bytes() != codex_seccomp((directory / "upstream.json").read_bytes()):
        raise ValueError("prepared Codex seccomp policy changed")
    if apparmor.read_bytes() != codex_apparmor((directory / "apparmor-upstream.go").read_bytes()):
        raise ValueError("prepared Codex AppArmor policy changed")
    return seccomp, apparmor


def main():
    root = Path(__file__).resolve().parents[1]
    directory = root / ".local/m0/seccomp"
    # Require the independently verified browser policy first.
    browser_seccomp.verify_prepared(root)
    source = subprocess.check_output(["curl", "--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https", "--max-time", "30", APPARMOR_URL])
    apparmor = codex_apparmor(source)
    seccomp = codex_seccomp((directory / "upstream.json").read_bytes())
    (directory / "apparmor-upstream.go").write_bytes(source)
    (directory / "codex.json").write_bytes(seccomp)
    (directory / (PROFILE + ".apparmor")).write_bytes(apparmor)
    for path in verify_prepared(root):
        print(path.name, hashlib.sha256(path.read_bytes()).hexdigest())
    print("Prepared only; load the named AppArmor profile explicitly in the dedicated VM.")


if __name__ == "__main__":
    main()
