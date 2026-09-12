import json
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from ai_ui_decomposition.common import ContractError, digest, read_json, sha256
from ai_ui_decomposition.assembly import inspect_delivery
from ai_ui_decomposition.component_handoff import _validate_bound_layers
from ai_ui_decomposition.region_qa import compare_regions


class DeliveryFidelityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        Image.new("RGBA", (8, 8), "white").save(self.root / "layer.png")
        Image.new("RGBA", (8, 8), "white").save(self.root / "preview.png")

    def write(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def delivery(self):
        scene = {"canvas": [8, 8], "delivery_policy": "unreviewed_draft",
                 "review_sha256": None, "preview": "preview.png",
                 "preview_sha256": sha256(self.root / "preview.png"),
                 "tree": [{"children": [{"id": "control", "png": "layer.png",
                     "size": [8, 8], "sha256": sha256(self.root / "layer.png"),
                     "left": 0, "top": 0, "visible": True, "opacity": 255,
                     "blend_mode": "normal"}]}]}
        self.write("scene.json", scene)
        receipt = {"kind": "ai_ui_decomposition_draft_delivery_v1",
                   "delivery_policy": "unreviewed_draft", "human_visual_acceptance": False,
                   "scene_sha256": sha256(self.root / "scene.json")}
        receipt["digest"] = digest(receipt)
        self.write("delivery.json", receipt)

    def test_resigned_unrelated_preview_is_rejected(self):
        self.delivery()
        inspect_delivery(self.root)
        Image.new("RGBA", (8, 8), "black").save(self.root / "preview.png")
        self.delivery()  # Even internally consistent hashes cannot replace composition.
        with self.assertRaisesRegex(ContractError, "PREVIEW_COMPOSITE_MISMATCH"):
            inspect_delivery(self.root)

    def test_unbound_semantic_target_still_checks_alpha(self):
        self.delivery()
        document = {"root": {"id": "button", "type": "Button", "props": {}}}
        binding = {"bindings": [{"componentId": "button", "componentType": "Button",
                                "parts": [{"role": "background", "layerId": "control"}]}]}
        with self.assertRaisesRegex(ContractError, "OPAQUE_INTERACTIVE_ASSET"):
            _validate_bound_layers(self.root, binding, document)
        picture = Image.open(self.root / "layer.png").convert("RGBA")
        picture.putpixel((0, 0), (0, 0, 0, 0))
        picture.save(self.root / "layer.png")
        self.delivery()
        _validate_bound_layers(self.root, binding, document)

    def test_json_limit_override_does_not_relax_default_or_duplicate_keys(self):
        path = self.write("large.json", {"payload": "a" * 2_097_152})
        with self.assertRaisesRegex(ContractError, "JSON_INPUT_INVALID"):
            read_json(path)
        self.assertIn("payload", read_json(path, max_bytes=3_000_000))
        path.write_text('{"a":1,"a":2}', encoding="utf-8")
        with self.assertRaisesRegex(ContractError, "DUPLICATE_JSON_KEY"):
            read_json(path, max_bytes=3_000_000)

    def policy(self):
        return {"kind": "ai_ui_region_qa_policy_v1",
                "reference_sha256": sha256(self.root / "layer.png"),
                "rendered_sha256": sha256(self.root / "preview.png"),
                "reference_state": {"focus": None}, "rendered_state": {"focus": None},
                "regions": [{"id": "button", "bounds": [0, 0, 8, 8],
                             "channel_tolerance": 12, "max_bad_fraction": 0}]}

    def test_region_pass_and_pixel_failure_receipt(self):
        policy = self.write("policy.json", self.policy())
        result = compare_regions(self.root / "layer.png", self.root / "preview.png", policy, self.root / "pass.json")
        self.assertTrue(result["passed"])
        self.assertFalse(result["human_visual_acceptance"])
        picture = Image.open(self.root / "preview.png").convert("RGBA")
        picture.putpixel((3, 3), (0, 0, 0, 255))
        picture.save(self.root / "preview.png")
        self.write("policy.json", self.policy())
        with self.assertRaisesRegex(ContractError, "REGION_VISUAL_QA_REJECTED"):
            compare_regions(self.root / "layer.png", self.root / "preview.png", policy, self.root / "fail.json")
        self.assertEqual(read_json(self.root / "fail.json")["regions"][0]["bad_fraction"], 1 / 64)

    def test_region_state_and_source_mismatch_fail_before_report(self):
        for key, value, error in [("rendered_state", {"focus": "title"}, "STATE_MISMATCH"),
                                  ("rendered_sha256", "0" * 64, "SOURCE_CHANGED")]:
            policy = self.policy()
            policy[key] = value
            with self.assertRaisesRegex(ContractError, error):
                compare_regions(self.root / "layer.png", self.root / "preview.png",
                                self.write("policy.json", policy), self.root / "invalid.json")
            self.assertFalse((self.root / "invalid.json").exists())
