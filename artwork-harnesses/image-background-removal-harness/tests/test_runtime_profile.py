from __future__ import annotations

import unittest
from unittest.mock import patch

from ai_image_background_removal.runtime_profile import require_segmentation_runtime, segmentation_runtime_report


GOOD = {
    "numpy": "2.5.2", "scipy": "1.18.1", "onnxruntime": "1.29.0",
    "PyMatting": "1.1.15", "numba": "0.67.0", "llvmlite": "0.49.0",
}


class RuntimeProfileTests(unittest.TestCase):
    def versions(self, values):
        def version(name):
            value = values.get(name)
            if value is None:
                from importlib.metadata import PackageNotFoundError
                raise PackageNotFoundError(name)
            return value
        return patch("ai_image_background_removal.runtime_profile.importlib.metadata.version", side_effect=version)

    def test_verified_python314_profile_is_static(self):
        with patch("ai_image_background_removal.runtime_profile.sys.version_info", (3, 14)), self.versions(GOOD):
            report = require_segmentation_runtime()
        self.assertEqual(report["status"], "verified")
        self.assertEqual(report["inference"], "not_performed")

    def test_incompatible_python314_profile_fails_closed(self):
        bad = {**GOOD, "numba": "0.65.1", "llvmlite": "0.47.0"}
        with patch("ai_image_background_removal.runtime_profile.sys.version_info", (3, 14)), self.versions(bad):
            report = segmentation_runtime_report()
            with self.assertRaisesRegex(ValueError, "runtime_profile_mismatch"):
                require_segmentation_runtime()
        self.assertEqual(set(report["mismatched"]), {"numba", "llvmlite"})

    def test_missing_dependency_has_specific_failure(self):
        with patch("ai_image_background_removal.runtime_profile.sys.version_info", (3, 14)), self.versions({**GOOD, "numba": None}):
            with self.assertRaisesRegex(ValueError, "runtime_missing"):
                require_segmentation_runtime()

    def test_other_supported_python_uses_declared_dependency_ranges(self):
        with patch("ai_image_background_removal.runtime_profile.sys.version_info", (3, 10)), self.versions(GOOD):
            self.assertEqual(require_segmentation_runtime()["status"], "compatible_unverified_profile")


if __name__ == "__main__":
    unittest.main()
