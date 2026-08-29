from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_release_metadata import build_metadata, project_version, project_version_from_text, verify_tag


ROOT = Path(__file__).parents[1]


class ReleaseMetadataTests(unittest.TestCase):
    def test_versions_agree(self) -> None:
        skill = json.loads((ROOT / "skills" / "artwork" / "skills-2d-frame-animation-video" / "skill.json").read_text(encoding="utf-8"))
        self.assertEqual(project_version(), skill["version"])
        verify_tag(f"v{project_version()}")

    def test_version_parser_is_scoped_to_project_section(self) -> None:
        value = """[build-system]
requires = [\"setuptools>=77\"]

[project]
name = \"example\"
version = \"1.2.3\"

[tool.example]
version = \"9.9.9\"
"""
        self.assertEqual(project_version_from_text(value), "1.2.3")

    def test_release_metadata_has_checksums_and_sbom(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dist = Path(temporary)
            (dist / "package.whl").write_bytes(b"wheel")
            build_metadata(dist)
            self.assertIn("package.whl", (dist / "SHA256SUMS.txt").read_text(encoding="ascii"))
            sbom = json.loads((dist / "sbom.spdx.json").read_text(encoding="utf-8"))
            self.assertEqual(sbom["spdxVersion"], "SPDX-2.3")


if __name__ == "__main__":
    unittest.main()
