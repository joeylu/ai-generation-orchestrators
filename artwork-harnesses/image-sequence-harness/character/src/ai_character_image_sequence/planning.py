"""Deterministic action plan: no network, model selection or media generation."""
from __future__ import annotations

from importlib.resources import files
from pathlib import Path
import json

from jsonschema import Draft202012Validator
from PIL import Image, ImageOps

from . import reference as preparation

from .storage import contained, digest, read, require, save, seal, sha, token, unseal, write_new_bytes

PRIVATE = ".character-image-sequence"


def workspace(root: Path) -> Path:
    require(root.is_dir(), "workspace_missing")
    private = contained(root, PRIVATE)
    private.mkdir(exist_ok=True)
    ignore = private / ".gitignore"
    if not ignore.exists():
        ignore.write_text("*\n", encoding="utf-8")
    return private


def validate_request(request: dict) -> None:
    schema = json.loads(files(__package__).joinpath("schemas/request.schema.json").read_text())
    require(not list(Draft202012Validator(schema).iter_errors(request)), "request_schema_invalid")
    require(bool(request["motion"].strip()) and all(p.strip() for p in request["phases"]),
            "empty_action_description")
    # GIF centiseconds cannot exactly encode arbitrary millisecond totals.
    require(not request.get("gif", True) or request["duration_ms"] % 10 == 0,
            "gif_duration_must_be_centiseconds")


def image_info(path: Path) -> dict:
    require(path.stat().st_size <= 32 * 1024 * 1024, "image_too_large")
    with Image.open(path) as im:
        require(im.format in {"PNG", "JPEG", "WEBP"}, "image_format_unsupported")
        require(getattr(im, "n_frames", 1) == 1, "animated_input_forbidden")
        require(im.width * im.height <= 4096 * 4096, "image_dimensions_too_large")
        im.load()
        oriented = ImageOps.exif_transpose(im)
        return {"width": oriented.width, "height": oriented.height,
                "mime": Image.MIME[im.format], "sha256": sha(path), "bytes": path.stat().st_size}


def compile_prompt(request: dict) -> str:
    phases = "\n".join(f"Poses {i*4+1}-{i*4+4}: {phase}" for i, phase in enumerate(request["phases"]))
    blueprint = request.get("pose_blueprint")
    frame_spec = ("\nExact frame responsibilities:\n" +
                  "\n".join(f"Frame {index}: {pose}" for index, pose in enumerate(blueprint, 1))
                  if blueprint else "")
    continuity = (
        "One complete seamless cycle sampled at phases 0/16 through 15/16. "
        "Do not repeat the first pose as pose 16."
        if request["loop"] else
        "One complete one-shot action. Pose 1 is the start; pose 16 includes the requested terminal pose."
    )
    prompt = (
        f"Use the supplied reference image to preserve the exact character identity, proportions, "
        f"costume, colors, markings, materials and art style. Create one square PNG containing "
        "exactly 16 consecutive animation frames of the SAME character in a strict 4-column by "
        "4-row equal-cell grid. These are animation frames, not sixteen character variations. "
        "Read left to right, then top to bottom. Output only the sprite board. No labels, grid "
        "lines, borders, extra panels, camera movement or perspective changes. "
        "Use one plain contrasting background suitable for whole-image foreground removal; "
        "do not add scenery, a visible floor, cast shadows, checkerboards or watermarks. Keep the "
        "camera angle, facing direction, character scale and framing identical in all cells. Choose "
        "one scale that safely accommodates the widest pose. Every cell must contain the complete "
        "character with clear, consistent padding; no body part or accessory may cross a cell "
        "boundary. Use an identical local ground baseline in every cell. For grounded poses, place "
        "the supporting foot contact point at the same local x/y coordinate within every cell; body "
        "motion happens above that anchor. Preserve intentional airborne motion when the requested "
        "action leaves the ground. Do not recenter each pose independently and do not vary the "
        "bottom margin between rows.\n"
        "Make every adjacent frame a meaningful incremental change; avoid pose clusters, duplicated "
        "holds and abrupt row-boundary jumps. Preserve believable weight transfer, opposing limb "
        "motion, anticipation, follow-through and recovery appropriate to the action.\n"
        f"Action: {request['motion']}\n{phases}{frame_spec}\n{continuity}"
    )
    require(len(prompt) <= 20000, "prompt_too_long")
    return prompt


def create_plan(root: Path, request_path: Path) -> dict:
    request = read(contained(root, request_path))
    validate_request(request)
    reference = contained(root, request["reference"])
    info = image_info(reference)
    require(info["bytes"] <= 16 * 1024 * 1024, "reference_exceeds_matte_16mib_limit")
    private = workspace(root)
    # Snapshot unchanged bytes; image orientation is handled by the service and preview.
    blob = contained(root, private / "inputs" / info["sha256"])
    blob.parent.mkdir(exist_ok=True)
    if not blob.exists():
        write_new_bytes(blob, reference.read_bytes())
    require(sha(blob) == info["sha256"], "reference_snapshot_corrupt")
    alignment_mode = request.get("alignment_mode", "none")
    alignment_padding = request.get("alignment_padding", 16 if alignment_mode != "none" else 0)
    require(alignment_mode != "none" or alignment_padding == 0,
            "alignment_padding_requires_alignment")
    body = {"schema": "character_image_plan_v2", "layout": [4, 4], "frame_count": 16,
            "strategy": "whole_board_cloud_matte_then_slice", "reference": info,
            "original_reference": info, "reference_preparation": None,
            "reference_needs_cloud_matte": request.get("reference_mode") == "cloud" or not preparation.has_exterior_transparency(blob),
            "motion": request["motion"], "phases": request["phases"], "loop": request["loop"],
            "duration_ms": request["duration_ms"], "board_size": request["board_size"],
            "frame_size": request["frame_size"], "gif": request.get("gif", True),
            "pose_blueprint": request.get("pose_blueprint"),
            "timing_weights": request.get("timing_weights", [1] * 16),
            "alignment": {"mode": alignment_mode,
                          "reference_frame": request.get("alignment_reference_frame", 1),
                          "alpha_threshold": 16, "padding": alignment_padding},
            "quality": "strict", "prompt": compile_prompt(request)}
    plan = seal(body)
    path = contained(root, private / "plans" / (plan["digest"] + ".json"))
    if path.exists():
        require(read(path) == plan, "plan_collision")
    else:
        save(path, plan)
    requested_handoff = request.get("reference_preparation_handoff")
    handoff_path = contained(root, requested_handoff) if requested_handoff else contained(
        root, run_dir(root, plan) / "reference-preparation-handoff.json")
    if requested_handoff:
        require(handoff_path.is_file(), "reference_preparation_handoff_missing")
    if handoff_path.exists():
        if requested_handoff:
            handoff, reviewed, prepared_draft = preparation.load_reusable_preparation(root, plan, handoff_path)
        else:
            handoff, reviewed = preparation.load_preparation(root, plan)
            prepared_draft = plan
        prepared_info = image_info(contained(root, handoff["foreground"]["path"]))
        final = seal({**body, "reference": prepared_info,
                      "reference_preparation": {"draft_plan_digest": prepared_draft["digest"],
                                                "handoff_sha256": handoff["handoff_sha256"],
                                                "review_digest": reviewed["digest"]}})
        final_path = contained(root, private / "plans" / (final["digest"] + ".json"))
        if final_path.exists():
            require(read(final_path) == final, "plan_collision")
        else:
            save(final_path, final)
        return final
    return plan


def load_plan(root: Path, plan_id: str) -> dict:
    plan = read(contained(root, Path(PRIVATE) / "plans" / (token(plan_id) + ".json")))
    unseal(plan)
    require(plan["digest"] == plan_id, "plan_id_mismatch")
    require(plan["layout"] == [4, 4] and plan["frame_count"] == 16, "unsupported_layout")
    reference = reference_path(root, plan)
    require(sha(reference) == plan["reference"]["sha256"], "reference_changed")
    require(plan.get("schema") == "character_image_plan_v2", "reference_preparation_replan_required")
    if plan["reference_preparation"]:
        binding = plan["reference_preparation"]
        draft = load_plan(root, binding["draft_plan_digest"])
        require(draft["reference_preparation"] is None, "reference_preparation_chain_invalid")
        handoff, review = preparation.load_preparation(root, draft)
        require(binding["handoff_sha256"] == handoff["handoff_sha256"]
                and binding["review_digest"] == review["digest"]
                and plan["reference"]["sha256"] == handoff["foreground"]["sha256"],
                "reference_preparation_binding_changed")
    return plan


def reference_path(root: Path, plan: dict) -> Path:
    return contained(root, Path(PRIVATE) / "inputs" / token(plan["reference"]["sha256"]))


def run_dir(root: Path, plan: dict) -> Path:
    return contained(root, Path(PRIVATE) / "runs" / token(plan["digest"]))
