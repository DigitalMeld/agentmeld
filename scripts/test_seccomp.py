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
