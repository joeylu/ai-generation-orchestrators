from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import re
import sys
import tarfile
import zipfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).parents[1]
PROJECT_SECTION_RE = re.compile(r"(?ms)^\[project\][ \t]*\r?$\n(?P<body>.*?)(?=^\[|\Z)")
PROJECT_VERSION_RE = re.compile(r'(?m)^version[ \t]*=[ \t]*"(?P<version>[^"\r\n]+)"[ \t]*(?:#.*)?$')
SKILL_NAME = "skills-2d-frame-animation-video"
SKILL_FILES = (
    "SKILL.md",
    "agents/openai.yaml",
    "references/video-runtime-adapter-protocol.md",
    "references/video-state-machine.md",
    "skill.json",
)
SDIST_SUPPORT_FILES = (
    "examples/segmentation-fusion.config.example.json",
    "tests/fixtures/golden/reference-fusion-cases.json",
    "tests/fixtures/golden/reference-jpeg-input-view-cases.json", "tests/test_reference_input_view.py",
    "tests/test_dual_segmentation.py", "tests/test_reference_fusion.py", "tests/test_fusion_preparation.py",
    "MANIFEST.in", "README.md", "README.zh-CN.md", "AGENTS.md",
    "CONTRIBUTING.md", "SECURITY.md", "LICENSE", "pyproject.toml",
    "scripts/build_release_metadata.py",
    "docs/README.md", "docs/installation.md", "docs/agent-setup.md",
    "docs/cli-and-agent-flow.md", "docs/release-consumption.md",
    "docs/architecture.md", "docs/quality-policies.md",
    "examples/README.md", "examples/job.example.json", "examples/minimax-h3.config.example.json",
    "skills/README.md",
    *(f"skills/artwork/{SKILL_NAME}/{name}" for name in SKILL_FILES),
    "tests/__init__.py", "tests/test_quickstart.py", "tests/test_golden_matte.py",
    "tests/fixtures/golden/README.md", "tests/fixtures/golden/matte-cases.json",
    "tests/test_input_delivery_regressions.py", "tests/test_process_delivery.py",
    "tests/fixtures/golden/input-delivery-cases.json",
    "docs/reference-preparation.md", "examples/segmentation.config.example.json",
    "tests/test_reference_preparation.py",
    "tests/test_reference_matte.py", "tests/fixtures/golden/reference-matte-cases.json",
    "tests/test_video_hole_integration.py", "tests/fixtures/golden/moving-hole-cases.json",
    "tests/test_subject_fit.py", "tests/fixtures/golden/subject-fit-cases.json",
    "tests/test_reference_material.py", "tests/fixtures/golden/reference-material-cases.json",
    "tests/test_reference_review.py",
    "tests/test_reference_translucency.py", "tests/fixtures/golden/reference-translucency-cases.json",
    "tests/test_preparation_boundaries.py", "tests/fixtures/golden/reference-alpha-boundary-cases.json",
    "docs/reference-correction.md", "tests/test_reference_correction.py",
    "tests/fixtures/golden/reference-local-correction-cases.json",
    "docs/reference-acceptance.md", "docs/reference-acceptance-v1.json",
    "tests/test_reference_discovery.py",
)


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


def _release_text(path: Path) -> bytes:
    # Explicit members only. Never follow a linked file/directory into private
    # material, and normalize checkout line endings for reproducible archives.
    relative = path.relative_to(ROOT)
    for length in range(len(relative.parts) + 1):
        candidate = ROOT.joinpath(*relative.parts[:length])
        if candidate.is_symlink():
            raise ValueError("skill_archive_symlink_forbidden")
    # Comparing the complete resolved member also rejects Windows junctions,
    # including links whose targets happen to remain inside the repository.
    if not path.is_file() or path.resolve(strict=True) != ROOT.resolve(strict=True) / relative:
        raise ValueError("skill_archive_member_missing_or_unsafe")
    return path.read_text(encoding="utf-8").encode("utf-8")


def build_skill_archive(dist: Path) -> Path:
    """Bundle the thin Agent entrypoint, not media code or private configuration."""
    version = project_version()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[a-zA-Z0-9.+-]*)", version):
        raise ValueError("skill_archive_version_invalid")
    skill_root = ROOT / "skills" / "artwork" / SKILL_NAME
    members = {name: _release_text(skill_root / name) for name in SKILL_FILES}
    metadata = json.loads(members["skill.json"])
    if metadata.get("name") != SKILL_NAME or metadata.get("version") != version or metadata.get("entry") != "SKILL.md":
        raise ValueError("skill_archive_metadata_mismatch")
    members["LICENSE"] = _release_text(ROOT / "LICENSE")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, content in sorted(members.items()):
            info = zipfile.ZipInfo(f"{SKILL_NAME}/{name}", date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    destination = dist / f"{SKILL_NAME}-{version}.zip"
    payload = buffer.getvalue()
    if destination.is_symlink():
        raise ValueError("skill_archive_symlink_forbidden")
    if destination.exists():
        if not destination.is_file() or destination.read_bytes() != payload:
            raise ValueError("skill_archive_refuses_overwrite")
        return destination
    with destination.open("xb") as handle:
        handle.write(payload)
    return destination


def validate_source_archive(path: Path) -> None:
    """Check support files in the actual sdist, not just in the source checkout."""
    prefix = f"ai_frame_animation-{project_version()}"
    files: set[str] = set()
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            parts = PurePosixPath(member.name).parts
            if (
                "\\" in member.name or not parts or parts[0] != prefix
                or ".." in parts or not (member.isfile() or member.isdir())
                or (member.isfile() and len(parts) < 2)
            ):
                raise ValueError("source_distribution_member_unsafe")
            if member.isfile():
                relative = PurePosixPath(*parts[1:]).as_posix()
                if relative in files:
                    raise ValueError("source_distribution_member_duplicate")
                files.add(relative)
    missing = sorted(set(SDIST_SUPPORT_FILES) - files)
    if missing:
        raise ValueError("source_distribution_support_files_missing:" + ",".join(missing))


def build_metadata(dist: Path) -> None:
    artifacts = sorted(path for path in dist.iterdir() if path.is_file() and path.name not in {"SHA256SUMS.txt", "sbom.spdx.json"})
    if not artifacts:
        raise SystemExit("release_artifacts_missing")
    source_archive = dist / f"ai_frame_animation-{project_version()}.tar.gz"
    if source_archive.exists():
        validate_source_archive(source_archive)
    skill_archive = build_skill_archive(dist)
    artifacts = sorted(set(artifacts) | {skill_archive})
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
