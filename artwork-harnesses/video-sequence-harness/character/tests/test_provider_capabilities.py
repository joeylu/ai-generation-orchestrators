import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import jsonschema
from PIL import Image

from ai_frame_animation.planning import compile_plan
from ai_frame_animation.providers.capabilities import validate_capabilities, verify_runtime_capabilities
from ai_frame_animation.providers.minimax_h3 import MiniMaxH3Provider


class ProviderCapabilitiesTests(unittest.TestCase):
    def test_capability_snapshot_is_detached_digest_bound_and_schema_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); Image.new("RGB", (8, 8), "red").save(root / "reference.png")
            job = {"schema_version": "1.1", "job_id": "capability-fixture", "character": {"reference": "reference.png"},
                "motion": {"request": "idle", "continuity": "loop"},
                "delivery": {"atlas_profiles": ["4x4"], "size": 128, "alpha_mode": "native"}, "provider": {"plugin": "minimax_h3"}}
            caps = MiniMaxH3Provider.capabilities(None)
            plan = compile_plan(job, root, provider_capabilities=caps)
            schema_root = Path(__file__).parents[1] / "src/ai_frame_animation/schemas"
            jsonschema.validate(plan, json.loads((schema_root / "plan.schema.json").read_text()))
            jsonschema.validate(job, json.loads((schema_root / "job.schema.json").read_text()))
            verify_runtime_capabilities(SimpleNamespace(capabilities=lambda: caps), plan)
            caps["adapter_version"] = "2"
            self.assertEqual(plan["provider"]["capabilities"]["adapter_version"], "1")
            self.assertNotEqual(plan["plan_sha256"], compile_plan(job, root, provider_capabilities=caps)["plan_sha256"])
            with self.assertRaisesRegex(ValueError, "provider_capabilities_changed"):
                verify_runtime_capabilities(SimpleNamespace(capabilities=lambda: caps), plan)
            with self.assertRaisesRegex(ValueError, "provider_capabilities_changed"):
                verify_runtime_capabilities(object(), plan)

    def test_host_fields_and_unsupported_roles_are_rejected(self):
        caps = MiniMaxH3Provider.capabilities(None)
        with self.assertRaisesRegex(ValueError, "provider_capabilities_invalid"):
            validate_capabilities({**caps, "endpoint": "https://example.invalid"})
        changed = copy.deepcopy(caps); changed["image_roles"] = ["first", "last"]
        from ai_frame_animation.providers.capabilities import validate_capabilities_for_plan
        with self.assertRaisesRegex(ValueError, "provider_input_not_supported"):
            validate_capabilities_for_plan(changed, {"provider": {"plugin": "minimax_h3"}})

    def test_legacy_plugins_do_not_need_new_capability_method(self):
        verify_runtime_capabilities(object(), {"provider": {"plugin": "fixture"}})

    def test_run_never_submits_when_capability_discovery_changes_or_fails(self):
        import test_provider_attempts as fixtures
        from ai_frame_animation.canonical import stamp_document, write_json_atomic
        from ai_frame_animation.cli import command_run
        from ai_frame_animation.providers.base import GenerationNotSubmitted
        from ai_frame_animation.state import AttemptStore
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); helper = fixtures.ProviderAttemptTests()
            plan_path = helper._plan(root)
            plan = json.loads(plan_path.read_text())
            caps = {**MiniMaxH3Provider.capabilities(None), "plugin": "fixture"}
            plan["provider"]["capabilities"] = caps
            plan = stamp_document(plan, "plan_sha256"); write_json_atomic(plan_path, plan)
            for index, error in enumerate([None, RuntimeError("fixture_failure")]):
                provider = fixtures.FakeProvider()
                provider.capabilities = lambda: {**caps, "adapter_version": "changed"}
                attempt = f"caps-{index}"
                args = helper._args(root, plan_path, plan["plan_sha256"], attempt)
                with patch("ai_frame_animation.cli.load_provider", return_value=provider), \
                     patch.object(provider, "capabilities", side_effect=error, return_value={**caps, "adapter_version": "changed"}):
                    with self.assertRaises(GenerationNotSubmitted): command_run(args)
                self.assertEqual(provider.submit_count, 0)
                self.assertEqual(AttemptStore(root / "state", attempt).read()[-1]["state"], "GENERATION_NOT_SUBMITTED")
