"""Provider-neutral character-motion intent validation.

An Agent may propose semantic decisions, but this module owns the exact public
contract, provenance labels, decidable conflicts, and canonical digest.
"""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Callable, Mapping

from .canonical import SHA256_RE, stamp_document, verify_document


INTENT_SCHEMA = "ai_frame_animation_character_motion_intent_v1"
INTENT_SOURCES = {"explicit_override", "explicit_natural_language", "automatic_policy"}
AMPLITUDES = {"subtle", "low", "medium", "high", "exaggerated", "custom"}
CONTINUITIES = {"seamless_loop", "loop_return", "continuous_cycle", "one_shot_settle", "terminal_hold"}
LOOP_CONTINUITIES = {"seamless_loop", "loop_return", "continuous_cycle"}
POSE_ROLES = {"start", "anticipation", "contact", "extreme", "recovery", "loop_return", "terminal"}
SUBJECT_TRANSLATIONS = {"stationary", "allowed", "required"}
SUBJECT_TURNS = {"locked", "allowed", "turnaround_required"}
CAMERA_MOTIONS = {"locked", "allowed", "required"}
ACTION_TYPE_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def _mapping(value: object, field: str, keys: set[str]) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != keys:
        raise ValueError(f"intent_{field}_invalid")
    return value


def _text(value: object, field: str, maximum: int = 2000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"intent_{field}_invalid")
    return value


def _strings(value: object, field: str, *, required: bool = False) -> list[str]:
    if not isinstance(value, list) or len(value) > 32 or (required and not value):
        raise ValueError(f"intent_{field}_invalid")
    result = [_text(item, field, 300) for item in value]
    normalized = [item.strip().casefold() for item in result]
    if len(set(normalized)) != len(normalized):
        raise ValueError(f"intent_{field}_invalid")
    return result


def _decision(value: object, field: str, validator: Callable[[object], Any]) -> Mapping[str, Any]:
    decision = _mapping(value, field, {"value", "source", "rationale"})
    if decision.get("source") not in INTENT_SOURCES:
        raise ValueError(f"intent_{field}_source_invalid")
    _text(decision.get("rationale"), f"{field}_rationale", 500)
    validator(decision.get("value"))
    return decision


def _choice(choices: set[str], field: str) -> Callable[[object], str]:
    def validate(value: object) -> str:
        if value not in choices:
            raise ValueError(f"intent_{field}_invalid")
        return str(value)
    return validate


def _poses(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list) or len(value) > 16:
        raise ValueError("intent_key_poses_invalid")
    for pose_value in value:
        pose = _mapping(pose_value, "key_poses", {"role", "description", "required"})
        if pose.get("role") not in POSE_ROLES or type(pose.get("required")) is not bool:
            raise ValueError("intent_key_poses_invalid")
        _text(pose.get("description"), "key_poses", 500)
    return value


def validate_character_motion_intent(value: object) -> dict[str, Any]:
    """Validate one complete, digest-bound intent and return a detached copy."""

    intent = _mapping(value, "document", {
        "schema_version", "raw_request", "reference", "subject_preserve", "action_type",
        "motion_goal", "motion_contract", "spatial_contract", "intent_sha256",
    })
    if intent.get("schema_version") != INTENT_SCHEMA:
        raise ValueError("intent_schema_version_unsupported")
    _text(intent.get("raw_request"), "raw_request")
    reference = _mapping(intent.get("reference"), "reference", {
        "source_sha256", "foreground_sha256", "preparation_sha256",
    })
    for field in ("source_sha256", "foreground_sha256"):
        if not isinstance(reference.get(field), str) or not SHA256_RE.fullmatch(reference[field]):
            raise ValueError("intent_reference_invalid")
    preparation_sha256 = reference.get("preparation_sha256")
    if preparation_sha256 is not None and (
        not isinstance(preparation_sha256, str) or not SHA256_RE.fullmatch(preparation_sha256)
    ):
        raise ValueError("intent_reference_invalid")

    _decision(intent.get("subject_preserve"), "subject_preserve", lambda item: _strings(item, "subject_preserve", required=True))
    _decision(intent.get("action_type"), "action_type", lambda item: _text(item, "action_type", 64))
    action_type = intent["action_type"]["value"]
    if not ACTION_TYPE_RE.fullmatch(action_type):
        raise ValueError("intent_action_type_invalid")
    _decision(intent.get("motion_goal"), "motion_goal", lambda item: _text(item, "motion_goal"))

    motion = _mapping(intent.get("motion_contract"), "motion_contract", {
        "must_move", "may_move", "must_lock", "amplitude", "continuity", "key_poses",
    })
    for field in ("must_move", "may_move", "must_lock"):
        _decision(motion.get(field), field, lambda item, name=field: _strings(item, name))
    _decision(motion.get("amplitude"), "amplitude", _choice(AMPLITUDES, "amplitude"))
    _decision(motion.get("continuity"), "continuity", _choice(CONTINUITIES, "continuity"))
    _decision(motion.get("key_poses"), "key_poses", _poses)

    spatial = _mapping(intent.get("spatial_contract"), "spatial_contract", {
        "subject_translation", "subject_turn", "camera_motion",
    })
    _decision(spatial.get("subject_translation"), "subject_translation", _choice(SUBJECT_TRANSLATIONS, "subject_translation"))
    _decision(spatial.get("subject_turn"), "subject_turn", _choice(SUBJECT_TURNS, "subject_turn"))
    _decision(spatial.get("camera_motion"), "camera_motion", _choice(CAMERA_MOTIONS, "camera_motion"))

    locked = {item.strip().casefold() for item in motion["must_lock"]["value"]}
    moving = [*motion["must_move"]["value"], *motion["may_move"]["value"]]
    if any(item.strip().casefold() in locked for item in moving):
        raise ValueError("intent_move_lock_conflict")
    looping = motion["continuity"]["value"] in LOOP_CONTINUITIES
    for pose in motion["key_poses"]["value"]:
        if pose["required"] and ((looping and pose["role"] == "terminal") or (not looping and pose["role"] == "loop_return")):
            raise ValueError("intent_continuity_pose_conflict")

    verify_document(intent, "intent_sha256")
    return deepcopy(dict(intent))


def build_character_motion_intent(
    draft_value: object,
    *,
    raw_request: str,
    reference: Mapping[str, Any],
) -> dict[str, Any]:
    """Bind untrusted Agent semantics to deterministic request/reference evidence."""

    draft = _mapping(draft_value, "draft", {
        "subject_preserve", "action_type", "motion_goal", "motion_contract", "spatial_contract",
    })
    document = stamp_document({
        "schema_version": INTENT_SCHEMA,
        "raw_request": raw_request,
        "reference": dict(reference),
        **deepcopy(dict(draft)),
    }, "intent_sha256")
    return validate_character_motion_intent(document)


def delivery_continuity(intent: Mapping[str, Any]) -> str:
    validated = validate_character_motion_intent(intent)
    return "loop" if validated["motion_contract"]["continuity"]["value"] in LOOP_CONTINUITIES else "one_shot"
