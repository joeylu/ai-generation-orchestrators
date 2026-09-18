import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from ai_ui_decomposition.common import ContractError, digest, sha256
from ai_ui_decomposition.workflow_preview import prepare_preview


class WorkflowPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.compiled = self.root / "compiled"
        self.generation = self.root / "generation"
        self.component = self.root / "component"
        self.output = self.root / "preview"
        self.compiled.mkdir()
        self.generation.mkdir()
        self.component.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def _ref(path):
        return {"path": path.name, "sha256": sha256(path)}

    def _prepare(self, _compiled, _run, output, _component_root):
        output.mkdir(parents=True)
        contact = output / "workspace" / "runs" / "materialized" / "materials" / "contact-sheet.png"
        contact.parent.mkdir(parents=True)
        contact.write_bytes(b"fixture-contact")
        plan = output / "prepared-plan.json"
        plan.write_text("{}", encoding="utf-8")
        return plan

    def _build(self, _plan, _component_root, output, _execution):
        assembly = output / "assembly"
        inputs = output / "acceptance-inputs"
        assembly.mkdir(parents=True)
        inputs.mkdir()
        candidate = assembly / "ui.component-handoff.draft.zip"
        candidate.write_bytes(b"fixture-candidate")
        source = inputs / "source.zip"
        source.write_bytes(candidate.read_bytes())
        evidence = inputs / "evidence.json"
        evidence.write_text(json.dumps({"handoffSha256": sha256(candidate)}), encoding="utf-8")
        run_plan = inputs / "run-plan.json"
        run_plan.write_text(json.dumps({
            "kind": "ui_delivery_run_plan_v1",
            "source": self._ref(source),
            "stateEvidence": self._ref(evidence),
        }), encoding="utf-8")
        return run_plan

    def _stateful(self, candidate, _evidence, _component_root, output, **kwargs):
        self.assertFalse(kwargs["browser"])
        self.assertTrue(kwargs["require_visual_layout"])
        output.mkdir(parents=True)
        consumed = output / "consumed.json"
        consumed.write_text(json.dumps({
            "document": {
                "canvas": {"width": 100, "height": 100},
                "root": {"id": "root", "type": "Container", "children": []},
            },
            "resources": [],
        }), encoding="utf-8")
        matrix = output / "state-matrix.json"
        matrix.write_text("{}", encoding="utf-8")
        observations = output / "visual-observations.json"
        observations.write_text(json.dumps({
            "kind": "ui_visual_observations_v1",
            "requiredTextGeometryIds": [],
            "texts": [],
            "dialogs": [],
        }), encoding="utf-8")
        receipt = output / "acceptance.json"
        receipt.write_text(json.dumps({
            "kind": "ui_state_acceptance_v1",
            "status": "deterministic_passed",
            "handoffSha256": sha256(candidate),
            "layoutCoverage": "required_checked",
        }), encoding="utf-8")
        return {"status": "deterministic_passed"}

    def _browser(self, command, **kwargs):
        self.assertEqual(command[0], "node")
        self.assertEqual(command[-1], "--default-only")
        self.assertNotIn("linkage-browser.mjs", str(command))
        self.assertNotIn("studio", str(command).lower())
        self.assertNotIn("reference-accept", str(command))
        self.assertIn("timeout", kwargs)
        state_dir = Path(command[3])
        consumed = state_dir / "consumed.json"
        matrix = state_dir / "state-matrix.json"
        preview = state_dir / "preflight-default.png"
        inspection = state_dir / "preflight-default-inspection.json"
        preview.write_bytes(b"fixture-preview")
        inspection.write_text(json.dumps({"nodes": []}), encoding="utf-8")
        capture = state_dir / "preflight-default-capture.json"
        capture.write_text(json.dumps({
            "kind": "ui_runtime_capture_v1",
            "handoffSha256": sha256(state_dir.parent / "build" / "assembly" / "ui.component-handoff.draft.zip"),
            "bundleSha256": sha256(consumed),
            "human_visual_acceptance": False,
            "screenshot": {"path": preview.name, "sha256": sha256(preview)},
            "inspection": {"path": inspection.name, "sha256": sha256(inspection)},
        }), encoding="utf-8")
        browser = state_dir / "preflight-browser.json"
        browser.write_text(json.dumps({
            "kind": "ui_default_preview_v1",
            "status": "captured",
            "human_visual_acceptance": False,
            "bundleSha256": sha256(consumed),
            "matrixSha256": sha256(matrix),
        }), encoding="utf-8")
        return SimpleNamespace(returncode=0)

    def test_refit_preview_binds_receipt_and_skips_generation_materialization(self):
        def refit(compiled, run, recipes, output, component):
            self.assertEqual(recipes, {'glyph': {'fixture': True}})
            result = self._prepare(compiled, run, output, component)
            (output / 'material-refit.json').write_text('{"mediaCalls":0}', encoding='utf-8')
            return result
        with patch('ai_ui_decomposition.material_refit.prepare_refit', side_effect=refit), \
             patch('ai_ui_decomposition.workflow_preview.prepare_handoff') as normal, \
             patch('ai_ui_decomposition.workflow_preview.build_handoff', side_effect=self._build), \
             patch('ai_ui_decomposition.workflow_preview.stateful_accept', side_effect=self._stateful), \
             patch('ai_ui_decomposition.workflow_preview.subprocess.run', side_effect=self._browser):
            result=prepare_preview(self.compiled,self.generation,self.component,self.output,30,
                                   refit={'glyph': {'fixture': True}})
            normal.assert_not_called()
            receipt=json.loads(result['receipt'].read_text(encoding='utf-8'))
            self.assertEqual(receipt['materialRefit']['sha256'],
                             sha256(self.output/'prepared'/'material-refit.json'))

    def test_builds_hash_bound_default_only_preview_without_full_delivery(self):
        with patch("ai_ui_decomposition.workflow_preview.prepare_handoff", side_effect=self._prepare) as prepare, \
             patch("ai_ui_decomposition.workflow_preview.build_handoff", side_effect=self._build) as build, \
             patch("ai_ui_decomposition.workflow_preview.stateful_accept", side_effect=self._stateful) as stateful_accept, \
             patch("ai_ui_decomposition.workflow_preview.subprocess.run", side_effect=self._browser) as browser, \
             patch("ai_ui_decomposition.delivery_pipeline.run_delivery") as run_delivery, \
             patch("ai_ui_decomposition.studio_acceptance.run_studio") as studio:
            result = prepare_preview(self.compiled, self.generation, self.component, self.output, 30)

        prepare.assert_called_once()
        build.assert_called_once()
        stateful_accept.assert_called_once()
        browser.assert_called_once()
        run_delivery.assert_not_called()
        studio.assert_not_called()
        self.assertEqual(set(result), {"run_plan", "candidate", "preview", "contact", "receipt"})
        for path in result.values():
            self.assertTrue(Path(path).is_relative_to(self.output.resolve()))
        receipt = json.loads(result["receipt"].read_text(encoding="utf-8"))
        body = dict(receipt)
        actual_digest = body.pop("digest")
        self.assertEqual(actual_digest, digest(body))
        self.assertEqual(receipt["status"], "captured")
        self.assertEqual(receipt["acceptance"], "preview_only")
        self.assertFalse(receipt["human_visual_acceptance"])
        for name in ("runPlan", "candidate", "preview", "contact", "stateful",
                     "defaultBrowser", "defaultCapture", "visualObservationCheck"):
            ref = receipt[name]
            path = self.output / Path(ref["path"])
            self.assertEqual(ref["sha256"], sha256(path))

    def test_visual_observation_error_propagates_without_receipt(self):
        with patch("ai_ui_decomposition.workflow_preview.prepare_handoff", side_effect=self._prepare), \
             patch("ai_ui_decomposition.workflow_preview.build_handoff", side_effect=self._build), \
             patch("ai_ui_decomposition.workflow_preview.stateful_accept", side_effect=self._stateful), \
             patch("ai_ui_decomposition.workflow_preview.subprocess.run", side_effect=self._browser), \
             patch("ai_ui_decomposition.workflow_preview.check_visual_observations",
                   side_effect=ContractError("VISUAL_OBSERVATION_PREFLIGHT_REJECTED")):
            with self.assertRaisesRegex(ContractError, "VISUAL_OBSERVATION_PREFLIGHT_REJECTED"):
                prepare_preview(self.compiled, self.generation, self.component, self.output, 30)
        self.assertFalse((self.output / "preview-receipt.json").exists())

    def test_prepare_error_propagates_before_build_or_browser(self):
        with patch("ai_ui_decomposition.workflow_preview.prepare_handoff",
                   side_effect=ContractError("PREPARE_FAILED")), \
             patch("ai_ui_decomposition.workflow_preview.build_handoff") as build, \
             patch("ai_ui_decomposition.workflow_preview.subprocess.run") as browser:
            with self.assertRaisesRegex(ContractError, "PREPARE_FAILED"):
                prepare_preview(self.compiled, self.generation, self.component, self.output, 30)
        build.assert_not_called()
        browser.assert_not_called()


if __name__ == "__main__":
    unittest.main()
