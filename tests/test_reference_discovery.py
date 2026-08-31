"""Offline discovery/registry contracts, not real-image segmentation acceptance."""
from __future__ import annotations

import argparse
import contextlib
import io
import json
from pathlib import Path
import shlex
import unittest

from ai_frame_animation.cli import (
    build_parser, command_correct_apply, command_correct_preview, command_plan,
)
from scripts.build_release_metadata import SDIST_SUPPORT_FILES


ROOT = Path(__file__).parents[1]
SKILL = ROOT / "skills/artwork/skills-2d-frame-animation-video"
REGISTRY = ROOT / "docs/reference-acceptance-v1.json"


class ReferenceDiscoveryTests(unittest.TestCase):
    def test_skill_advertises_actual_cli_commands_without_duplicates(self):
        metadata = json.loads((SKILL / "skill.json").read_text(encoding="utf-8"))
        parser = build_parser()
        commands = next(action.choices for action in parser._actions if isinstance(action, argparse._SubParsersAction))
        self.assertEqual(set(metadata["commands"]), set(commands))
        self.assertEqual(len(metadata["commands"]), len(commands))
        self.assertEqual(metadata["cli"], parser.prog)
        self.assertTrue((SKILL / metadata["entry"]).is_file())

    def test_documented_correction_commands_parse_to_separate_handlers(self):
        # Exercise the actual examples, without calling handlers, reading images,
        # creating attempts or requiring a model in an installed environment.
        for document in (ROOT / "docs/reference-correction.md", SKILL / "SKILL.md"):
            with self.subTest(document=document.name):
                examples = [shlex.split(line) for line in document.read_text(encoding="utf-8").splitlines()
                    if line.startswith("ai-frame-animation ")]
                parsed = [build_parser().parse_args(command[1:]) for command in examples]
                self.assertEqual([item.handler for item in parsed],
                    [command_correct_preview, command_correct_apply, command_plan])
                preview, apply, plan = parsed
                self.assertEqual((preview.region, preview.background_point), ([88, 62, 112, 86], [100, 74]))
                self.assertEqual(Path(apply.preview), Path(preview.out_dir) / "correction.json")
                self.assertEqual(Path(plan.prepared_reference), Path(apply.out_dir) / "preparation.json")
                self.assertNotEqual(preview.prepared_reference, plan.prepared_reference)
                self.assertEqual(apply.confirm_correction_sha256, "<approved-correction-sha256>")
                self.assertEqual(preview.root, apply.root)
                self.assertEqual(apply.root, plan.root)

    def test_apply_discovery_does_not_make_confirmation_optional(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            build_parser().parse_args(["correct", "apply", "--root", "fixture", "--preview", "preview.json",
                "--out-dir", "new-preparation"])
        self.assertEqual(error.exception.code, 2)

    def _fingerprint(self, value):
        self.assertEqual(set(value), {"bytes", "sha256"})
        self.assertIs(type(value["bytes"]), int)
        self.assertGreater(value["bytes"], 0)
        self._sha256(value["sha256"])

    def _sha256(self, value):
        self.assertIsInstance(value, str)
        self.assertEqual(len(value), 64)
        self.assertTrue(set(value) <= set("0123456789abcdef"))

    def _preparation(self, value):
        self.assertEqual(set(value), {"source", "cutout", "foreground", "report_file", "preparation_sha256"})
        for key in ("source", "cutout", "foreground", "report_file"):
            self._fingerprint(value[key])
        self._sha256(value["preparation_sha256"])
        self.assertNotEqual(value["report_file"]["sha256"], value["preparation_sha256"])

    def test_registry_has_path_free_evidence_and_explicit_reproduction_limits(self):
        registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        self.assertEqual(set(registry), {"schema_version", "role", "source_artwork_distributed",
            "alpha_ground_truth_available", "ci_runs_real_segmentation", "style_success_rate_established",
            "runtime_basis", "style_cases", "historical_controls", "contract_controls"})
        self.assertEqual(registry["schema_version"], "reference_acceptance_registry_v1")
        self.assertEqual(registry["role"], "seen_regression_set_not_unseen_holdout")
        for key in ("source_artwork_distributed", "alpha_ground_truth_available", "ci_runs_real_segmentation",
                    "style_success_rate_established"):
            self.assertIs(registry[key], False)
        basis = registry["runtime_basis"]
        self.assertEqual(set(basis), {"styles", "historical", "segmentation_model_sha256", "execution",
            "onnxruntime_version", "pymatting_version", "baseline_alpha_policy"})
        self.assertEqual(set(basis["styles"]), {"kind", "runtime_file_count", "runtime_manifest_sha256", "manifest_encoding"})
        self.assertEqual(basis["styles"]["kind"], "frozen_uncommitted_source_not_published_release")
        self.assertEqual(basis["styles"]["runtime_file_count"], 35)
        self.assertEqual(basis["styles"]["manifest_encoding"], "canonical_json_bytes_of_relative_runtime_paths_to_bytes_and_sha256")
        self._sha256(basis["styles"]["runtime_manifest_sha256"])
        self.assertEqual(set(basis["historical"]), {"kind", "wheel_sha256"})
        self.assertEqual(basis["historical"]["kind"], "local_wip_wheel_not_published_release")
        self._sha256(basis["historical"]["wheel_sha256"])
        self._sha256(basis["segmentation_model_sha256"])
        self.assertEqual(basis["execution"], "local_cpu")
        self.assertEqual(basis["baseline_alpha_policy"], "preserve_mask")
        for key in ("onnxruntime_version", "pymatting_version"):
            self.assertEqual(len(basis[key].split(".")), 3)
            self.assertTrue(all(part.isdigit() for part in basis[key].split(".")))
        ids = set()
        for group in ("style_cases", "historical_controls"):
            for case in registry[group]:
                expected = {"id", "baseline", "visual_assessment", "review_origin"}
                if group == "style_cases":
                    expected.add("followups")
                self.assertEqual(set(case), expected)
                self.assertNotIn(case["id"], ids)
                ids.add(case["id"])
                self.assertTrue(set(case["id"]) <= set("abcdefghijklmnopqrstuvwxyz0123456789-"))
                self.assertTrue(set(case["visual_assessment"]) <= set("abcdefghijklmnopqrstuvwxyz_"))
                self.assertEqual(case["review_origin"], "agent_visual_observation_not_alpha_ground_truth")
                self._preparation(case["baseline"])

    def test_corrected_revision_cannot_replace_the_default_failure(self):
        registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        cases = registry["style_cases"]
        self.assertEqual(len(cases), 8)
        self.assertEqual(len({case["baseline"]["source"]["sha256"] for case in cases}), 8)
        followups = [(case, result) for case in cases for result in case["followups"]]
        self.assertEqual(len(followups), 1)
        robot, followup = followups[0]
        self.assertEqual(robot["id"], "06-pixel-clockwork-automaton")
        self.assertEqual(robot["visual_assessment"], "background_hole_failure")
        self.assertEqual(set(followup), {"id", "kind", "default_behavior_changed", "approved_preview_sha256",
            "preview_file", "result", "changed_pixels", "outside_region_rgba_identical", "fit_unchanged",
            "certifies_complete_matte"})
        self.assertEqual(followup["id"], "user-confirmed-local-correction-r001")
        self.assertEqual(followup["kind"], "user_confirmed_local_correction_not_default_prepare")
        self.assertIs(followup["default_behavior_changed"], False)
        self.assertIs(followup["certifies_complete_matte"], False)
        self._sha256(followup["approved_preview_sha256"])
        self._fingerprint(followup["preview_file"])
        self._preparation(followup["result"])
        self.assertEqual(followup["result"]["source"], robot["baseline"]["source"])
        for key in ("cutout", "foreground", "report_file", "preparation_sha256"):
            self.assertNotEqual(followup["result"][key], robot["baseline"][key])
        self.assertEqual(followup["changed_pixels"], 294)
        self.assertIs(followup["outside_region_rgba_identical"], True)
        self.assertIs(followup["fit_unchanged"], True)

    def test_historical_negative_controls_and_synthetic_contracts_remain_distinct(self):
        registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        historical = {case["id"]: case["visual_assessment"] for case in registry["historical_controls"]}
        self.assertEqual(historical, {
            "old-03-white-outfit-holes": "usable_in_observed_regions_not_alpha_ground_truth",
            "old-02-long-hair-tail": "usable_in_observed_regions_with_low_alpha_residue",
            "white-jpeg-75": "opaque_shoe_material_loss",
            "new-03-feathers-flyaways-openwork": "bright_fine_detail_fringe",
            "new-06-translucent-gauze": "omitted_translucent_material",
        })
        controls = registry["contract_controls"]
        self.assertEqual(len(controls), 4)
        self.assertEqual(len({item["id"] for item in controls}), 4)
        for item in controls:
            self.assertEqual(set(item), {"id", "test", "fixture"})
            for key, prefix, suffix in (("test", "tests/", ".py"), ("fixture", "tests/fixtures/golden/", ".json")):
                value = item[key]
                self.assertTrue(value.startswith(prefix))
                self.assertTrue(value.endswith(suffix))
                self.assertNotIn("..", Path(value).parts)
                self.assertNotIn("\\", value)
                self.assertTrue((ROOT / value).is_file())
                self.assertIn(value, SDIST_SUPPORT_FILES)

    def test_acceptance_docs_and_registry_are_source_distribution_support_files(self):
        for name in ("docs/reference-acceptance.md", "docs/reference-acceptance-v1.json", "tests/test_reference_discovery.py"):
            self.assertIn(name, SDIST_SUPPORT_FILES)
            self.assertTrue((ROOT / name).is_file())
        # JSON is not covered by the existing recursive docs *.md rule.
        directives = [shlex.split(line) for line in (ROOT / "MANIFEST.in").read_text(encoding="utf-8").splitlines()]
        self.assertIn(["include", "docs/reference-acceptance-v1.json"], directives)


if __name__ == "__main__":
    unittest.main()
