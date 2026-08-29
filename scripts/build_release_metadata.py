from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).parents[1]
PROJECT_SECTION_RE = re.compile(r"(?ms)^\[project\][ \t]*\r?$\n(?P<body>.*?)(?=^\[|\Z)")
PROJECT_VERSION_RE = re.compile(r'(?m)^version[ \t]*=[ \t]*"(?P<version>[^"\r\n]+)"[ \t]*(?:#.*)?$')


def project_version_from_text(value: str) -> str:
    section = PROJECT_SECTION_RE.search(value)
    if section is None:
        raise ValueError("project_section_missing")
    matches = list(PROJECT_VERSION_RE.finditer(section.group("body")))
    if len(matches) != 1:
        raise ValueError("project_version_missing_or_ambiguous")
    return matches[0].group("version")


def project_version() -> str:
    return project_version_from_text((ROOT / "pyproject.toml").read_text(encoding="utf-8"))


def verify_tag(tag: str) -> None:
    expected = f"v{project_version()}"
    if tag != expected:
        raise SystemExit(f"tag_version_mismatch: expected {expected}, got {tag}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_metadata(dist: Path) -> None:
    artifacts = sorted(path for path in dist.iterdir() if path.is_file() and path.name not in {"SHA256SUMS.txt", "sbom.spdx.json"})
    if not artifacts:
        raise SystemExit("release_artifacts_missing")
    sums = [f"{sha256(path)}  {path.name}" for path in artifacts]
    (dist / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="ascii")
    packages = [
        {
            "SPDXID": "SPDXRef-Package-ai-frame-animation",
            "name": "ai-frame-animation",
            "versionInfo": project_version(),
            "downloadLocation": "NOASSERTION",
            "filesAnalyzed": False,
        }
    ]
    for name in ("Pillow", "jsonschema", "numpy"):
        try:
            version = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            version = "not-installed-in-build-environment"
        packages.append(
            {
                "SPDXID": f"SPDXRef-Package-{name.lower()}",
                "name": name,
                "versionInfo": version,
                "downloadLocation": "NOASSERTION",
                "filesAnalyzed": False,
            }
        )
    sbom = {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"ai-frame-animation-{project_version()}",
        "documentNamespace": f"https://example.invalid/ai-frame-animation/{project_version()}/sbom",
        "creationInfo": {"creators": ["Tool: scripts/build_release_metadata.py"], "created": "1970-01-01T00:00:00Z"},
        "packages": packages,
    }
    (dist / "sbom.spdx.json").write_text(json.dumps(sbom, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dist", type=Path)
    parser.add_argument("--verify-tag")
    args = parser.parse_args()
    if args.verify_tag:
        verify_tag(args.verify_tag)
    if args.dist:
        build_metadata(args.dist)
    if not args.verify_tag and not args.dist:
        parser.error("one of --dist or --verify-tag is required")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
