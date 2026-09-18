"""Offline integrity tests: no downloads, containers or local probe cache required."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("seccomp", Path(__file__).with_name("prepare-seccomp.py"))
seccomp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seccomp)


codex_spec = importlib.util.spec_from_file_location("codex_policy", Path(__file__).with_name("prepare-codex-policy.py"))
codex_policy = importlib.util.module_from_spec(codex_spec)
codex_spec.loader.exec_module(codex_policy)


class CodexPolicyTests(unittest.TestCase):
    def test_codex_seccomp_keeps_default_and_adds_only_mount_setup_calls(self):
        source = json.dumps({"defaultAction": "SCMP_ACT_ERRNO", "syscalls": []}).encode()
        with patch.object(codex_policy.browser_seccomp, "UPSTREAM_SHA256", hashlib.sha256(source).hexdigest()):
            result = json.loads(codex_policy.codex_seccomp(source))
            self.assertEqual(result["defaultAction"], "SCMP_ACT_ERRNO")
            self.assertEqual([r["names"] for r in result["syscalls"]], [["chroot"], ["mount", "umount2", "pivot_root"]])
        with self.assertRaisesRegex(ValueError, "checksum"):
            codex_policy.codex_seccomp(b"unverified")

    def test_apparmor_rejects_unverified_upstream(self):
        with self.assertRaisesRegex(ValueError, "checksum"):
            codex_policy.codex_apparmor(b"profile permissive {}")

    def test_apparmor_preserves_other_denials_and_scopes_mount_rules(self):
        source = b"const baseTemplate = `profile {{.Name}} {\n  deny mount,\n  deny /sys/firmware/** rwklx,\n}`"
        with patch.object(codex_policy, "APPARMOR_SHA256", hashlib.sha256(source).hexdigest()):
            result = codex_policy.codex_apparmor(source).decode()
            self.assertIn("deny /sys/firmware/** rwklx,", result)
            self.assertIn("profile agentmeld-m0-codex", result)
            self.assertNotIn("  mount,", result)
            self.assertNotIn("  pivot_root,", result)
            self.assertIn("pivot_root /newroot/", result)

    def test_codex_policy_readback_rejects_either_modified_output(self):
        source = json.dumps({"defaultAction": "SCMP_ACT_ERRNO", "syscalls": []}).encode()
        upstream = b"const baseTemplate = `profile {{.Name}} {\n  deny mount,\n}`"
        with tempfile.TemporaryDirectory() as tmp, patch.object(codex_policy.browser_seccomp, "UPSTREAM_SHA256", hashlib.sha256(source).hexdigest()), patch.object(codex_policy, "APPARMOR_SHA256", hashlib.sha256(upstream).hexdigest()):
            root = Path(tmp)
            directory = root / ".local/m0/seccomp"
            directory.mkdir(parents=True)
            (directory / "upstream.json").write_bytes(source)
            (directory / "apparmor-upstream.go").write_bytes(upstream)
            good_seccomp = codex_policy.codex_seccomp(source)
            good_apparmor = codex_policy.codex_apparmor(upstream)
            for selected in ["codex.json", codex_policy.PROFILE + ".apparmor"]:
                (directory / "codex.json").write_bytes(good_seccomp)
                (directory / (codex_policy.PROFILE + ".apparmor")).write_bytes(good_apparmor)
                codex_policy.verify_prepared(root)
                (directory / selected).write_text("changed")
                with self.assertRaisesRegex(ValueError, "changed"):
                    codex_policy.verify_prepared(root)


class IntegrityTests(unittest.TestCase):
    def test_unverified_source_never_becomes_a_policy(self):
        for data in [b"", b'{"defaultAction":"SCMP_ACT_ALLOW"}', b"modified upstream"]:
            with self.assertRaisesRegex(ValueError, "checksum"):
                seccomp.browser_policy(data)

    def test_prepared_policy_rejects_local_tampering(self):
        source = json.dumps({"defaultAction": "SCMP_ACT_ERRNO", "syscalls": []}).encode()
        with tempfile.TemporaryDirectory() as tmp, patch.object(seccomp, "UPSTREAM_SHA256", hashlib.sha256(source).hexdigest()):
            root = Path(tmp)
            directory = root / ".local/m0/seccomp"
            directory.mkdir(parents=True)
            (directory / "upstream.json").write_bytes(source)
            target = directory / "browser.json"
            target.write_bytes(seccomp.browser_policy(source))
            self.assertEqual(seccomp.verify_prepared(root), target)
            altered = json.loads(target.read_bytes())
            altered["defaultAction"] = "SCMP_ACT_ALLOW"
            target.write_text(json.dumps(altered))
            with self.assertRaisesRegex(ValueError, "changed"):
                seccomp.verify_prepared(root)


if __name__ == "__main__":
    unittest.main()
