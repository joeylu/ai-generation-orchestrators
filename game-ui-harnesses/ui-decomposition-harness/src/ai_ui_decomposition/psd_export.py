from __future__ import annotations

from pathlib import Path

from PIL import Image
import numpy as np

from .assembly import inspect_delivery
from .common import read_json, require, sha256, write_json
from .resources import delivery_resources


def export_psd(delivery: Path) -> dict:
    inspect_delivery(delivery)
    scene = read_json(delivery / "scene.json")
    delivery_resources(scene)
    require(scene["document"]["format"] in {"auto", "psd"}, "PSB_NOT_IMPLEMENTED")
    require(max(scene["canvas"]) <= 30000, "PSD_SIZE_UNSUPPORTED")
    try:
        from psd_tools import PSDImage
        from psd_tools.api.layers import Group, PixelLayer
        from psd_tools.constants import BlendMode
        from .psd_preview import finalize_preview
    except ImportError as exc:
        raise RuntimeError("PSD_OPTIONAL_DEPENDENCY_MISSING") from exc
    draft = scene.get("delivery_policy") == "unreviewed_draft"
    output = delivery / (scene["document"]["name"] + (".draft.psd" if draft else ".psd"))
    require(not output.exists(), "PSD_EXISTS")
    with Image.open(delivery / scene["preview"]) as source_preview:
        expected = source_preview.convert("RGBA")
    psd = PSDImage.new("RGBA", tuple(scene["canvas"]), color=(0, 0, 0, 0))
    psd.background_color = None
    for group_record in scene["tree"]:
        group = Group.new(parent=psd, name=group_record["name"])
        for layer in group_record["children"]:
            with Image.open(delivery / layer["png"]) as source_layer:
                picture = source_layer.convert("RGBA")
            pixel = PixelLayer.frompil(picture, parent=group, name=layer["name"],
                                       left=layer["left"], top=layer["top"])
            pixel.visible = True
            pixel.opacity = 255
            pixel.blend_mode = BlendMode.NORMAL
    intermediate = delivery / ".sdk-intermediate.psd"
    with intermediate.open("xb") as stream:
        psd.save(stream)
    encoding = finalize_preview(intermediate, output, expected)
    intermediate.unlink()
    reopened = PSDImage.open(output)
    verified = []
    require(len(reopened) == len(scene["tree"]), "PSD_GROUP_COUNT_CHANGED")
    for actual_group, expected_group in zip(reopened, scene["tree"]):
        require(actual_group.is_group() and actual_group.name == expected_group["name"],
                "PSD_GROUP_CHANGED")
        require(len(actual_group) == len(expected_group["children"]), "PSD_LAYER_COUNT_CHANGED")
        for actual, expected_layer in zip(actual_group, expected_group["children"]):
            require(actual.name == expected_layer["name"] and actual.kind == "pixel",
                    "PSD_LAYER_CHANGED")
            require(actual.left == expected_layer["left"] and actual.top == expected_layer["top"],
                    "PSD_LAYER_POSITION_CHANGED")
            actual_image = actual.topil(apply_icc=False)
            with Image.open(delivery / expected_layer["png"]) as source_layer:
                expected_layer_image = source_layer.convert("RGBA")
            require(actual_image is not None
                    and np.array_equal(np.asarray(actual_image.convert("RGBA")),
                                       np.asarray(expected_layer_image)), "PSD_RGBA_CHANGED")
            verified.append(expected_layer["id"])
    composite = reopened.topil(apply_icc=False)
    require(composite is not None, "PSD_PREVIEW_MISSING")
    maximum = int(np.abs(np.asarray(composite.convert("RGBA"), dtype=np.int16)
                         - np.asarray(expected, dtype=np.int16)).max())
    require(maximum <= 1, "PSD_PREVIEW_CHANGED")
    result = {"kind": "ai_ui_decomposition_psd_export_v1",
              "status": "file_roundtrip_passed_application_unverified",
              "file": output.name, "psd_sha256": sha256(output),
              "pixel_layers": len(verified), "rgba_max_error": 0,
              "preview_max_error": maximum, "preview_encoding": encoding,
              "application_check": "not_run"}
    result["delivery_policy"] = "unreviewed_draft" if draft else "reviewed"
    result["visual_review"] = "not_performed" if draft else "human_accepted"
    write_json(delivery / "psd-export.json", result)
    return result
