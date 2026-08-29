from __future__ import annotations

import json
import re
from importlib import resources
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Sequence

import jsonschema

from . import __version__
from .canonical import redact, stamp_document, verify_document
from .media_tools import load_ffmpeg_lock
from .media.timeline import choose_uniform_indices


REQUIRED_SCHEMAS = (
    "job.schema.json",
    "plan.schema.json",
    "decoded-handoff.schema.json",
    "delivery-manifest.schema.json",
)
SUPPORTED_FRAME_COUNTS = (16, 32, 64)
SUPPORTED_SIZES = (128, 256, 512)
SAFE_JOB_ID_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def _safe_relative_path(value: str, field: str) -> str:
    windows_candidate = PureWindowsPath(value)
    candidate = PurePosixPath(value.replace("\\", "/"))
    if (
        windows_candidate.drive
        or windows_candidate.is_absolute()
        or candidate.is_absolute()
        or not candidate.parts
        or ".." in candidate.parts
    ):
        raise ValueError(f"{field}_must_be_safe_relative_path")
    lowered = tuple(part.lower() for part in candidate.parts)
    if lowered[0] in {".git", ".ai-frame-animation", "work"} or lowered in {(".gitignore",), ("job.json",)}:
        raise ValueError(f"{field}_must_be_safe_relative_path")
    return candidate.as_posix()


def _write_new_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(value)


def initialize_workspace(
    root: Path,
    *,
    motion: str,
    reference: str = "reference.png",
    description: str = "",
    job_id: str | None = None,
    continuity: str = "loop",
    frame_counts: Sequence[int] = SUPPORTED_FRAME_COUNTS,
    size: int = 256,
    quality: str = "strict",
    gif: bool = True,
    provider: str = "minimax_h3",
) -> dict[str, Any]:
    """Create a private-by-default starter workspace without overwriting files."""

    requested_root = Path(root)
    resolved_root = requested_root.resolve(strict=False)
    if requested_root.is_symlink():
        raise ValueError("init_root_must_be_missing_or_empty")
    if resolved_root.exists():
        if not resolved_root.is_dir() or any(resolved_root.iterdir()):
            raise ValueError("init_root_must_be_missing_or_empty")
    reference_value = _safe_relative_path(reference, "init_reference")
    motion_value = motion.strip()
    if not motion_value:
        raise ValueError("init_motion_must_be_nonempty")
    description_value = description.strip()
    if continuity not in {"loop", "one_shot"}:
        raise ValueError("init_continuity_invalid")
    normalized_counts = sorted(set(frame_counts))
    if not normalized_counts or any(value not in SUPPORTED_FRAME_COUNTS for value in normalized_counts):
        raise ValueError("init_frame_counts_invalid")
    if size not in SUPPORTED_SIZES:
        raise ValueError("init_size_invalid")
    if quality not in {"strict", "best_effort"}:
        raise ValueError("init_quality_invalid")
    if provider != "minimax_h3":
        raise ValueError("init_provider_not_supported")
    if not isinstance(gif, bool):
        raise ValueError("init_gif_invalid")

    default_job_id = SAFE_JOB_ID_RE.sub("-", resolved_root.name).strip("-.") or "character-animation"
    selected_job_id = (job_id or default_job_id).strip()
    if not selected_job_id:
        raise ValueError("init_job_id_must_be_nonempty")

    job = {
        "schema_version": "1.0",
        "job_id": selected_job_id,
        "character": {
            "reference": reference_value,
            "description": description_value,
        },
        "motion": {
            "request": motion_value,
            "continuity": continuity,
        },
        "delivery": {
            "frame_counts": normalized_counts,
            "size": size,
            "quality": quality,
            "gif": gif,
        },
        "provider": {"plugin": provider},
    }
    provider_config = {
        "base_url": "http://127.0.0.1:8188",
        "workflow_path": "workflow.json",
        "bindings": {
            "reference_image": {"node": "replace-reference-node-id", "input": "image"},
            "positive_prompt": {"node": "replace-prompt-node-id", "input": "text"},
        },
        "request_timeout_seconds": 30,
        "poll_interval_seconds": 2,
        "timeout_seconds": 1800,
    }
    ignore = "/.ai-frame-animation/\n/work/\n/" + reference_value + "\n"
    private_ignore = "*\n!.gitignore\n"
    files = {
        resolved_root / ".gitignore": ignore,
        resolved_root / "job.json": json.dumps(job, ensure_ascii=False, indent=2) + "\n",
        resolved_root / ".ai-frame-animation" / ".gitignore": private_ignore,
        resolved_root / ".ai-frame-animation" / "provider.minimax-h3.json": json.dumps(
            provider_config, ensure_ascii=False, indent=2
        )
        + "\n",
    }
    if any(path.exists() for path in files):
        raise ValueError("init_target_already_exists")

    resolved_root.mkdir(parents=True, exist_ok=True)
    created: list[Path] = []
    try:
        for path, value in files.items():
            _write_new_text(path, value)
            created.append(path)
    except Exception:
        for path in reversed(created):
            path.unlink(missing_ok=True)
        raise

    workspace_label = redact(str(requested_root))
    return {
        "schema_version": "ai_frame_animation_init_report_v1",
        "status": "initialized",
        "workspace": workspace_label,
        "created": [path.relative_to(resolved_root).as_posix() for path in created],
        "next_steps": [
            f"Copy the character reference to {reference_value}.",
            "Run tools check; on a supported platform, run tools install if FFmpeg is missing.",
            "Export the ComfyUI API workflow to .ai-frame-animation/workflow.json.",
            "Replace both binding node IDs in .ai-frame-animation/provider.minimax-h3.json.",
            "Run doctor with the provider configuration before requesting compute.",
            "Run plan, review its digest, and ask for one explicit compute confirmation.",
        ],
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
    }


def run_self_test() -> dict[str, Any]:
    """Verify installed contracts without media, network, provider, or GPU work."""

    schema_root = resources.files("ai_frame_animation").joinpath("schemas")
    checked_schemas: list[str] = []
    for name in REQUIRED_SCHEMAS:
        value = json.loads(schema_root.joinpath(name).read_text(encoding="utf-8"))
        jsonschema.Draft202012Validator.check_schema(value)
        checked_schemas.append(name)

    tool_lock = load_ffmpeg_lock()

    stamped = stamp_document({"schema_version": "self_test_v1", "value": 1}, "sha256")
    verify_document(stamped, "sha256")
    loop_indices = choose_uniform_indices(73, 64, continuity="loop")
    one_shot_indices = choose_uniform_indices(73, 64, continuity="one_shot")
    if 72 in loop_indices or one_shot_indices[-1] != 72:
        raise ValueError("self_test_timeline_contract_failed")

    return {
        "schema_version": "ai_frame_animation_self_test_v1",
        "status": "passed",
        "version": __version__,
        "checks": {
            "packaged_schemas": checked_schemas,
            "packaged_ffmpeg_platforms": sorted(tool_lock["platforms"]),
            "canonical_digest": "passed",
            "loop_terminal_sampling": "passed",
            "one_shot_terminal_sampling": "passed",
        },
        "media_generated": False,
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
    }
