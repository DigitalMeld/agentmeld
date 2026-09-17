"""Run an owned offline experiment with a plan emitted by the Rust crate.

Requires a Docker context explicitly selected by the operator. No credentials,
provider configurations, host home, or browser profiles are mounted. All retained
results live under .local/m0. A nonzero exit preserves evidence and reports failure.
"""
import argparse
import importlib.util
import hashlib
import json
import re
from pathlib import Path
import subprocess
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--context", required=True)
parser.add_argument("--image", default="agentmeld-m0:local")
parser.add_argument("--workspace", default="fixture")
parser.add_argument("--seccomp-profile", choices=["browser", "docker-default"], default="browser")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
owned = root / ".local/m0/workspaces"
if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,47}", args.workspace):
    parser.error("invalid workspace name")
workspace = owned / args.workspace
workspace.mkdir(parents=True, exist_ok=True)
image_id = subprocess.check_output(["docker", "--context", args.context, "image", "inspect", args.image, "--format", "{{.Id}}"], text=True).strip()
plan = json.loads(subprocess.check_output([str(root / "target/debug/agentmeld-m0"), "sandbox-plan", str(owned), args.workspace, image_id], text=True))
# Each invocation owns a unique container name, including timeout cleanup.
container_name = "agentmeld-m0-" + uuid.uuid4().hex
plan[plan.index("--name") + 1] = container_name
profile_digest = None
if args.seccomp_profile == "browser":
    spec = importlib.util.spec_from_file_location("prepare_seccomp", root / "scripts/prepare-seccomp.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        profile = module.verify_prepared(root)
    except (OSError, ValueError) as error:
        raise SystemExit(f"Browser seccomp policy unavailable: {error}. Run python3 scripts/prepare-seccomp.py")
    profile_digest = hashlib.sha256(profile.read_bytes()).hexdigest()
    plan[1:1] = ["--security-opt=seccomp=" + str(profile)]
started = time.monotonic()
command = ["docker", "--context", args.context, *plan]
try:
    result = subprocess.run(command, capture_output=True, text=True, timeout=100)
except subprocess.TimeoutExpired:
    # Terminate only the uniquely named task container. Do not touch other containers.
    subprocess.run(["docker", "--context", args.context, "stop", "--time", "2", container_name], capture_output=True, timeout=10)
    raise SystemExit("M0 probe timed out; task container stopped")
evidence = root / ".local/m0/evidence"
evidence.mkdir(parents=True, exist_ok=True)
run_id = str(time.time_ns())
(evidence / (run_id + ".stdout.json")).write_text(result.stdout)
(evidence / (run_id + ".stderr.txt")).write_text(result.stderr)
metadata = {"imageId": image_id, "exitCode": result.returncode, "elapsedSeconds": round(time.monotonic() - started, 3), "workspace": args.workspace, "seccompProfile": args.seccomp_profile, "seccompSha256": profile_digest}
(evidence / (run_id + ".meta.json")).write_text(json.dumps(metadata, indent=2) + "\n")
print(result.stdout)
print(json.dumps(metadata))
if result.stderr:
    print("Probe stderr retained locally; see .local/m0/evidence")
raise SystemExit(result.returncode)
