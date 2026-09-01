from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import re
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
    "references/reference-preparation-handoff.md",
    "references/video-runtime-adapter-protocol.md",
    "references/video-state-machine.md",
    "skill.json",
)
BACKGROUND_SKILL_NAME = "image-background-removal"
BACKGROUND_SKILL_ROOT = Path("artwork-harnesses/image-background-removal-harness")
BACKGROUND_SKILL_FILES = ("SKILL.md", "agents/openai.yaml", "skill.json")

VIDEO_SDIST_SUPPORT_FILES = (
    "LICENSE", "MANIFEST.in", "README.md", "SKILL.md", "pyproject.toml", "skill.json",
    "agents/openai.yaml",
    "references/reference-preparation-handoff.md",
    "references/video-runtime-adapter-protocol.md", "references/video-state-machine.md",
    *(f"docs/{name}" for name in (
        "README.md", "installation.md", "agent-setup.md", "cli-and-agent-flow.md",
        "release-consumption.md", "architecture.md", "intent-and-compiler.md", "quality-policies.md",
    )),
    *(f"examples/{name}" for name in ("README.md", "job.example.json", "minimax-h3.config.example.json")),
    *(f"tests/{name}" for name in (
        "__init__.py", "test_core_contracts.py", "test_decoded_handoff.py",
        "test_golden_matte.py", "test_handoff_path_safety.py", "test_intent_compiler.py",
        "test_input_delivery_regressions.py", "test_media_tools.py", "test_onboarding.py",
        "test_process_delivery.py", "test_provider_attempts.py", "test_schemas.py",
        "test_reference_preparation_handoff.py", "test_subject_fit.py", "test_video_hole_integration.py",
    )),
    *(f"tests/fixtures/golden/{name}" for name in (
        "README.md", "input-delivery-cases.json", "matte-cases.json",
        "moving-hole-cases.json", "sequence-matte-cases.json", "subject-fit-cases.json",
    )),
)
BACKGROUND_SDIST_SUPPORT_FILES = (
    "AGENTS.md", "LICENSE", "MANIFEST.in", "README.md", "SKILL.md", "pyproject.toml", "skill.json",
    "agents/openai.yaml",
    *(f"docs/{name}" for name in (
        "reference-preparation.md", "reference-correction.md", "reference-acceptance.md",
        "reference-acceptance-v1.json",
    )),
    *(f"examples/{name}" for name in (
        "README.md", "segmentation.config.example.json", "segmentation-fusion.config.example.json",
    )),
    *(f"tests/{name}" for name in (
        "__init__.py", "reference_doubles.py", "test_dual_segmentation.py", "test_fusion_preparation.py",
        "test_handoff.py", "test_preparation_boundaries.py", "test_reference_correction.py",
        "test_reference_discovery.py", "test_reference_fusion.py", "test_reference_input_view.py",
        "test_reference_material.py", "test_reference_matte.py", "test_reference_preparation.py",
        "test_reference_review.py", "test_reference_translucency.py", "test_segmentation.py",
    )),
    *(f"tests/fixtures/golden/{name}" for name in (
        "README.md", "reference-alpha-boundary-cases.json", "reference-fusion-cases.json",
        "reference-jpeg-input-view-cases.json", "reference-local-correction-cases.json",
        "reference-material-cases.json", "reference-matte-cases.json",
        "reference-translucency-cases.json",
    )),
)
SDIST_SUPPORT_FILES = VIDEO_SDIST_SUPPORT_FILES


def project_version_from_text(value: str) -> str:
    section = PROJECT_SECTION_RE.search(value)
    if section is None:
        raise ValueError("project_section_missing")
    matches = list(PROJECT_VERSION_RE.finditer(section.group("body")))
    if len(matches) != 1:
        raise ValueError("project_version_missing_or_ambiguous")
    return matches[0].group("version")


def project_version(component: str = "video") -> str:
    roots = {"video": SKILL_ROOT, "background": BACKGROUND_SKILL_ROOT}
    if component not in roots:
        raise ValueError("release_component_invalid")
    return project_version_from_text((ROOT / roots[component] / "pyproject.toml").read_text(encoding="utf-8"))


def verify_tag(tag: str) -> str:
    expected = {
        f"v{project_version('video')}": "video",
        f"video-v{project_version('video')}": "video",
        f"background-v{project_version('background')}": "background",
    }
    if tag not in expected:
        raise SystemExit("tag_version_mismatch: expected one of " + ", ".join(sorted(expected)) + f", got {tag}")
    return expected[tag]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _release_text(path: Path) -> bytes:
    relative = path.relative_to(ROOT)
    for length in range(len(relative.parts) + 1):
        if ROOT.joinpath(*relative.parts[:length]).is_symlink():
            raise ValueError("skill_archive_symlink_forbidden")
    if not path.is_file() or path.resolve(strict=True) != ROOT.resolve(strict=True) / relative:
        raise ValueError("skill_archive_member_missing_or_unsafe")
    return path.read_text(encoding="utf-8").encode("utf-8")


def _build_skill_archive(dist: Path, *, name: str, root: Path, files: tuple[str, ...], version: str) -> Path:
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[a-zA-Z0-9.+-]*)", version):
        raise ValueError("skill_archive_version_invalid")
    skill_root = ROOT / root
    members = {member: _release_text(skill_root / member) for member in files}
    metadata = json.loads(members["skill.json"])
    if metadata.get("name") != name or metadata.get("version") != version or metadata.get("entry") != "SKILL.md":
        raise ValueError("skill_archive_metadata_mismatch")
    members["LICENSE"] = _release_text(skill_root / "LICENSE")
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
    return _build_skill_archive(
        dist, name=SKILL_NAME, root=SKILL_ROOT, files=SKILL_FILES, version=project_version("video")
    )


def build_background_skill_archive(dist: Path) -> Path:
    return _build_skill_archive(
        dist, name=BACKGROUND_SKILL_NAME, root=BACKGROUND_SKILL_ROOT,
        files=BACKGROUND_SKILL_FILES, version=project_version("background")
    )


def validate_source_archive(path: Path, component: str = "video") -> None:
    settings = {
        "video": (f"ai_frame_animation-{project_version('video')}", VIDEO_SDIST_SUPPORT_FILES),
        "background": (f"ai_image_background_removal-{project_version('background')}", BACKGROUND_SDIST_SUPPORT_FILES),
    }
    if component not in settings:
        raise ValueError("release_component_invalid")
    prefix, required = settings[component]
    files: set[str] = set()
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            parts = PurePosixPath(member.name).parts
            if (
                "\\" in member.name or not parts or parts[0] != prefix or ".." in parts
                or not (member.isfile() or member.isdir()) or (member.isfile() and len(parts) < 2)
            ):
                raise ValueError("source_distribution_member_unsafe")
            if member.isfile():
                relative = PurePosixPath(*parts[1:]).as_posix()
                if relative in files:
                    raise ValueError("source_distribution_member_duplicate")
                files.add(relative)
    missing = sorted(set(required) - files)
    if missing:
        raise ValueError("source_distribution_support_files_missing:" + ",".join(missing))


def build_metadata(dist: Path, component: str = "all") -> None:
    if component not in {"video", "background", "all"}:
        raise ValueError("release_component_invalid")
    artifacts = sorted(
        path for path in dist.iterdir()
        if path.is_file() and path.name not in {"SHA256SUMS.txt", "sbom.spdx.json"}
    )
    if not artifacts:
        raise SystemExit("release_artifacts_missing")
    selected = ("video", "background") if component == "all" else (component,)
    source_names = {
        "video": f"ai_frame_animation-{project_version('video')}.tar.gz",
        "background": f"ai_image_background_removal-{project_version('background')}.tar.gz",
    }
    for item in selected:
        source = dist / source_names[item]
        if source.exists():
            validate_source_archive(source, item)
    skills = []
    if "video" in selected:
        skills.append(build_skill_archive(dist))
    if "background" in selected:
        skills.append(build_background_skill_archive(dist))
    artifacts = sorted(set(artifacts) | set(skills))
    (dist / "SHA256SUMS.txt").write_text(
        "\n".join(f"{sha256(path)}  {path.name}" for path in artifacts) + "\n", encoding="ascii"
    )
    packages = []
    for item, name in (("video", "ai-frame-animation"), ("background", "ai-image-background-removal")):
        if item in selected:
            packages.append({
                "SPDXID": f"SPDXRef-Package-{name}", "name": name,
                "versionInfo": project_version(item), "downloadLocation": "NOASSERTION", "filesAnalyzed": False,
            })
    dependencies = ["Pillow", "numpy"]
    if "video" in selected:
        dependencies.append("jsonschema")
    for name in dependencies:
        try:
            version = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            version = "not-installed-in-build-environment"
        packages.append({
            "SPDXID": f"SPDXRef-Package-{name.lower()}", "name": name,
            "versionInfo": version, "downloadLocation": "NOASSERTION", "filesAnalyzed": False,
        })
    sbom = {
        "spdxVersion": "SPDX-2.3", "dataLicense": "CC0-1.0", "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"ai-generation-orchestrators-{component}",
        "documentNamespace": f"https://example.invalid/ai-generation-orchestrators/{component}/sbom",
        "creationInfo": {"creators": ["Tool: .github/release_tools/build_release_metadata.py"], "created": "1970-01-01T00:00:00Z"},
        "packages": packages,
    }
    (dist / "sbom.spdx.json").write_text(json.dumps(sbom, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dist", type=Path)
    parser.add_argument("--verify-tag")
    parser.add_argument("--component", choices=("video", "background", "all"), default="all")
    args = parser.parse_args()
    if args.verify_tag:
        detected = verify_tag(args.verify_tag)
        if args.component != "all" and args.component != detected:
            raise SystemExit(f"tag_component_mismatch: expected {detected}, got {args.component}")
    if args.dist:
        build_metadata(args.dist, args.component)
    if not args.verify_tag and not args.dist:
        parser.error("one of --dist or --verify-tag is required")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
