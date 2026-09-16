"""Reviewed reference handoff compatible with the video Harness, without importing it."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

from . import __version__
from .storage import contained, digest, read, require, save, sha, unseal, write_new_bytes

CHECKS = ["identity", "complete_subject", "background_removed", "holes_and_soft_materials"]


def has_exterior_transparency(path: Path) -> bool:
    with Image.open(path) as image:
        if image.format not in {"PNG", "WEBP"} or getattr(image, "n_frames", 1) != 1:
            return False
        if "A" not in image.getbands() and "transparency" not in image.info:
            return False
        image = ImageOps.exif_transpose(image).convert("RGBA")
        alpha = image.getchannel("A")
        if alpha.getextrema()[1] <= 8:
            return False
        # Flood fill is a read-only alpha validation mask, never foreground extraction.
        padded = Image.new("L", (image.width + 2, image.height + 2))
        padded.paste(alpha.point(lambda a: 255 if a > 8 else 0), (1, 1))
        ImageDraw.floodfill(padded, (0, 0), 128)
        count = padded.histogram()[128] - (2 * image.width + 2 * image.height + 4)
        return count >= max(1, (image.width * image.height + 99) // 100)


def validate_foreground(path: Path, original: dict) -> Image.Image:
    with Image.open(path) as image:
        require(image.format == "PNG" and image.mode == "RGBA", "reference_canonical_png_required")
        require(image.size == (original["width"], original["height"]), "reference_dimensions_changed")
        require(image.getexif().get(274, 1) == 1, "reference_orientation_invalid")
        image.load()
        result = image.convert("RGBA")
    require(has_exterior_transparency(path), "reference_foreground_invalid")
    require(path.stat().st_size <= 2 * 1024 * 1024, "reference_exceeds_cloud_2mib_limit")
    return result


def fingerprint(root: Path, path: Path, media_type: str) -> dict:
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
            "sha256": sha(path), "media_type": media_type}


def publish(root: Path, draft: dict, foreground: Path, review: dict) -> dict:
    private = contained(root, ".character-image-sequence")
    source = contained(root, private / "inputs" / draft["original_reference"]["sha256"])
    validate_foreground(foreground, draft["original_reference"])
    foreground_blob = contained(root, private / "inputs" / sha(foreground))
    if not foreground_blob.exists():
        write_new_bytes(foreground_blob, foreground.read_bytes())
    require(sha(foreground_blob) == review["target_digest"], "reference_review_stale")
    directory = contained(root, private / "runs" / draft["digest"])
    report_path = directory / "reference-preparation-report.json"
    report = {"schema": "character_reference_preparation_v1", "draft_plan_digest": draft["digest"],
              "source_sha256": sha(source), "foreground_sha256": sha(foreground_blob),
              "method": "cloud_mcp" if draft["reference_needs_cloud_matte"] else "existing_cutout",
              "review_digest": review["digest"], "visual_review_required": True}
    if report_path.exists():
        require(read(report_path) == report, "reference_report_conflict")
    else:
        save(report_path, report)
    handoff = {"schema_version": "ai_reference_preparation_handoff_v1",
               "producer": {"name": "ai-character-image-sequence", "version": __version__},
               "source": fingerprint(root, source, "image"),
               "foreground": fingerprint(root, foreground_blob, "image"),
               "preparation_report": fingerprint(root, report_path, "application/json"),
               "producer_result_sha256": digest(report), "visual_review_required": True}
    handoff["handoff_sha256"] = digest(handoff)
    path = directory / "reference-preparation-handoff.json"
    if path.exists():
        require(read(path) == handoff, "reference_handoff_conflict")
    else:
        save(path, handoff)
    return handoff


def load_preparation(root: Path, draft: dict) -> tuple[dict, dict]:
    directory = contained(root, Path(".character-image-sequence/runs") / draft["digest"])
    review = read(contained(root, directory / "reference-review.json"))
    unseal(review)
    require(review["decision"] == "approved" and review["plan_digest"] == draft["digest"]
            and review["stage"] == "reference" and review["checks"] == sorted(CHECKS),
            "reference_review_not_approved")
    handoff = read(contained(root, directory / "reference-preparation-handoff.json"))
    require(handoff["schema_version"] == "ai_reference_preparation_handoff_v1"
            and handoff["handoff_sha256"] == digest({k: v for k, v in handoff.items() if k != "handoff_sha256"}),
            "reference_handoff_invalid")
    for key in ("source", "foreground", "preparation_report"):
        record = handoff[key]
        path = contained(root, record["path"])
        require(path.stat().st_size == record["bytes"] and sha(path) == record["sha256"],
                "reference_preparation_changed")
    require(handoff["source"]["sha256"] == draft["original_reference"]["sha256"]
            and handoff["foreground"]["sha256"] == review["target_digest"], "reference_handoff_source_mismatch")
    report = read(contained(root, handoff["preparation_report"]["path"]))
    require(report["review_digest"] == review["digest"] and digest(report) == handoff["producer_result_sha256"],
            "reference_preparation_review_mismatch")
    validate_foreground(contained(root, handoff["foreground"]["path"]), draft["original_reference"])
    return handoff, review


def load_reusable_preparation(root: Path, new_draft: dict, handoff_path: Path) -> tuple[dict, dict, dict]:
    """Reuse a reviewed foreground across motion plans without repeating matte compute."""
    handoff = read(contained(root, handoff_path))
    require(handoff.get("schema_version") == "ai_reference_preparation_handoff_v1",
            "reference_handoff_invalid")
    report = read(contained(root, handoff["preparation_report"]["path"]))
    from .planning import load_plan
    prepared_draft = load_plan(root, report["draft_plan_digest"])
    verified, review = load_preparation(root, prepared_draft)
    require(verified == handoff, "reference_handoff_changed")
    require(handoff["source"]["sha256"] == new_draft["original_reference"]["sha256"],
            "reference_handoff_source_mismatch")
    return handoff, review, prepared_draft
