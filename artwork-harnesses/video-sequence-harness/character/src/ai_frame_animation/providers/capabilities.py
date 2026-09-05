"""Optional, offline provider capability evidence bound inside the plan digest."""
import json
from importlib import resources
from typing import Mapping, Any

import jsonschema


def validate_capabilities(value: Mapping[str, Any]) -> None:
    schema = json.loads(resources.files("ai_frame_animation").joinpath(
        "schemas/provider-capabilities.schema.json").read_text(encoding="utf-8"))
    try:
        jsonschema.validate(value, schema)
    except jsonschema.ValidationError as exc:
        raise ValueError("provider_capabilities_invalid") from exc


def validate_capabilities_for_plan(value: Mapping[str, Any], plan: Mapping[str, Any]) -> None:
    validate_capabilities(value)
    # Current public generation input is a single prepared reference. Describing
    # first/last support does not turn it into an implemented CLI input mode.
    if value["plugin"] != plan["provider"]["plugin"] or "reference" not in value["image_roles"]:
        raise ValueError("provider_input_not_supported")
    if "references" not in value["input_modes"] or "image/png" not in value["mime_types"]:
        raise ValueError("provider_input_not_supported")


def verify_runtime_capabilities(provider: object, plan: Mapping[str, Any]) -> None:
    expected = plan["provider"].get("capabilities")
    if expected is None:
        return  # Existing third-party plugins remain compatible.
    describe = getattr(provider, "capabilities", None)
    if not callable(describe):
        raise ValueError("provider_capabilities_changed")
    actual = describe()
    validate_capabilities_for_plan(actual, plan)
    if actual != expected:
        raise ValueError("provider_capabilities_changed")
