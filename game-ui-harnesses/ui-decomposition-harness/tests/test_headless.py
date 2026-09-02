from __future__ import annotations

import copy
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ai_ui_decomposition import batch, planning
from ai_ui_decomposition.assembly import finalize, inspect_delivery
from ai_ui_decomposition.adapter import export_request
from ai_ui_decomposition.common import ContractError, digest, read_json, write_json
from ai_ui_decomposition.headless import auto_run, job_status
from ai_ui_decomposition.mcp_provider import AsyncMcpProvider, _NoRedirect
from ai_ui_decomposition.process import process


def proposal():
    return {"assets": [
        {"id": "scene", "role": "background", "source_region": [0, 0, 64, 48],
         "output_size": [64, 48], "prompt": "Complete an empty blue background."},
        {"id": "button", "role": "important_component", "source_region": [4, 4, 24, 16],
         "output_size": [20, 12], "prompt": "One empty gold button, no text."}],
        "nodes": [{"id": "scene", "asset": "scene", "xy": [0, 0]},
                  {"id": "button_one", "asset": "button", "xy": [4, 30]},
                  {"id": "button_two", "asset": "button", "xy": [36, 30]}],
        "groups": [{"id": "background", "children": ["scene"]},
                   {"id": "controls", "children": ["button_one", "button_two"]}]}


class FakeProvider:
    def __init__(self):
        self.proposal = json.dumps(proposal())
        self.vision_calls = 0
        self.image_calls = 0
        self.fail = False
        self.wrong_ratio = False

    def plan(self, reference, instruction, *, state_dir, timeout):
        self.vision_calls += 1
        assert reference.is_file() and len(instruction) <= 4096 and timeout > 0
        return self.proposal

    def generate(self, bundle, *, state_dir, timeout):
        self.image_calls += 1
        if self.fail:
            raise RuntimeError("https://private.invalid/?token=do-not-log-this")
        state_dir.mkdir(parents=True)
        if read_json(bundle / "handoff.json")["asset"] == "scene":
            picture = Image.new("RGB", (48, 48) if self.wrong_ratio else (64, 48), "#17314a")
        else:
            picture = Image.new("RGB", (80, 60), (248, 8, 248))
            ImageDraw.Draw(picture).rectangle((10, 12, 69, 47), fill="#db9b31")
        result = state_dir / "raw.png"
        picture.save(result)
        return result


class HeadlessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.reference = self.root / "reference.png"
        Image.new("RGB", (64, 48), "#17314a").save(self.reference)
        self.provider = FakeProvider()
        self.job = self.root / "job"

    def tearDown(self):
        self.temp.cleanup()

    def run_job(self, **kwargs):
        return auto_run(self.reference, self.job, self.provider, maximum_calls=kwargs.get("budget", 4),
                        timeout_seconds=kwargs.get("timeout", 60), authorized=kwargs.get("authorized", True))

    def test_real_draft_psd_roundtrip_and_completed_job_reuse(self):
        result = self.run_job()
        self.assertEqual(result["status"], "completed_unreviewed_draft")
        self.assertEqual(result["artifacts"]["psd"]["path"], "delivery/ui.draft.psd")
        self.assertEqual(result["visual_review"], "not_performed")
        self.assertFalse(result["automatic_visual_acceptance"])
        self.assertFalse((self.job / "workspace/runs/automatic/review.json").exists())
        export = read_json(self.job / "delivery/psd-export.json")
        self.assertEqual(export["pixel_layers"], 3)
        self.assertEqual(export["rgba_max_error"], 0)
        self.assertEqual(self.run_job()["digest"], result["digest"])
        self.assertEqual((self.provider.vision_calls, self.provider.image_calls), (1, 2))

    def test_repeated_completed_job_still_checks_psd_hash(self):
        self.run_job()
        (self.job / "delivery/ui.draft.psd").write_bytes(b"corrupted")
        with self.assertRaisesRegex(ContractError, "JOB_ARTIFACT_CHANGED"):
            self.run_job()
        self.assertEqual(self.provider.image_calls, 2)

    def test_no_authorization_no_compute_or_job(self):
        with self.assertRaisesRegex(ContractError, "AUTHORIZATION_REQUIRED"):
            self.run_job(authorized=False)
        self.assertEqual(self.provider.vision_calls, 0)
        self.assertFalse(self.job.exists())

    def test_missing_psd_dependency_rejected_before_compute(self):
        with patch.dict(sys.modules, {"psd_tools": None}):
            with self.assertRaisesRegex(ContractError, "PSD_OPTIONAL_DEPENDENCY_MISSING"):
                self.run_job()
        self.assertEqual(self.provider.vision_calls, 0)

    def test_planner_bad_json_budget_geometry_and_fields_stop_before_generation(self):
        cases = [("not JSON", "PLANNER_INVALID_JSON"),
                 ('{"assets":[],"assets":[]}', "PLANNER_INVALID_JSON")]
        for mutation in ("outside", "override", "background_order", "bad_type"):
            data = proposal()
            if mutation == "outside":
                data["nodes"][1]["xy"] = [64, 40]
            elif mutation == "override":
                data["delivery_policy"] = "reviewed"
            elif mutation == "background_order":
                data["groups"].reverse()
            else:
                data["assets"][1]["id"] = []
            cases.append((json.dumps(data), None))
        for index, (value, reason) in enumerate(cases):
            with self.subTest(index=index):
                self.job = self.root / f"job-{index}"
                self.provider.proposal = value
                result = self.run_job()
                self.assertEqual(result["status"], "failed_no_resubmit")
                if reason:
                    self.assertEqual(result["reason"], reason)
                self.assertEqual(self.provider.image_calls, 0)
        self.job = self.root / "over-budget"
        self.provider.proposal = json.dumps(proposal())
        self.assertEqual(self.run_job(budget=1)["reason"], "PLANNER_GENERATION_BUDGET")
        self.assertEqual(self.provider.image_calls, 0)

    def test_provider_failure_redacts_details_and_blocks_all_replays(self):
        self.provider.fail = True
        result = self.run_job()
        self.assertEqual(result["status"], "failed_no_resubmit")
        self.assertEqual(result["reason"], "IMAGE_PROVIDER_FAILED")
        self.assertNotIn("private.invalid", json.dumps(result))
        self.assertNotIn("do-not-log", (self.job / "result.json").read_text())
        self.assertEqual(result["batch"]["indeterminate"], 1)
        self.assertEqual(result["batch"]["prepared"], 1)
        with self.assertRaisesRegex(ContractError, "JOB_ALREADY_STARTED_NO_RESUBMIT"):
            self.run_job()
        self.assertEqual(self.provider.image_calls, 1)

    def test_invalid_background_result_is_terminal_without_draft(self):
        self.provider.wrong_ratio = True
        result = self.run_job()
        self.assertEqual(result["status"], "failed_no_resubmit")
        self.assertEqual(result["reason"], "OPAQUE_RESULT_ASPECT_MISMATCH")
        self.assertFalse((self.job / "delivery").exists())
        self.assertEqual(self.provider.image_calls, 1)

    def test_crash_after_reservation_does_not_restart_vision_or_generation(self):
        with patch.object(self.provider, "generate", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.run_job()
        self.assertEqual(job_status(self.job)["status"], "started_outcome_unknown")
        self.assertEqual(job_status(self.job)["batch"]["reserved"], 1)
        with self.assertRaisesRegex(ContractError, "JOB_ALREADY_STARTED_NO_RESUBMIT"):
            self.run_job()
        self.assertEqual(self.provider.vision_calls, 1)

    def test_changed_input_cannot_use_existing_job(self):
        self.run_job()
        Image.new("RGB", (64, 48), "red").save(self.reference)
        with self.assertRaisesRegex(ContractError, "JOB_INPUT_CHANGED"):
            self.run_job()
        self.assertEqual(self.provider.image_calls, 2)

    def test_draft_does_not_imply_human_review(self):
        self.run_job()
        run = self.job / "workspace/runs/automatic"
        with self.assertRaises(ContractError):
            finalize(run, self.root / "reviewed")
        receipt = read_json(self.job / "delivery/delivery.json")
        receipt["kind"] = "ai_ui_decomposition_delivery_v1"
        receipt["digest"] = digest({k: v for k, v in receipt.items() if k != "digest"})
        (self.job / "delivery/delivery.json").write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ContractError, "REVIEWED_MISLABELED"):
            inspect_delivery(self.job / "delivery")

    def test_reviewed_plan_cannot_silently_become_draft(self):
        self.run_job()
        original = self.job / "workspace/runs/automatic"
        project = self.job / "project"
        plan = read_json(project / "plan.json")
        del plan["delivery_policy"]
        write_json(project / "reviewed-plan.json", plan)
        frozen = batch.freeze(project / "reviewed-plan.json", self.root / "reviewed-work", "reviewed")
        run = self.root / "reviewed-work/runs/reviewed"
        for key, entry in frozen["requests"].items():
            batch.reserve(run, key)
            batch.receive(run, key, original / "requests" / entry["id"] / "raw.png")
        process(run)
        with self.assertRaisesRegex(ContractError, "DRAFT_POLICY_NOT_FROZEN"):
            finalize(run, self.root / "forbidden-draft", draft=True)
        self.assertFalse((self.root / "forbidden-draft").exists())

    def test_deadline_after_planning_never_generates(self):
        original = self.provider.plan
        def late(*args, **kwargs):
            response = original(*args, **kwargs)
            clock[0] = 100
            return response
        clock = [0]
        with patch("ai_ui_decomposition.headless.time.monotonic", side_effect=lambda: clock[0]), \
             patch.object(self.provider, "plan", side_effect=late):
            self.assertEqual(self.run_job(timeout=1)["reason"], "JOB_DEADLINE_EXCEEDED")
        self.assertEqual(self.provider.image_calls, 0)


class McpAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.options = {"vision_url_env": "TEST_UI_VISION", "imagegen_url_env": "TEST_UI_IMAGE",
                        "api_key_env": "TEST_UI_KEY", "download_hosts": ["media.example.invalid"]}
        with patch.dict(os.environ, {"TEST_UI_VISION": "https://vision.example.invalid/mcp",
                                    "TEST_UI_IMAGE": "https://image.example.invalid/mcp",
                                    "TEST_UI_KEY": "test-only-secret"}):
            self.provider = AsyncMcpProvider(self.options)

    def tearDown(self):
        self.temp.cleanup()

    def test_async_vision_persists_submission_before_send_and_polls_once(self):
        reference = self.root / "reference.png"
        Image.new("RGB", (64, 48), "blue").save(reference)
        state = self.root / "private"
        seen = []
        def rpc(endpoint, method, params, deadline, **kwargs):
            if method == "tools/list":
                return {"tools": [{"name": "get_task"}, {"name": "imagegen"}, {"name": "vision"}]}
            seen.append(params["name"])
            if params["name"] == "vision":
                actual = params["arguments"]["instruction"]
                self.assertEqual(actual, actual.strip())
                self.assertEqual(read_json(state / "submission.json")["arguments"], params["arguments"])
                return {"structuredContent": {"taskId": "test-task", "status": "queued", "pollAfterSeconds": 1}}
            return {"structuredContent": {"taskId": "test-task", "status": "completed",
                                          "result": {"description": json.dumps(proposal())}}}
        with patch.object(self.provider, "_rpc", side_effect=rpc), patch("time.sleep"):
            value = self.provider.plan(reference, planning.instruction([64, 48], 4), state_dir=state, timeout=60)
        self.assertEqual(json.loads(value), proposal())
        self.assertEqual(seen, ["vision", "get_task"])

    def test_vision_instruction_whitespace_is_rejected_before_any_network(self):
        for text in (" instructions", "instructions\n", "\tinstructions\r\n"):
            with self.subTest(text=text), patch.object(self.provider, "_rpc") as rpc:
                with self.assertRaisesRegex(ContractError, "MCP_VISION_INSTRUCTION_WHITESPACE"):
                    self.provider.plan(self.root / "not-needed.png", text,
                                       state_dir=self.root / "never-created", timeout=60)
                rpc.assert_not_called()
                self.assertFalse((self.root / "never-created").exists())

    def test_imagegen_only_provider_does_not_require_vision_configuration(self):
        options = {"vision_url_env": None, "imagegen_url_env": "TEST_UI_IMAGE",
                   "api_key_env": "TEST_UI_KEY", "download_hosts": ["media.example.invalid"]}
        with patch.dict(os.environ, {"TEST_UI_IMAGE": "https://image.example.invalid/mcp",
                                    "TEST_UI_KEY": "test-only-secret"}):
            provider = AsyncMcpProvider(options)
        self.assertIsNone(provider.vision_url)
        with patch.object(provider, "_tools") as tools:
            with self.assertRaisesRegex(ContractError, "MCP_VISION_ENDPOINT_UNCONFIGURED"):
                provider.plan(self.root / "not-needed.png", "valid instruction",
                              state_dir=self.root / "never-created", timeout=60)
        tools.assert_not_called()
        self.assertFalse((self.root / "never-created").exists())

    def test_transport_failure_does_not_resubmit_even_with_idempotent_server(self):
        state = self.root / "private"
        with patch.object(self.provider, "_rpc", side_effect=ContractError("MCP_TRANSPORT_FAILED_NO_RESUBMIT")) as rpc:
            with self.assertRaises(ContractError):
                self.provider._task("https://example.invalid", "vision", {}, state, time.monotonic() + 60)
            with self.assertRaisesRegex(ContractError, "MCP_ATTEMPT_ALREADY_EXISTS"):
                self.provider._task("https://example.invalid", "vision", {}, state, time.monotonic() + 60)
        self.assertEqual(rpc.call_count, 1)
        self.assertTrue((state / "submission.json").exists())
        self.assertEqual(read_json(state / "outcome.json")["acceptance"], "not_established")

    def test_rpc_supports_json_and_sse_without_exposing_authorization(self):
        for sse in (False, True):
            def read(request, deadline, maximum):
                self.assertEqual(request.get_header("Authorization"), "Bearer test-only-secret")
                call = json.loads(request.data)
                data = json.dumps({"jsonrpc": "2.0", "id": call["id"], "result": {"tools": []}})
                return ("event: message\ndata: " + data + "\n\n" if sse else data).encode()
            with patch.object(self.provider, "_read", side_effect=read):
                self.assertEqual(self.provider._rpc("https://example.invalid", "tools/list", {}, 100), {"tools": []})

    def test_redirects_rejected(self):
        with self.assertRaisesRegex(ContractError, "MCP_REDIRECT_REJECTED"):
            _NoRedirect().redirect_request(None, None, 302, None, None, "https://other.invalid/")

    def test_remote_rejections_keep_distinct_codes_and_private_evidence(self):
        cases = [("tool", "MCP_TOOL_REJECTED"), ("rpc", "MCP_RPC_REJECTED"),
                 ("wrong-id", "MCP_RPC_ID")]
        for mode, code in cases:
            with self.subTest(mode=mode):
                directory = self.root / mode
                payloads = []
                def read(request, deadline, maximum):
                    call = json.loads(request.data)
                    self.assertEqual(read_json(directory / "request.json")["id"], call["id"])
                    response = {"jsonrpc": "2.0", "id": call["id"]}
                    if mode == "rpc":
                        response["error"] = {"code": -32602, "message": "private-provider-detail"}
                    else:
                        response["result"] = {"isError": True,
                                              "content": [{"type": "text", "text": "private-provider-detail"}]}
                    if mode == "wrong-id":
                        response["id"] = "unrelated-response"
                    payloads.append(json.dumps(response).encode())
                    return payloads[-1]
                with patch.object(self.provider, "_read", side_effect=read) as transport:
                    with self.assertRaisesRegex(ContractError, code) as failure:
                        self.provider._rpc("https://example.invalid", "tools/call",
                                           {"name": "vision"}, 100, evidence_dir=directory)
                self.assertEqual(transport.call_count, 1)
                self.assertNotIn("private-provider-detail", str(failure.exception))
                self.assertEqual((directory / "response.bin").read_bytes(), payloads[-1])

    def test_malformed_json_and_utf8_preserve_raw_response_without_retry(self):
        for index, payload in enumerate((b"not-json", b"\xff\xfe")):
            directory = self.root / f"malformed-{index}"
            with patch.object(self.provider, "_read", return_value=payload) as transport:
                with self.assertRaisesRegex(ContractError, "MCP_INVALID_RESPONSE"):
                    self.provider._rpc("https://example.invalid", "tools/call",
                                       {"name": "vision"}, 100, evidence_dir=directory)
            self.assertEqual(transport.call_count, 1)
            self.assertEqual((directory / "response.bin").read_bytes(), payload)

    def test_initial_tool_rejection_is_terminal_and_keeps_request_identity(self):
        state = self.root / "rejected"
        def read(request, deadline, maximum):
            call = json.loads(request.data)
            return json.dumps({"jsonrpc": "2.0", "id": call["id"],
                               "result": {"isError": True, "content": []}}).encode()
        with patch.object(self.provider, "_read", side_effect=read) as transport:
            with self.assertRaisesRegex(ContractError, "MCP_TOOL_REJECTED"):
                self.provider._task("https://example.invalid", "vision", {}, state, 100)
            saved_id = read_json(state / "submission.json")["arguments"]["submissionId"]
            with self.assertRaisesRegex(ContractError, "MCP_ATTEMPT_ALREADY_EXISTS"):
                self.provider._task("https://example.invalid", "vision", {}, state, 100)
        self.assertEqual(transport.call_count, 1)
        self.assertEqual(saved_id, read_json(state / "submission.json")["arguments"]["submissionId"])
        self.assertFalse(read_json(state / "outcome.json")["automatic_resubmit"])
        self.assertTrue((state / "rpc-0000/response.bin").exists())

    def image_bundle(self):
        project = self.root / "project"
        project.mkdir()
        Image.new("RGB", (64, 48), "blue").save(project / "reference.png")
        planning.materialize(json.dumps(proposal()), project, [64, 48], 4)
        batch.freeze(project / "plan.json", self.root / "work", "test")
        bundle = self.root / "bundle"
        export_request(self.root / "work/runs/test", "scene", bundle)
        return bundle

    def test_image_download_is_allowlisted_and_has_no_api_credentials(self):
        bundle = self.image_bundle()
        stream = io.BytesIO()
        Image.new("RGB", (64, 48), "blue").save(stream, format="PNG")
        payload = stream.getvalue()
        metadata = {"downloadUrl": "https://media.example.invalid/result.png?signature=test",
                    "mimeType": "image/png", "width": 64, "height": 48, "bytes": len(payload)}
        state = self.root / "private"
        def task(*args):
            state.mkdir()
            return metadata
        def download(request, deadline, maximum):
            self.assertIsNone(request.get_header("Authorization"))
            self.assertEqual(maximum, len(payload))
            return payload
        with patch.object(self.provider, "_tools"), patch.object(self.provider, "_task", side_effect=task), \
             patch.object(self.provider, "_read", side_effect=download):
            result = self.provider.generate(bundle, state_dir=state, timeout=60)
        self.assertEqual(result.read_bytes(), payload)
        self.assertNotIn("signature", (state / "received.json").read_text())

    def test_untrusted_download_host_is_rejected_before_download(self):
        bundle = self.image_bundle()
        with patch.object(self.provider, "_tools"), patch.object(self.provider, "_task", return_value={
                "downloadUrl": "https://private.example.invalid/internal"}), \
             patch.object(self.provider, "_read") as download:
            with self.assertRaisesRegex(ContractError, "MCP_DOWNLOAD_HOST_REJECTED"):
                self.provider.generate(bundle, state_dir=self.root / "private", timeout=60)
        download.assert_not_called()

    def test_known_task_recovery_never_submits_imagegen(self):
        bundle = self.image_bundle()
        state = self.root / "known"
        state.mkdir()
        write_json(state / "task.json", {"taskId": "known-task", "submissionId": "known-submission"})
        write_json(state / "submission.json", {"tool": "imagegen", "arguments": {"submissionId": "known-submission"}})
        finished = self.root / "recovered.png"
        Image.new("RGB", (64, 48), "blue").save(finished)
        calls = []
        def rpc(endpoint, method, params, deadline, **kwargs):
            calls.append(params["name"])
            self.assertEqual(params["name"], "get_task")
            return {"structuredContent": {"taskId": "known-task", "status": "completed",
                "result": {"downloadUrl": "https://media.example.invalid/result.png",
                           "mimeType": "image/png", "width": 64, "height": 48, "bytes": 1}}}
        with patch.object(self.provider, "_rpc", side_effect=rpc), \
             patch.object(self.provider, "_download_completed", return_value=finished) as download:
            result = self.provider.recover_generate(bundle, state_dir=state, timeout=60)
        self.assertEqual(calls, ["get_task"])
        download.assert_called_once()
        self.assertEqual(result.name, "recovered-raw.png")


if __name__ == "__main__":
    unittest.main()
