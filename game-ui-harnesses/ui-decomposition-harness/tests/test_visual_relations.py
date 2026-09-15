import base64
import copy
import hashlib
import io
import unittest

from PIL import Image, ImageDraw

from ai_ui_decomposition.common import ContractError, digest
from ai_ui_decomposition.visual_relations import check_visual_relations
from ai_ui_decomposition.visual_observations import check_visual_observations


def _png(size, alpha_box):
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(image).rectangle(alpha_box, fill=(255, 255, 255, 255))
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue(), image


def _asset(path, payload, image, source_rect=None, threshold=1):
    if source_rect is None:
        source_rect = [0, 0, image.width, image.height]
    x, y, width, height = source_rect
    alpha = image.getchannel("A").crop((x, y, x + width, y + height))
    return {
        "path": path,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "sourceRect": source_rect,
        "alphaSha256": hashlib.sha256(alpha.tobytes()).hexdigest(),
        "alphaThreshold": threshold,
    }


def fixture():
    deco_payload, deco_image = _png((20, 10), (2, 2, 17, 7))
    icon_payload, icon_image = _png((10, 10), (2, 2, 7, 7))
    bundle = {
        "document": {"root": {"id": "root", "type": "Panel",
                                "layout": {"x": 0, "y": 0, "width": 320, "height": 180},
                                "children": [
                                    {"id": "deco", "type": "Image",
                                     "layout": {"x": 10, "y": 15, "width": 100, "height": 20},
                                     "props": {"source": "deco.png"}},
                                    {"id": "title", "type": "Text",
                                     "layout": {"x": 0, "y": 0, "width": 100, "height": 20},
                                     "props": {"text": "EXPEDITION"}},
                                    {"id": "owner", "type": "Button",
                                     "layout": {"x": 100, "y": 50, "width": 80, "height": 50},
                                     "props": {"label": "Go"}},
                                    {"id": "icon", "type": "Image",
                                     "layout": {"x": 120, "y": 60, "width": 20, "height": 20},
                                     "props": {"source": "icon.png"}},
                                ]}},
        "resources": [
            {"path": "deco.png", "base64": base64.b64encode(deco_payload).decode(),
             "sha256": hashlib.sha256(deco_payload).hexdigest()},
            {"path": "icon.png", "base64": base64.b64encode(icon_payload).decode(),
             "sha256": hashlib.sha256(icon_payload).hexdigest()},
        ],
    }
    plan = {
        "kind": "ui_visual_relations_v1", "version": "1.0",
        "coordinateSpace": "runtime-world",
        "verticalGaps": [{
            "id": "deco-title-gap",
            "decoration": {"kind": "paint-region-alpha", "componentId": "deco",
                           "paintRegionIndex": 0,
                           "asset": _asset("deco.png", deco_payload, deco_image)},
            "text": {"kind": "text", "componentId": "title", "textIndex": 0,
                     "text": "EXPEDITION"},
            "order": "decoration_above_text", "minimumGap": 3,
            "evidence": "reference shows the divider above the title with a measured gap",
        }],
        "horizontalAlignments": [{
            "id": "deco-title-center",
            "left": {"kind": "paint-region-alpha", "componentId": "deco",
                     "paintRegionIndex": 0,
                     "asset": _asset("deco.png", deco_payload, deco_image)},
            "right": {"kind": "text", "componentId": "title", "textIndex": 0,
                      "text": "EXPEDITION"},
            "alignment": "center", "tolerance": 1,
            "evidence": "reference centers the divider and title",
        }],
        "iconInsets": [{
            "id": "owner-icon-padding",
            "icon": {"kind": "paint-region-alpha", "componentId": "icon",
                     "paintRegionIndex": 0,
                     "asset": _asset("icon.png", icon_payload, icon_image)},
            "owner": {"kind": "node", "componentId": "owner"},
            "minimumInsets": {"top": 5, "right": 5, "bottom": 5, "left": 5},
            "evidence": "reference shows visible icon support inset from the button surface",
        }],
    }
    inspection = {
        "instances": 1, "resources": 2,
        "nodes": [
            {"id": "deco", "visible": True,
             "bounds": {"x": 100, "y": 10, "width": 100, "height": 20}},
            {"id": "title", "visible": True,
             "bounds": {"x": 110, "y": 30, "width": 80, "height": 12},
             "renderedTextBounds": [{"text": "EXPEDITION", "bounds": {"x": 110, "y": 30,
                                                                          "width": 80, "height": 12},
                                      "fontFamily": "Arial", "fontSize": 12}]},
            {"id": "owner", "visible": True,
             "bounds": {"x": 100, "y": 50, "width": 80, "height": 50}},
            {"id": "icon", "visible": True,
             "bounds": {"x": 120, "y": 60, "width": 20, "height": 20}},
        ],
        "paintRegions": [
            {"componentId": "deco", "bounds": {"x": 100, "y": 10, "width": 100, "height": 20}},
            {"componentId": "icon", "bounds": {"x": 120, "y": 60, "width": 20, "height": 20}},
        ],
    }
    return bundle, plan, inspection


class VisualRelationTests(unittest.TestCase):
    def test_valid_relations_use_alpha_visible_bounds(self):
        bundle, plan, inspection = fixture()
        result = check_visual_relations(bundle, plan, inspection)
        self.assertEqual(result["status"], "passed")
        self.assertFalse(result["human_visual_acceptance"])
        self.assertEqual(result["relationCount"], 3)
        gap = next(row for row in result["checks"] if row["code"] == "RELATION_VERTICAL_GAP")
        self.assertAlmostEqual(gap["actualGap"], 4)

    def test_authored_layout_rectangles_do_not_drive_measurement(self):
        bundle, plan, inspection = fixture()
        bundle["document"]["root"]["children"][0]["layout"]["y"] = 900
        bundle["document"]["root"]["children"][1]["layout"]["y"] = -800
        result = check_visual_relations(bundle, plan, inspection)
        self.assertEqual(result["status"], "passed")

    def test_actual_inspection_gap_failure_is_rejected(self):
        bundle, plan, inspection = fixture()
        inspection = copy.deepcopy(inspection)
        inspection["nodes"][1]["renderedTextBounds"][0]["bounds"]["y"] = 20
        inspection["nodes"][1]["bounds"]["y"] = 20
        result = check_visual_relations(bundle, plan, inspection)
        self.assertIn("RELATION_VERTICAL_GAP", [row["code"] for row in result["issues"]])

    def test_actual_visible_alpha_horizontal_alignment_failure_is_rejected(self):
        bundle, plan, inspection = fixture()
        inspection = copy.deepcopy(inspection)
        inspection["paintRegions"][0]["bounds"]["x"] = 130
        result = check_visual_relations(bundle, plan, inspection)
        self.assertIn("RELATION_HORIZONTAL_ALIGNMENT", [row["code"] for row in result["issues"]])

    def test_nonzero_source_roi_offset_maps_against_full_png_canvas(self):
        bundle, plan, inspection = fixture()
        for spec in (plan["verticalGaps"][0], plan["horizontalAlignments"][0]):
            asset = spec["decoration"] if "decoration" in spec else spec["left"]
            asset["asset"]["sourceRect"] = [1, 1, 18, 8]
            image = Image.open(io.BytesIO(base64.b64decode(bundle["resources"][0]["base64"]))).convert("RGBA")
            cropped = image.getchannel("A").crop((1, 1, 19, 9))
            asset["asset"]["alphaSha256"] = hashlib.sha256(cropped.tobytes()).hexdigest()
        result = check_visual_relations(bundle, plan, inspection)
        self.assertEqual(result["status"], "passed")
        observed = next(row for row in result["checks"] if row["code"] == "RELATION_VERTICAL_GAP")
        self.assertAlmostEqual(observed["decoration"]["bounds"]["x"], 110)

    def test_actual_icon_inset_failure_is_rejected(self):
        bundle, plan, inspection = fixture()
        inspection = copy.deepcopy(inspection)
        inspection["paintRegions"][1]["bounds"]["x"] = 100
        result = check_visual_relations(bundle, plan, inspection)
        self.assertIn("RELATION_ICON_INSETS", [row["code"] for row in result["issues"]])

    def test_explicit_indices_prevent_id_or_text_guessing(self):
        bundle, plan, inspection = fixture()
        plan["verticalGaps"][0]["text"]["textIndex"] = 1
        result = check_visual_relations(bundle, plan, inspection)
        self.assertIn("RELATION_TEXT_OBSERVATION_MISSING", [row["code"] for row in result["issues"]])

    def test_resource_and_alpha_digests_are_bound(self):
        bundle, plan, inspection = fixture()
        plan["verticalGaps"][0]["decoration"]["asset"]["alphaSha256"] = "0" * 64
        with self.assertRaisesRegex(ContractError, "RELATION_ALPHA_CHANGED"):
            check_visual_relations(bundle, plan, inspection)

    def test_unregistered_resource_is_rejected(self):
        bundle, plan, inspection = fixture()
        plan["verticalGaps"][0]["decoration"]["asset"]["path"] = "icon.png"
        with self.assertRaisesRegex(ContractError, "RELATION_RESOURCE_CHANGED|RELATION_ALPHA_CHANGED|RELATION_ASSET_NOT_REGISTERED"):
            check_visual_relations(bundle, plan, inspection)

    def test_node_endpoint_uses_actual_runtime_bounds(self):
        bundle, plan, inspection = fixture()
        plan["horizontalAlignments"][0]["left"] = {"kind": "node", "componentId": "owner"}
        plan["horizontalAlignments"][0]["right"] = {"kind": "node", "componentId": "owner"}
        plan["horizontalAlignments"][0]["tolerance"] = 0
        self.assertEqual(check_visual_relations(bundle, plan, inspection)["status"], "passed")

    def test_missing_runtime_paint_evidence_fails_closed(self):
        bundle, plan, inspection = fixture()
        inspection.pop("paintRegions")
        with self.assertRaisesRegex(ContractError, "RELATION_INSPECTION_PAINT_REGIONS_REQUIRED"):
            check_visual_relations(bundle, plan, inspection)

    def test_none_is_optional_and_does_not_claim_pass(self):
        bundle, _, inspection = fixture()
        result = check_visual_relations(bundle, None, inspection)
        self.assertEqual(result["status"], "not_applicable")

    def test_unknown_relation_fields_are_rejected(self):
        bundle, plan, inspection = fixture()
        plan["iconInsets"][0]["guess"] = True
        with self.assertRaisesRegex(ContractError, "RELATION_INSETS_SCHEMA"):
            check_visual_relations(bundle, plan, inspection)

    def test_visual_observations_composes_optional_relation_gate(self):
        bundle, plan, inspection = fixture()
        observations = {"kind": "ui_visual_observations_v1", "texts": [], "dialogs": [],
                        "visualRelations": plan}
        self.assertEqual(check_visual_observations(bundle, observations, inspection)["status"], "passed")
        bad = copy.deepcopy(inspection)
        bad["nodes"][1]["renderedTextBounds"][0]["bounds"]["y"] = 20
        bad["nodes"][1]["bounds"]["y"] = 20
        report = check_visual_observations(bundle, observations, bad)
        self.assertEqual(report["status"], "failed")
        self.assertIn("RELATION_VERTICAL_GAP", [row["code"] for row in report["issues"]])
        self.assertEqual(report["visualRelations"]["status"], "failed")
