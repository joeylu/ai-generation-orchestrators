"""Cross-Harness compatibility; the assets-only entry itself has no Node dependency."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_assets_cli import run_fixture


class AssetsComponentBridgeTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Cross-Harness test requires consumer Node runtime")
    def test_actual_assets_zip_builds_through_official_consumer_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code, result, calls = run_fixture(root)
            self.assertEqual(code, 0, result)
            self.assertEqual(calls, 2)
            archive = root / "job" / result["artifacts"]["png_zip"]["path"]
            # Only transfer the ZIP. No delivery/run directory is needed downstream.
            isolated = root / "consumer"
            isolated.mkdir()
            copied = isolated / "assets.zip"
            shutil.copyfile(archive, copied)
            job = (root / "job").resolve()
            self.assertEqual(job.parent, root.resolve())
            shutil.rmtree(job)
            checked = subprocess.run([shutil.which("node"), str(Path(__file__).with_name("assets-component-bridge.mjs")),
                                      str(copied), str(isolated)], capture_output=True, text=True, timeout=60)
            self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)
            self.assertEqual(json.loads(checked.stdout)["boundComponents"], 2)


if __name__ == "__main__":
    unittest.main()
