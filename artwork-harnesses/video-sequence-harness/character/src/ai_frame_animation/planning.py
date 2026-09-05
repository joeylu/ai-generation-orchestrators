from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Mapping

from PIL import Image

from .canonical import SHA256_RE, canonical_sha256, fingerprint, relative_posix, rooted_path, stamp_document, verify_document
from .compiler import COMPILATION_SCHEMA, COMPILER_VERSION
from .media.key_analysis import CANDIDATE_KEYS, analyze_key_color
from .reference_preparation import load_reference_preparation


SUPPORTED_ATLAS_PROFILES = ("4x4", "8x4", "8x8")
LEGACY_FRAME_PROFILE = {16: "4x4", 32: "8x4", 64: "8x8"}
SUPPORTED_SIZES = (128, 256, 512)
SUPPORTED_CONTINUITY = ("loop", "one_shot")
SUPPORTED_QUALITY = ("strict", "best_effort")
PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
PROVIDER_BINDING_SCHEMA = "ai_frame_animation_provider_binding_v1"


def _validate_intent_compilation(value: object, request: str) -> dict[str, Any]:
    compilation = _mapping(value, "intent_compilation")
    _reject_unknown(compilation, {
        "schema_version", "compiler_version", "intent_sha256", "prompt_sha256",
        "reference", "checks", "compilation_sha256",
    }, "intent_compilation")
    if compilation.get("schema_version") != COMPILATION_SCHEMA or compilation.get("compiler_version") != COMPILER_VERSION:
        raise ValueError("intent_compilation_version_invalid")
    for field in ("intent_sha256", "prompt_sha256", "compilation_sha256"):
        if not isinstance(compilation.get(field), str) or not SHA256_RE.fullmatch(compilation[field]):
            raise ValueError("intent_compilation_digest_invalid")
    reference = _mapping(compilation.get("reference"), "intent_compilation.reference")
    _reject_unknown(reference, {"source_sha256", "foreground_sha256", "preparation_sha256"}, "intent_compilation.reference")
    for field in ("source_sha256", "foreground_sha256"):
        if not isinstance(reference.get(field), str) or not SHA256_RE.fullmatch(reference[field]):
            raise ValueError("intent_compilation_reference_invalid")
    preparation = reference.get("preparation_sha256")
    if preparation is not None and (not isinstance(preparation, str) or not SHA256_RE.fullmatch(preparation)):
        raise ValueError("intent_compilation_reference_invalid")
    checks = compilation.get("checks")
    if not isinstance(checks, list) or not checks or any(not isinstance(item, str) or not item for item in checks):
        raise ValueError("intent_compilation_checks_invalid")
    if compilation["prompt_sha256"] != canonical_sha256(request):
        raise ValueError("intent_compilation_prompt_mismatch")
    verify_document(compilation, "compilation_sha256")
    return dict(compilation)


def _mapping(value: object, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field}_must_be_object")
    return value


def _text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field}_must_be_nonempty_string")
    return value.strip()


def _reject_unknown(value: Mapping[str, Any], allowed: set[str], field: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise ValueError(f"{field}_unknown_fields:{','.join(unknown)}")


def validate_plan_contract(plan: Mapping[str, Any]) -> None:
    _reject_unknown(
        plan,
        {"schema_version", "job_id", "character", "motion", "delivery", "generation", "provider", "plan_sha256"},
        "plan",
    )
    schema_version = plan.get("schema_version")
    if schema_version not in {"ai_frame_animation_plan_v2", "ai_frame_animation_plan_v3"}:
        raise ValueError("plan_schema_version_unsupported")
    _text(plan.get("job_id"), "plan.job_id")
    character = _mapping(plan.get("character"), "plan.character")
    motion = _mapping(plan.get("motion"), "plan.motion")
    delivery = _mapping(plan.get("delivery"), "plan.delivery")
    generation = _mapping(plan.get("generation"), "plan.generation")
    provider = _mapping(plan.get("provider"), "plan.provider")
    _reject_unknown(character, {"reference", "reference_fingerprint", "description", "reference_preparation"}, "plan.character")
    if "reference_preparation" in character:
        preparation = _mapping(character["reference_preparation"], "plan.reference_preparation")
        _reject_unknown(preparation, {"path", "sha256"}, "plan.reference_preparation")
        _text(preparation.get("path"), "plan.reference_preparation.path")
        if not isinstance(preparation.get("sha256"), str) or not SHA256_RE.fullmatch(preparation["sha256"]):
            raise ValueError("plan_reference_preparation_digest_invalid")
    _reject_unknown(motion, {"request", "continuity"}, "plan.motion")
    _reject_unknown(delivery, {"atlas_profiles", "size", "quality", "gif", "key_color", "alpha_mode"}, "plan.delivery")
    if delivery.get("alpha_mode", "auto") not in {"auto", "native"}:
        raise ValueError("plan_alpha_mode_invalid")
    _reject_unknown(generation, {"prompt", "key_analysis", "intent_compilation"}, "plan.generation")
    _reject_unknown(provider, {"plugin", "binding", "capabilities"}, "plan.provider")
    if "capabilities" in provider:
        from .providers.capabilities import validate_capabilities_for_plan
        validate_capabilities_for_plan(provider["capabilities"], plan)
    _text(character.get("reference"), "plan.character.reference")
    if not isinstance(character.get("description"), str):
        raise ValueError("plan_character_description_invalid")
    reference_fingerprint = _mapping(character.get("reference_fingerprint"), "plan.reference_fingerprint")
    _reject_unknown(reference_fingerprint, {"bytes", "sha256", "media_type"}, "plan.reference_fingerprint")
    if (
        isinstance(reference_fingerprint.get("bytes"), bool)
        or not isinstance(reference_fingerprint.get("bytes"), int)
        or int(reference_fingerprint["bytes"]) < 0
        or not isinstance(reference_fingerprint.get("sha256"), str)
        or not SHA256_RE.fullmatch(str(reference_fingerprint["sha256"]))
        or reference_fingerprint.get("media_type") != "image"
    ):
        raise ValueError("plan_reference_fingerprint_invalid")
    _text(motion.get("request"), "plan.motion.request")
    if motion.get("continuity") not in SUPPORTED_CONTINUITY:
        raise ValueError("plan_motion_continuity_invalid")
    profiles = delivery.get("atlas_profiles")
    if (
        not isinstance(profiles, list)
        or not profiles
        or any(not isinstance(item, str) or item not in SUPPORTED_ATLAS_PROFILES for item in profiles)
        or profiles != sorted(set(profiles), key=SUPPORTED_ATLAS_PROFILES.index)
        or delivery.get("size") not in SUPPORTED_SIZES
        or delivery.get("quality") not in SUPPORTED_QUALITY
        or not isinstance(delivery.get("gif"), bool)
        or delivery.get("key_color") not in CANDIDATE_KEYS
    ):
        raise ValueError("plan_delivery_invalid")
    _text(generation.get("prompt"), "plan.generation.prompt")
    if "intent_compilation" in generation:
        compilation = _validate_intent_compilation(generation["intent_compilation"], motion["request"])
        if compilation["reference"]["foreground_sha256"] != character["reference_fingerprint"]["sha256"]:
            raise ValueError("intent_compilation_reference_mismatch")
        preparation = character.get("reference_preparation")
        expected_preparation = preparation.get("sha256") if isinstance(preparation, Mapping) else None
        if compilation["reference"]["preparation_sha256"] != expected_preparation:
            raise ValueError("intent_compilation_reference_mismatch")
    analysis = _mapping(generation.get("key_analysis"), "plan.generation.key_analysis")
    _reject_unknown(
        analysis,
        {
            "schema_version",
            "requested",
            "selected",
            "selected_safe",
            "safe_candidate_count",
            "reference_mode",
            "visible_pixel_count",
            "candidates",
            "warning_codes",
        },
        "plan.generation.key_analysis",
    )
    if (
        analysis.get("schema_version") != "video_key_color_analysis_v1"
        or analysis.get("selected") != delivery.get("key_color")
        or analysis.get("selected_safe") is not True
        or not isinstance(analysis.get("candidates"), list)
        or not isinstance(analysis.get("warning_codes"), list)
    ):
        raise ValueError("plan_key_analysis_invalid")
    plugin = _text(provider.get("plugin"), "plan.provider.plugin")
    if not PLUGIN_ID_RE.fullmatch(plugin):
        raise ValueError("plan_provider_plugin_invalid")
    binding_value = provider.get("binding")
    if schema_version == "ai_frame_animation_plan_v2":
        if binding_value is not None:
            raise ValueError("plan_v2_provider_binding_forbidden")
    else:
        binding = _mapping(binding_value, "plan.provider.binding")
        _reject_unknown(
            binding,
            {"schema_version", "workflow_sha256", "bindings_sha256", "canvas"},
            "plan.provider.binding",
        )
        canvas = _mapping(binding.get("canvas"), "plan.provider.binding.canvas")
        _reject_unknown(canvas, {"width", "height"}, "plan.provider.binding.canvas")
        width, height = canvas.get("width"), canvas.get("height")
        if (
            binding.get("schema_version") != PROVIDER_BINDING_SCHEMA
            or not isinstance(binding.get("workflow_sha256"), str)
            or not SHA256_RE.fullmatch(str(binding["workflow_sha256"]))
            or not isinstance(binding.get("bindings_sha256"), str)
            or not SHA256_RE.fullmatch(str(binding["bindings_sha256"]))
            or isinstance(width, bool)
            or not isinstance(width, int)
            or isinstance(height, bool)
            or not isinstance(height, int)
            or width < 32
            or height < 32
            or width % 32
            or height % 32
            or width != height
        ):
            raise ValueError("plan_provider_binding_invalid")
    if not isinstance(plan.get("plan_sha256"), str) or not SHA256_RE.fullmatch(str(plan["plan_sha256"])):
        raise ValueError("plan_digest_invalid")


def compile_plan(
    job: Mapping[str, Any],
    root: Path,
    *,
    prepared_reference: str | Path | None = None,
    provider_binding: Mapping[str, Any] | None = None,
    provider_capabilities: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    allowed = {"schema_version", "job_id", "character", "motion", "delivery", "provider", "intent_compilation"}
    unknown = sorted(set(job) - allowed)
    if unknown:
        raise ValueError(f"job_unknown_fields:{','.join(unknown)}")
    if job.get("schema_version") not in {"1.0", "1.1"}:
        raise ValueError("job_schema_version_unsupported")

    character = _mapping(job.get("character"), "character")
    motion = _mapping(job.get("motion"), "motion")
    delivery = _mapping(job.get("delivery"), "delivery")
    provider = _mapping(job.get("provider"), "provider")
    _reject_unknown(character, {"reference", "description"}, "character")
    _reject_unknown(motion, {"request", "continuity"}, "motion")
    _reject_unknown(delivery, {"atlas_profiles", "frame_counts", "size", "quality", "gif", "key_color", "alpha_mode"}, "delivery")
    _reject_unknown(provider, {"plugin"}, "provider")
    reference = rooted_path(root, _text(character.get("reference"), "character.reference"), must_exist=True)
    if reference.is_symlink() or not reference.is_file():
        raise ValueError("character_reference_invalid")
    preparation_binding = None
    if prepared_reference is not None:
        report = load_reference_preparation(root, prepared_reference)
        source_fingerprint = fingerprint(reference, media_type="image")
        if {key: report["source"][key] for key in source_fingerprint} != source_fingerprint:
            raise ValueError("reference_preparation_source_mismatch")
        reference = rooted_path(root, report["foreground"]["path"], must_exist=True)
        preparation_binding = {"path": relative_posix(root, rooted_path(root, prepared_reference, must_exist=True)),
                               "sha256": report["binding_sha256"]}

    continuity = _text(motion.get("continuity"), "motion.continuity")
    if continuity not in SUPPORTED_CONTINUITY:
        raise ValueError("motion_continuity_invalid")
    request = _text(motion.get("request"), "motion.request")
    intent_compilation = None
    if "intent_compilation" in job:
        intent_compilation = _validate_intent_compilation(job["intent_compilation"], request)

    raw_profiles = delivery.get("atlas_profiles")
    raw_counts = delivery.get("frame_counts")
    if job.get("schema_version") == "1.1" and raw_counts is not None:
        raise ValueError("delivery_frame_counts_legacy_only")
    if job.get("schema_version") == "1.0" and raw_profiles is not None:
        raise ValueError("delivery_atlas_profiles_require_job_1_1")
    if raw_profiles is not None and raw_counts is not None:
        raise ValueError("delivery_atlas_profiles_conflict")
    if raw_profiles is not None:
        if (
            not isinstance(raw_profiles, list)
            or not raw_profiles
            or any(not isinstance(item, str) or item not in SUPPORTED_ATLAS_PROFILES for item in raw_profiles)
        ):
            raise ValueError("delivery_atlas_profiles_invalid")
        atlas_profiles = sorted(set(raw_profiles), key=SUPPORTED_ATLAS_PROFILES.index)
    elif raw_counts is not None:
        if (
            not isinstance(raw_counts, list)
            or not raw_counts
            or any(isinstance(item, bool) or not isinstance(item, int) or item not in LEGACY_FRAME_PROFILE for item in raw_counts)
        ):
            raise ValueError("delivery_frame_counts_invalid")
        atlas_profiles = sorted({LEGACY_FRAME_PROFILE[item] for item in raw_counts}, key=SUPPORTED_ATLAS_PROFILES.index)
    else:
        raise ValueError("delivery_atlas_profiles_invalid")
    size = delivery.get("size")
    if size not in SUPPORTED_SIZES:
        raise ValueError("delivery_size_invalid")
    quality = delivery.get("quality", "strict")
    if quality not in SUPPORTED_QUALITY:
        raise ValueError("delivery_quality_invalid")
    gif = delivery.get("gif", True)
    if not isinstance(gif, bool):
        raise ValueError("delivery_gif_invalid")
    requested_key = delivery.get("key_color", "auto")
    if not isinstance(requested_key, str):
        raise ValueError("delivery_key_color_invalid")
    with Image.open(reference) as source:
        key_analysis = analyze_key_color(source, requested=requested_key, max_pixels=262_144)
    if not key_analysis["selected_safe"] or not key_analysis["selected"]:
        raise ValueError("no_safe_key_color_for_reference")
    key_color = str(key_analysis["selected"])
    raw_description = character.get("description", "")
    if not isinstance(raw_description, str):
        raise ValueError("character_description_invalid")
    description = raw_description.strip()
    plugin = _text(provider.get("plugin"), "provider.plugin")
    if not PLUGIN_ID_RE.fullmatch(plugin):
        raise ValueError("provider_plugin_invalid")
    generation_prompt = " ".join(
        item
        for item in (
            description,
            request,
            f"Stable camera. Full character silhouette visible. Solid flat {key_color} background with no shadows, gradients, text, border, or extra objects.",
        )
        if item
    )

    plan = {
        "schema_version": "ai_frame_animation_plan_v3" if provider_binding is not None else "ai_frame_animation_plan_v2",
        "job_id": _text(job.get("job_id"), "job_id"),
        "character": {
            "reference": relative_posix(root, reference),
            "reference_fingerprint": fingerprint(reference, media_type="image"),
            "description": description,
        },
        "motion": {
            "request": request,
            "continuity": continuity,
        },
        "delivery": {
            "atlas_profiles": atlas_profiles,
            "size": size,
            "quality": quality,
            "gif": gif,
            "key_color": key_color,
        },
        "generation": {"prompt": generation_prompt, "key_analysis": key_analysis},
        "provider": {"plugin": plugin},
    }
    if provider_binding is not None:
        plan["provider"]["binding"] = dict(provider_binding)
    if provider_capabilities is not None:
        from copy import deepcopy
        plan["provider"]["capabilities"] = deepcopy(dict(provider_capabilities))
    if "alpha_mode" in delivery:
        plan["delivery"]["alpha_mode"] = delivery["alpha_mode"]
    if preparation_binding is not None:
        plan["character"]["reference_preparation"] = preparation_binding
    if intent_compilation is not None:
        if intent_compilation["reference"]["foreground_sha256"] != plan["character"]["reference_fingerprint"]["sha256"]:
            raise ValueError("intent_compilation_reference_mismatch")
        expected_preparation = preparation_binding["sha256"] if preparation_binding is not None else None
        if intent_compilation["reference"]["preparation_sha256"] != expected_preparation:
            raise ValueError("intent_compilation_reference_mismatch")
        plan["generation"]["intent_compilation"] = intent_compilation
    stamped = stamp_document(plan, "plan_sha256")
    validate_plan_contract(stamped)
    return stamped
