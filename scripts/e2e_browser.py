#!/usr/bin/env python3
"""Repeatable headless-browser end-to-end check for the AgentMeld local client.

Spins up a disposable `agentmeld-server` on loopback with the deterministic
client-track seed, pairs a browser device, drives headless Firefox through
the milestone surface, and asserts it. Loud failure: non-zero exit plus a
per-assertion report.

Usage:
    python3 scripts/e2e_browser.py [--port 8473] [--keep] [-- headed]

Boundaries (same as scripts/check-local.sh): no containers, no paid models,
no real Codex, no user files. Everything runs against a mkdtemp state dir
that is removed afterwards unless --keep is given.
"""

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TARGET = REPO / "target" / "debug"
SERVER = TARGET / "agentmeld-server"
SEEDER = TARGET / "seed_client_track"
PWVENV = Path("/tmp/pwvenv")

# Playwright lives in the pinned venv; re-exec under it when needed so
# `python3 scripts/e2e_browser.py` just works. (Check the sync_api import,
# not the top-level package: a stray namespace package can shadow it.)
try:
    from playwright.sync_api import sync_playwright  # noqa: F401
except ImportError:
    venv_python = PWVENV / "bin" / "python"
    # NOTE: compare unresolved paths — /tmp/pwvenv/bin/python is a symlink
    # to the system python, so resolve() makes them look identical.
    if Path(sys.executable) != venv_python and venv_python.exists():
        os.execv(str(venv_python), [str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]])
    raise

APPROVE_RGB = "rgb(139, 92, 246)"  # --brand-500 / --accent


class Fail(Exception):
    pass


def log(msg):
    print(f"[e2e] {msg}", flush=True)


def cargo_env():
    env = dict(os.environ)
    cargo_bin = str(Path.home() / ".cargo" / "bin")
    env["PATH"] = cargo_bin + os.pathsep + env.get("PATH", "")
    return env


def pick_port(start=8473, tries=10):
    for port in range(start, start + tries):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise Fail("no free loopback port found")


def wait_http(port, timeout=20):
    url = f"http://127.0.0.1:{port}/"
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return
        except Exception:
            time.sleep(0.3)
    raise Fail(f"server did not serve / within {timeout}s")


def mint_pairing_token(state_dir, port):
    out = subprocess.run(
        [str(SERVER), "pair", "--dir", str(state_dir), "--port", str(port)],
        capture_output=True, text=True, timeout=30, env=cargo_env(),
    )
    m = re.search(r"token=([A-Za-z0-9_\-]+)", out.stdout)
    if out.returncode != 0 or not m:
        raise Fail(f"pair CLI failed: rc={out.returncode} out={out.stdout!r} err={out.stderr!r}")
    return m.group(1)


def redeem_pairing_token(port, token):
    body = json.dumps({"token": token, "device_name": "e2e-browser"}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/v1/pair", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.load(r)
    except Exception as e:
        raise Fail(f"pair redeem failed: {e}")
    session = data.get("token")
    if not session:
        raise Fail(f"pair redeem returned no session token: {data!r}")
    return session


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--keep", action="store_true", help="leave server + state dir running")
    ap.add_argument("--headed", action="store_true", help="show the browser (debugging)")
    args = ap.parse_args()

    for name, path in (("agentmeld-server", SERVER), ("seed_client_track", SEEDER)):
        if not path.exists():
            raise Fail(f"{name} not built at {path}; run cargo build first")

    pw_python = PWVENV / "bin" / "python"
    if not pw_python.exists():
        raise Fail(f"playwright venv missing at {PWVENV}")

    env = cargo_env()
    log("building server + seeder")
    subprocess.run(
        ["cargo", "build", "--locked", "-p", "agentmeld-server",
         "--bin", "agentmeld-server", "--bin", "seed_client_track"],
        cwd=REPO, env=env, check=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )

    state_dir = Path(tempfile.mkdtemp(prefix="agentmeld-e2e-"))
    port = args.port or pick_port()
    server = None
    results = []

    def check(name, cond, detail=""):
        results.append((name, bool(cond), detail))
        log(f"{'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail and not cond else ""))

    try:
        log(f"starting server on 127.0.0.1:{port}")
        server = subprocess.Popen(
            [str(SERVER), "serve", "--dir", str(state_dir),
             "--port", str(port), "--repo-root", str(REPO)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        )
        time.sleep(0.5)
        if server.poll() is not None:
            raise Fail(f"server exited immediately rc={server.returncode}")
        wait_http(port)

        # Seed AFTER boot: recover_approvals_on_startup deliberately revokes
        # any pending approval predating the boot (reason service_restart —
        # a restarted service never resumes a turn mid-approval). Seeding
        # post-boot keeps the demo approval pending, exactly as a live
        # worker proposing mid-turn would.
        log(f"seeding {state_dir}")
        subprocess.run([str(SEEDER), "--state-dir", str(state_dir)],
                       check=True, capture_output=True, env=env)

        token = mint_pairing_token(state_dir, port)
        session = redeem_pairing_token(port, token)
        base = f"http://127.0.0.1:{port}/#{session}"
        log("paired; driving browser")

        # sync_playwright is guaranteed importable here (re-exec guard above).

        console_errors, page_errors, external_reqs, tool_step_reqs = [], [], [], []
        try:
            with sync_playwright() as p:
                try:
                    browser = p.firefox.launch(headless=not args.headed)
                except Exception as e:
                    raise Fail(f"firefox launch failed (run playwright install firefox in {PWVENV}): {e}")
                page = browser.new_page(viewport={"width": 1440, "height": 900})
                page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
                page.on("pageerror", lambda e: page_errors.append(str(e)))

                def on_request(req):
                    url = req.url
                    host = urllib.request.urlparse(url).hostname or ""
                    if host not in ("127.0.0.1", "localhost"):
                        external_reqs.append(url)
                    if re.search(r"/api/v1/runs/[^/]+/tool_steps", url):
                        tool_step_reqs.append(url)

                page.on("request", on_request)

                # Polling helper: page.wait_for_function injects a polling
                # predicate that the page CSP (script-src 'self', no
                # unsafe-eval) blocks, so waits poll from Python instead via
                # text_content/locator, which do not eval.
                def wait_for(cond, timeout_s, desc):
                    end = time.time() + timeout_s
                    while time.time() < end:
                        try:
                            if cond():
                                return True
                        except Exception:
                            pass
                        time.sleep(0.3)
                    log(f"timeout waiting for: {desc}")
                    return False

                page.goto(base, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_selector("#streamStatus", timeout=20000)
                check("stream reaches Live",
                      wait_for(lambda: "Live" in (page.text_content("#streamStatus") or ""),
                               20, "stream Live"))

                # --- branding ---
                ff = page.evaluate("getComputedStyle(document.body).fontFamily")
                first_font = ff.split(",")[0].strip().strip("\"'")
                check("body font-family leads with Roboto", first_font == "Roboto", ff)
                page.wait_for_selector(".approvalBtn--approve", timeout=15000)
                bg = page.evaluate(
                    "getComputedStyle(document.querySelector('.approvalBtn--approve')).backgroundColor")
                check("Approve button is --brand-500", bg == APPROVE_RGB, bg)

                # --- approval decision ---
                # The prompt bar shows the most urgent pending approval; history
                # cards render without decide buttons, so "dismissed" means no
                # Approve button remains and the confirmation notice appears.
                approve_btns = page.locator(".approvalBtn--approve")
                n_before = approve_btns.count()
                check("a pending approval prompt is shown", n_before > 0, f"{n_before} approve buttons")
                if n_before:
                    approve_btns.first.click()
                    check("Approve dismisses the prompt",
                          wait_for(lambda: page.locator(".approvalBtn--approve").count() == 0,
                                   10, "approve buttons gone"))
                    notice = (page.text_content("#notice") or "")
                    check("approval confirmation notice", "Approved" in notice, notice.strip()[:80])

                # --- lease + stream ---
                lease = page.text_content("#leasePill") or ""
                check("lease pill reads Observing", "Observing" in lease, lease.strip())
                stream = page.text_content("#streamStatus") or ""
                check("stream status reads Live", "Live" in stream, stream.strip())

                # --- run-details dialog via hydration ---
                # Scope to the Q3 run's activity entry: the first .detailLink on
                # the page belongs to the other seeded conversation. Steps
                # arrive via an async hydration fetch, so wait for them.
                q3 = page.locator("article.activityEntry", has_text="Summarize the Q3 sales data")
                q3.locator("button.detailLink").first.click()
                page.wait_for_selector("#runDetails[open]", timeout=10000)
                wait_for(lambda: "read_file" in (page.text_content("#runDetails") or ""),
                         10, "steps hydrate into dialog")
                dlg = page.text_content("#runDetails") or ""
                check("dialog shows read_file Done",
                      "read_file" in dlg and "Done" in dlg)
                check("dialog shows run_query Running",
                      "run_query" in dlg and "Running" in dlg)
                page.keyboard.press("Escape")

                # --- reload: hydration backfill, not SSE replay ---
                tool_step_reqs.clear()
                page.reload(wait_until="domcontentloaded", timeout=30000)
                page.wait_for_selector("#streamStatus", timeout=20000)
                check("stream reaches Live after reload",
                      wait_for(lambda: "Live" in (page.text_content("#streamStatus") or ""),
                               20, "stream Live after reload"))
                page.locator("article.activityEntry", has_text="Summarize the Q3 sales data") \
                    .locator("button.detailLink").first.click()
                page.wait_for_selector("#runDetails[open]", timeout=10000)
                wait_for(lambda: "read_file" in (page.text_content("#runDetails") or ""),
                         10, "steps hydrate into dialog after reload")
                dlg2 = page.text_content("#runDetails") or ""
                check("after reload dialog still shows both steps",
                      "read_file" in dlg2 and "run_query" in dlg2)
                check("reload issued GET tool_steps (hydration)",
                      len(tool_step_reqs) > 0, f"{len(tool_step_reqs)} requests")

                # --- hygiene ---
                # Filter the harness's own noise: Playwright's evaluate() trips
                # the page CSP (script-src 'self', no unsafe-eval) and logs it
                # from a "debugger eval code" frame. The app ships no eval of
                # its own; that CSP is working as intended.
                def is_harness_noise(t):
                    return "debugger eval code" in t or "blocked by CSP" in t
                real_console_errors = [t for t in console_errors if not is_harness_noise(t)]
                real_page_errors = [t for t in page_errors if not is_harness_noise(t)]
                check("zero console errors", not real_console_errors, "; ".join(real_console_errors[:3]))
                check("zero page errors", not real_page_errors, "; ".join(real_page_errors[:3]))
                check("zero external requests", not external_reqs, "; ".join(external_reqs[:3]))

                browser.close()
        except Exception as e:
            # A crashed drive is a failed assertion, not a traceback: the
            # summary below still reports what passed before the crash.
            check("browser drive completed", False, f"{type(e).__name__}: {e}")
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
        if args.keep:
            log(f"--keep: server stopped, state dir retained at {state_dir}")
        else:
            shutil.rmtree(state_dir, ignore_errors=True)

    failed = [n for n, ok, _ in results if not ok]
    log(f"{len(results) - len(failed)}/{len(results)} assertions passed")
    if failed:
        log("FAILED: " + ", ".join(failed))
        return 1
    log("E2E green")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Fail as e:
        print(f"[e2e] FATAL {e}", flush=True)
        sys.exit(2)
    except KeyboardInterrupt:
        sys.exit(130)
