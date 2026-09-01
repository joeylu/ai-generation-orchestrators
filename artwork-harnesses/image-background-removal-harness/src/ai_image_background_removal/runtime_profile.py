"""Static compatibility gate for the optional CPU segmentation runtime."""

from __future__ import annotations

import importlib.metadata
import platform
import sys
from typing import Mapping


_REQUIRED = ("numpy", "scipy", "onnxruntime", "PyMatting", "numba", "llvmlite")

# This is the Python 3.14 tuple exercised by the real CPU acceptance run.  Keep
# it narrow: merely importable combinations have produced a >40 minute first
# PyMatting call while this tuple completes the same stage in about one second
# after runtime initialization.  Other Python versions retain the package's
# declared dependency ranges until an equivalent real-runtime profile exists.
_VERIFIED_PY314 = {
    "numpy": "2.5.2",
    "scipy": "1.18.1",
    "onnxruntime": "1.29.0",
    "PyMatting": "1.1.15",
    "numba": "0.67.0",
    "llvmlite": "0.49.0",
}


def segmentation_runtime_report() -> dict[str, object]:
    packages: dict[str, str] = {}
    for distribution in _REQUIRED:
        try:
            packages[distribution] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            packages[distribution] = "missing"
    expected: Mapping[str, str] | None = _VERIFIED_PY314 if sys.version_info[:2] == (3, 14) else None
    missing = [name for name, version in packages.items() if version == "missing"]
    mismatched = ({name: {"expected": version, "actual": packages[name]}
                   for name, version in expected.items() if packages[name] != version}
                  if expected is not None else {})
    if missing:
        status = "missing"
    elif expected is None:
        status = "compatible_unverified_profile"
    elif mismatched:
        status = "profile_mismatch"
    else:
        status = "verified"
    return {
        "status": status,
        "python": platform.python_version(),
        "profile": "cpu-segmentation-py314-r1" if expected is not None else "dependency-ranges-only",
        "packages": packages,
        "mismatched": mismatched,
        "inference": "not_performed",
    }


def require_segmentation_runtime() -> dict[str, object]:
    report = segmentation_runtime_report()
    if report["status"] == "missing":
        raise ValueError("reference_segmentation_runtime_missing")
    if report["status"] == "profile_mismatch":
        raise ValueError("reference_segmentation_runtime_profile_mismatch")
    return report
