#!/usr/bin/env python3
"""Two-browser controller-lease contention check (issue #115).

Browser A takes the controller lease; browser B seizes it via takeover.
Asserts the generation bumps and browser A learns about the takeover over
the live SSE stream (pill flips to "Controlled by another device") with no
manual refresh.

Usage: PWVENV=/path/to/venv python3 scripts/e2e_lease_contention.py
"""
import os, subprocess, sys, tempfile, time, urllib.request, re
from pathlib import Path

REPO = Path("/home/hatch/workspace/repos/agentmeld")
TARGET = REPO / "target" / "debug"
SERVER = TARGET / "agentmeld-server"
SEEDER = TARGET / "seed_client_track"
# Playwright lives in a venv outside the repo (same arrangement as
# scripts/e2e_browser.py): PWVENV env var or the default workspace venv.
PWVENV = Path(os.environ.get("PWVENV", str(Path.home() / "workspace" / ".pwvenv")))
for p in PWVENV.glob("lib/python*/site-packages"):
    sys.path.insert(0, str(p))
from playwright.sync_api import sync_playwright

def cargo_env():
    env = dict(os.environ); env["PATH"] = str(Path.home() / ".cargo" / "bin") + ":" + env["PATH"]
    return env

def free_port():
    import socket
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    return port

def wait_http(port):
    for _ in range(100):
        try: urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1); return
        except Exception: time.sleep(0.2)
    raise RuntimeError("server did not come up")

def mint(state_dir, port):
    out = subprocess.run([str(SERVER), "pair", "--dir", str(state_dir), "--port", str(port)],
                         capture_output=True, text=True, env=cargo_env())
    m = re.search(r"token=([A-Za-z0-9_\-]+)", out.stdout)
    assert m, f"pair failed: {out.stdout!r} {out.stderr!r}"
    return m.group(1)

def main():
    env = cargo_env()
    state_dir = Path(tempfile.mkdtemp(prefix="lease-contention-"))
    port = free_port()
    server = subprocess.Popen([str(SERVER), "serve", "--dir", str(state_dir),
                               "--port", str(port), "--repo-root", str(REPO)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    try:
        wait_http(port)
        subprocess.run([str(SEEDER), "--state-dir", str(state_dir)], check=True,
                       capture_output=True, env=env)
        results = []
        def check(name, cond, detail=""):
            results.append(bool(cond))
            print(f"[lease] {'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail and not cond else ""), flush=True)

        with sync_playwright() as pw:
            browser = pw.firefox.launch(headless=True)
            ctx_a = browser.new_context()
            ctx_b = browser.new_context()
            page_a = ctx_a.new_page()
            page_b = ctx_b.new_page()

            # Pair A via UI
            page_a.goto(f"http://127.0.0.1:{port}/")
            page_a.wait_for_selector("#pairingToken", timeout=15000)
            page_a.fill("#pairingToken", mint(state_dir, port))
            page_a.fill("#pairingName", "Browser-A")
            page_a.click("#pairButton")
            page_a.wait_for_selector("#streamStatus", timeout=15000)

            # Pair B via UI
            page_b.goto(f"http://127.0.0.1:{port}/")
            page_b.wait_for_selector("#pairingToken", timeout=15000)
            page_b.fill("#pairingToken", mint(state_dir, port))
            page_b.fill("#pairingName", "Browser-B")
            page_b.click("#pairButton")
            page_b.wait_for_selector("#streamStatus", timeout=15000)
            check("both browsers paired", True)

            def wait_for(page, cond, timeout_s, desc):
                end = time.time() + timeout_s
                while time.time() < end:
                    try:
                        if cond(): return True
                    except Exception: pass
                    page.wait_for_timeout(300)
                print(f"[lease] timeout: {desc}", flush=True)
                return False

            # A takes control
            page_a.locator("#leaseControls .leaseBtn").first.click()
            wait_for(page_a, lambda: "Confirm take control" in (page_a.text_content("#leaseControls") or ""), 10, "a arm")
            page_a.locator("#leaseControls .leaseBtn").first.click()
            check("A holds the lease",
                  wait_for(page_a, lambda: "Controlling on this device" in (page_a.text_content("#leasePill") or ""), 10, "a holds"))
            gen_a = page_a.evaluate("() => fetch('/api/v1/lease',{headers:{'Authorization':'Bearer '+sessionStorage.getItem('agentmeld-token')}}).then(r=>r.json()).then(j=>j.generation)")

            # B seizes control (takeover)
            page_b.locator("#leaseControls .leaseBtn").first.click()
            wait_for(page_b, lambda: "Confirm take control" in (page_b.text_content("#leaseControls") or ""), 10, "b arm")
            page_b.locator("#leaseControls .leaseBtn").first.click()
            check("B seizes the lease",
                  wait_for(page_b, lambda: "Controlling on this device" in (page_b.text_content("#leasePill") or ""), 10, "b holds"))
            gen_b = page_b.evaluate("() => fetch('/api/v1/lease',{headers:{'Authorization':'Bearer '+sessionStorage.getItem('agentmeld-token')}}).then(r=>r.json()).then(j=>j.generation)")
            check("generation bumped on takeover", gen_b == gen_a + 1, f"{gen_a} -> {gen_b}")

            # A sees the loss via the stream (no manual refresh): the pill
            # flips from "Controlling on this device" to "Controlled by
            # another device" on the lease.takeover SSE event.
            check("A sees the takeover via the stream",
                  wait_for(page_a, lambda: "Controlled by another device" in (page_a.text_content("#leasePill") or ""), 15, "a sees takeover"),
                  (page_a.text_content("#leasePill") or "").strip()[:60])

            browser.close()
        ok = all(results)
        print(f"[lease] {'GREEN' if ok else 'RED'}: {sum(results)}/{len(results)}", flush=True)
        return 0 if ok else 1
    finally:
        server.terminate()
        try: server.wait(timeout=10)
        except Exception: server.kill()

if __name__ == "__main__":
    sys.exit(main())
