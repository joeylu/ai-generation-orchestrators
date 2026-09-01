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


ROOT = Path(__file__).parents[2]
PROJECT_SECTION_RE = re.compile(r"(?ms)^\[project\][ \t]*\r?$\n(?P<body>.*?)(?=^\[|\Z)")
PROJECT_VERSION_RE = re.compile(r'(?m)^version[ \t]*=[ \t]*"(?P<version>[^"\r\n]+)"[ \t]*(?:#.*)?$')
SKILL_NAME = "skills-2d-frame-animation-video"
SKILL_ROOT = Path("artwork-harnesses/video-sequence-harness/character")
SKILL_FILES = (
    "SKILL.md",
    "agents/openai.yaml",
    "references/video-runtime-adapter-protocol.md",
    "references/video-state-machine.md",
    "skill.json",
)
BACKGROUND_SKILL_NAME = "image-background-removal"
BACKGROUND_SKILL_ROOT = Path("artwork-harnesses/image-background-removal-harness")
BACKGROUND_SKILL_FILES = (
    "SKILL.md",
    "agents/openai.yaml",
    "skill.json",
)
SDIST_SUPPORT_FILES = (
    "MANIFEST.in", "README.md", "README.zh-CN.md", "AGENTS.md",
    ".github/CONTRIBUTING.md", ".github/SECURITY.md", "LICENSE", "pyproject.toml",
    ".github/release_tools/__init__.py", ".github/release_tools/build_release_metadata.py",
    "artwork-harnesses/README.md", "artwork-harnesses/AGENTS.md",
    *(f"{SKILL_ROOT.as_posix()}/{name}" for name in SKILL_FILES),
    *(f"{BACKGROUND_SKILL_ROOT.as_posix()}/{name}" for name in BACKGROUND_SKILL_FILES),
    "artwork-harnesses/image-background-removal-harness/README.md",
    "artwork-harnesses/image-background-removal-harness/AGENTS.md",
    "artwork-harnesses/image-generation-harness/README.md",
    "artwork-harnesses/image-sequence-harness/README.md",
    "artwork-harnesses/video-sequence-harness/README.md",
    "audio-harnesses/README.md", "game-ui-harnesses/README.md",
    "game-scene-harnesses/README.md",
    *(f"{SKILL_ROOT.as_posix()}/docs/{name}" for name in (
        "README.md", "installation.md", "agent-setup.md", "cli-and-agent-flow.md",
        "release-consumption.md", "architecture.md", "quality-policies.md",
    )),
    *(f"{SKILL_ROOT.as_posix()}/examples/{name}" for name in (
        "README.md", "job.example.json", "minimax-h3.config.example.json",
    )),
    *(f"{BACKGROUND_SKILL_ROOT.as_posix()}/docs/{name}" for name in (
        "reference-preparation.md", "reference-correction.md", "reference-acceptance.md",
        "reference-acceptance-v1.json",
    )),
    *(f"{BACKGROUND_SKILL_ROOT.as_posix()}/examples/{name}" for name in (
        "README.md", "segmentation.config.example.json", "segmentation-fusion.config.example.json",
    )),
    *(f"{BACKGROUND_SKILL_ROOT.as_posix()}/tests/{name}" for name in (
        "__init__.py", "reference_doubles.py", "test_dual_segmentation.py",
        "test_fusion_preparation.py", "test_preparation_boundaries.py",
        "test_reference_correction.py", "test_reference_discovery.py",
        "test_reference_fusion.py", "test_reference_input_view.py",
        "test_reference_material.py", "test_reference_matte.py",
        "test_reference_preparation.py", "test_reference_review.py",
        "test_reference_translucency.py", "test_segmentation.py",
    )),
    *(f"{BACKGROUND_SKILL_ROOT.as_posix()}/tests/fixtures/golden/{name}" for name in (
        "README.md", "reference-alpha-boundary-cases.json", "reference-fusion-cases.json",
        "reference-jpeg-input-view-cases.json", "reference-local-correction-cases.json",
        "reference-material-cases.json", "reference-matte-cases.json",
        "reference-translucency-cases.json",
    )),
    *(f"{SKILL_ROOT.as_posix()}/tests/{name}" for name in (
        "__init__.py", "reference_doubles.py", "test_core_contracts.py",
        "test_decoded_handoff.py", "test_golden_matte.py", "test_handoff_path_safety.py",
        "test_input_delivery_regressions.py", "test_media_tools.py", "test_onboarding.py",
        "test_process_delivery.py", "test_provider_attempts.py", "test_schemas.py",
        "test_subject_fit.py", "test_video_hole_integration.py",
    )),
    *(f"{SKILL_ROOT.as_posix()}/tests/fixtures/golden/{name}" for name in (
        "README.md", "input-delivery-cases.json", "matte-cases.json",
        "moving-hole-cases.json", "subject-fit-cases.json",
    )),
    ".github/repository-tests/test_public_boundary.py",
    ".github/repository-tests/test_quickstart.py",
    ".github/repository-tests/test_release_metadata.py",
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


def _build_skill_archive(dist: Path, *, name: str, root: Path, files: tuple[str, ...]) -> Path:
    """Bundle one thin Agent entrypoint, not media code or private configuration."""
    version = project_version()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[a-zA-Z0-9.+-]*)", version):
        raise ValueError("skill_archive_version_invalid")
    skill_root = ROOT / root
    members = {member: _release_text(skill_root / member) for member in files}
    metadata = json.loads(members["skill.json"])
    if metadata.get("name") != name or metadata.get("version") != version or metadata.get("entry") != "SKILL.md":
        raise ValueError("skill_archive_metadata_mismatch")
    members["LICENSE"] = _release_text(ROOT / "LICENSE")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        for member_name, content in sorted(members.items()):
            info = zipfile.ZipInfo(f"{name}/{member_name}", date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    destination = dist / f"{name}-{version}.zip"
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


def build_skill_archive(dist: Path) -> Path:
    """Compatibility entrypoint for the implemented character-video Skill."""
    return _build_skill_archive(dist, name=SKILL_NAME, root=SKILL_ROOT, files=SKILL_FILES)


def build_background_skill_archive(dist: Path) -> Path:
    return _build_skill_archive(
        dist,
        name=BACKGROUND_SKILL_NAME,
        root=BACKGROUND_SKILL_ROOT,
        files=BACKGROUND_SKILL_FILES,
    )


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
    skill_archives = {build_skill_archive(dist), build_background_skill_archive(dist)}
    artifacts = sorted(set(artifacts) | skill_archives)
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
        "creationInfo": {"creators": ["Tool: .github/release_tools/build_release_metadata.py"], "created": "1970-01-01T00:00:00Z"},
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
