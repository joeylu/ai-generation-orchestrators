from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from ai_frame_animation.handoff import _external_path


class HandoffPathSafetyTests(unittest.TestCase):
    def test_temp_directory_alias_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            artifact = Path(temporary) / "raw.mp4"
            artifact.write_bytes(b"fixture")
            self.assertEqual(_external_path(root, artifact, "fixture_alias_invalid"), artifact.resolve())

    def test_symlinked_artifact_is_rejected_even_when_target_stays_inside_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            target = root / "raw.mp4"
            target.write_bytes(b"fixture")
            link = root / "raw-link.mp4"
            try:
                link.symlink_to(target)
            except OSError:
                self.skipTest("symlink creation is unavailable")
            with self.assertRaisesRegex(ValueError, "fixture_symlink_invalid"):
                _external_path(root, link, "fixture_symlink_invalid")


if __name__ == "__main__":
    unittest.main()
