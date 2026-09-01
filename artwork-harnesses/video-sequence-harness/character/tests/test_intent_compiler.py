from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

import jsonschema
from PIL import Image, ImageDraw

from ai_frame_animation.canonical import fingerprint, stamp_document, verify_document, write_json_atomic
from ai_frame_animation.cli import main
from ai_frame_animation.compiler import compile_intent_to_job
from ai_frame_animation.intent import delivery_continuity, validate_character_motion_intent
from ai_frame_animation.planning import compile_plan, validate_plan_contract


def decision(value: object, source: str = "automatic_policy") -> dict[str, object]:
    return {"value": value, "source": source, "rationale": "离线 fixture 的明确决策来源。"}


def make_intent(reference: dict[str, object], continuity: str = "seamless_loop") -> dict[str, object]:
    return stamp_document({
        "schema_version": "ai_frame_animation_character_motion_intent_v1",
        "raw_request": "让角色轻微待机并保持镜头固定",
        "reference": reference,
        "subject_preserve": decision(["主体身份", "比例", "配色"]),
        "action_type": decision("idle", "explicit_natural_language"),
        "motion_goal": decision("角色轻微待机", "explicit_natural_language"),
        "motion_contract": {
            "must_move": decision(["主体轻微起伏"]),
            "may_move": decision(["发梢轻微摆动"]),
            "must_lock": decision(["主体身份", "配色"]),
            "amplitude": decision("subtle"),
            "continuity": decision(continuity),
            "key_poses": decision([]),
        },
        "spatial_contract": {
            "subject_translation": decision("stationary"),
            "subject_turn": decision("locked"),
            "camera_motion": decision("locked"),
        },
    }, "intent_sha256")


def job() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "job_id": "intent-fixture",
        "character": {"reference": "reference.png", "description": "fixture character"},
        "motion": {"request": "uncompiled placeholder", "continuity": "one_shot"},
        "delivery": {"frame_counts": [16, 32], "size": 128, "quality": "strict", "gif": True},
        "provider": {"plugin": "minimax_h3"},
    }


class IntentCompilerTests(unittest.TestCase):
    def workspace(self, root: Path) -> dict[str, object]:
        image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        ImageDraw.Draw(image).ellipse((12, 6, 52, 60), fill=(230, 80, 40, 255))
        image.save(root / "reference.png")
        reference = fingerprint(root / "reference.png", media_type="image")
        return {
            "source_sha256": reference["sha256"],
            "foreground_sha256": reference["sha256"],
            "preparation_sha256": None,
        }

    def handoff_workspace(self, root: Path) -> tuple[dict[str, object], dict[str, object]]:
        Image.new("RGB", (64, 64), (238, 238, 238)).save(root / "reference.png")
        prepared = root / "prepared"
        prepared.mkdir()
        foreground = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        ImageDraw.Draw(foreground).rectangle((16, 8, 48, 60), fill=(245, 245, 245, 255))
        foreground.save(prepared / "foreground.png")
        report = stamp_document({"schema_version": "fixture_prepare_v1"}, "result_sha256")
        write_json_atomic(prepared / "preparation.json", report)
        handoff = stamp_document({
            "schema_version": "ai_reference_preparation_handoff_v1",
            "producer": {"name": "fixture-producer", "version": "1"},
            "source": {"path": "reference.png", **fingerprint(root / "reference.png", media_type="image")},
            "foreground": {"path": "prepared/foreground.png", **fingerprint(prepared / "foreground.png", media_type="image")},
            "preparation_report": {
                "path": "prepared/preparation.json",
                **fingerprint(prepared / "preparation.json", media_type="application/json"),
            },
            "producer_result_sha256": report["result_sha256"],
            "visual_review_required": True,
        }, "handoff_sha256")
        write_json_atomic(prepared / "handoff.json", handoff)
        binding = {
            "source_sha256": handoff["source"]["sha256"],
            "foreground_sha256": handoff["foreground"]["sha256"],
            "preparation_sha256": handoff["handoff_sha256"],
        }
        return handoff, binding

    def test_provider_neutral_intent_compiles_into_existing_job_and_plan(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            intent = make_intent(self.workspace(root))
            template = job()
            before = deepcopy([intent, template])
            first = compile_intent_to_job(intent, template, root)
            second = compile_intent_to_job(intent, template, root)
            self.assertEqual(first, second)
            self.assertEqual([intent, template], before)
            self.assertEqual(first["motion"]["continuity"], "loop")
            self.assertIn("主体轻微起伏", first["motion"]["request"])
            encoded = json.dumps(first, ensure_ascii=False)
            for forbidden in ("base_url", "workflow_path", "api_key", "768P", "aigcWatermark", "prepare_result_id"):
                self.assertNotIn(forbidden, encoded)
            report = first["intent_compilation"]
            self.assertEqual(verify_document(report, "compilation_sha256"), report["compilation_sha256"])
            plan = compile_plan(first, root)
            validate_plan_contract(plan)
            self.assertEqual(plan["generation"]["intent_compilation"], report)
            self.assertEqual(plan["motion"]["request"], first["motion"]["request"])
            schema_root = Path(__file__).parents[1] / "src" / "ai_frame_animation" / "schemas"
            for value, schema_name in (
                (intent, "character-motion-intent.schema.json"),
                (first, "job.schema.json"),
                (plan, "plan.schema.json"),
            ):
                schema = json.loads((schema_root / schema_name).read_text(encoding="utf-8"))
                jsonschema.Draft202012Validator(schema).validate(value)

    def test_all_semantic_continuities_project_without_keyword_inference(self) -> None:
        reference = {"source_sha256": "a" * 64, "foreground_sha256": "a" * 64, "preparation_sha256": None}
        for value in ("seamless_loop", "loop_return", "continuous_cycle"):
            self.assertEqual(delivery_continuity(make_intent(reference, value)), "loop")
        for value in ("one_shot_settle", "terminal_hold"):
            self.assertEqual(delivery_continuity(make_intent(reference, value)), "one_shot")

    def test_public_preparation_handoff_is_bound_without_importing_its_producer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            handoff, binding = self.handoff_workspace(root)
            intent = make_intent(binding)
            compiled = compile_intent_to_job(intent, job(), root, prepared_reference="prepared/handoff.json")
            plan = compile_plan(compiled, root, prepared_reference="prepared/handoff.json")
            self.assertEqual(plan["character"]["reference"], "prepared/foreground.png")
            self.assertEqual(plan["generation"]["intent_compilation"]["reference"], binding)
            self.assertNotIn(handoff["producer"]["name"], json.dumps(compiled))

    def test_digest_reference_and_semantic_conflicts_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            intent = make_intent(self.workspace(root))
            changed = deepcopy(intent)
            changed["motion_goal"]["value"] = "tampered"
            with self.assertRaisesRegex(ValueError, "intent_sha256_mismatch"):
                validate_character_motion_intent(changed)
            mismatch = make_intent({**intent["reference"], "foreground_sha256": "0" * 64})
            with self.assertRaisesRegex(ValueError, "intent_compiler_reference_mismatch"):
                compile_intent_to_job(mismatch, job(), root)
            conflict = deepcopy(intent)
            conflict["motion_contract"]["must_lock"] = decision(["主体轻微起伏"])
            conflict = stamp_document(conflict, "intent_sha256")
            with self.assertRaisesRegex(ValueError, "intent_move_lock_conflict"):
                validate_character_motion_intent(conflict)

    def test_cli_validate_and_compile_are_offline_and_do_not_overwrite_template(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            intent = make_intent(self.workspace(root))
            draft = {key: intent[key] for key in (
                "subject_preserve", "action_type", "motion_goal", "motion_contract", "spatial_contract",
            )}
            write_json_atomic(root / "draft.json", draft)
            write_json_atomic(root / "job.json", job())
            before = (root / "job.json").read_bytes()
            self.assertEqual(main([
                "intent", "build", "--root", str(root), "--request", intent["raw_request"],
                "--draft", "draft.json", "--job", "job.json", "--out", "intent.json",
            ]), 0)
            self.assertEqual(main(["intent", "validate", "--input", str(root / "intent.json")]), 0)
            self.assertEqual(main([
                "compile", "--root", str(root), "--intent", "intent.json", "--job", "job.json", "--out", "compiled-job.json",
            ]), 0)
            self.assertEqual((root / "job.json").read_bytes(), before)
            compiled = json.loads((root / "compiled-job.json").read_text(encoding="utf-8"))
            built_intent = json.loads((root / "intent.json").read_text(encoding="utf-8"))
            self.assertEqual(compiled["intent_compilation"]["intent_sha256"], built_intent["intent_sha256"])

    def test_cli_rejects_output_that_aliases_an_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            intent = make_intent(self.workspace(root))
            draft = {key: intent[key] for key in (
                "subject_preserve", "action_type", "motion_goal", "motion_contract", "spatial_contract",
            )}
            write_json_atomic(root / "draft.json", draft)
            write_json_atomic(root / "intent.json", intent)
            write_json_atomic(root / "job.json", job())
            before = (root / "job.json").read_bytes()
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                status = main([
                    "intent", "build", "--root", str(root), "--request", intent["raw_request"],
                    "--draft", "draft.json", "--job", "job.json", "--out", "job.json",
                ])
            self.assertEqual(status, 2)
            self.assertEqual(json.loads(output.getvalue())["code"], "output_must_not_overwrite_input")
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                status = main([
                    "compile", "--root", str(root), "--intent", "intent.json",
                    "--job", "job.json", "--out", "job.json",
                ])
            self.assertEqual(status, 2)
            self.assertEqual(json.loads(output.getvalue())["code"], "output_must_not_overwrite_input")
            self.assertEqual((root / "job.json").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
