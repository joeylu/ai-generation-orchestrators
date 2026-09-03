"""Immutable one-shot authorization for remote background-removal compute."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .canonical import SHA256_RE, fingerprint, relative_posix, rooted_path, stamp_document, write_json_atomic
from .fal_provider import DEFAULT_PROFILE_ID, INPUT_TRANSPORT, PROFILES
from .preparation import _file, _source_image_and_format


PLAN_SCHEMA = "ai_image_background_removal_provider_plan_v1"


def build_plan(*, root: Path, reference: str | Path, out_dir: str | Path,
               profile: str = DEFAULT_PROFILE_ID) -> dict[str, Any]:
    root = root.resolve(strict=True)
    source = _file(root, reference)
    image, _source_format = _source_image_and_format(source)
    out = rooted_path(root, out_dir)
    if out == root:
        raise ValueError("reference_preparation_path_unsafe")
    if profile not in PROFILES:
        raise ValueError("reference_provider_profile_invalid")
    return stamp_document({
        "schema_version": PLAN_SCHEMA,
        "operation": "background_removal",
        "source": {"path": relative_posix(root, source), **fingerprint(source, media_type="image")},
        "output_directory": relative_posix(root, out),
        "provider_profile": profile,
        "provider_input_transport": INPUT_TRANSPORT,
        "output_contract": "ai_reference_preparation_handoff_v1",
        "decoded_size": [image.width, image.height],
    }, "plan_sha256")


def authorize_once(*, root: Path, plan: dict[str, Any], confirmation: str) -> Path:
    digest = plan.get("plan_sha256")
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest) or confirmation != digest:
        raise ValueError("reference_provider_confirmation_mismatch")
    state = root / ".ai-image-background-removal" / "attempts" / f"{digest}.json"
    state.parent.mkdir(parents=True, exist_ok=True)
    try:
        with state.open("x", encoding="utf-8") as handle:
            import json
            json.dump({"plan_sha256": digest, "status": "submitting"}, handle, sort_keys=True)
            handle.write("\n")
    except FileExistsError as exc:
        raise ValueError("reference_provider_authorization_already_used") from exc
    return state


def mark_attempt(state: Path, *, status: str) -> None:
    if status not in {"succeeded", "indeterminate"}:
        raise ValueError("reference_provider_attempt_state_invalid")
    import json
    value = json.loads(state.read_text(encoding="utf-8"))
    if set(value) != {"plan_sha256", "status"} or value["status"] != "submitting":
        raise ValueError("reference_provider_attempt_state_invalid")
    write_json_atomic(state, {"plan_sha256": value["plan_sha256"], "status": status})
