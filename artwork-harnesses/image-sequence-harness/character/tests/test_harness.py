"""Offline regression fixtures; no model, cloud or GPU calls."""
from __future__ import annotations

import base64
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from PIL import Image, ImageDraw

from ai_character_image_sequence import __version__, cloud_mcp, workflow
from ai_character_image_sequence.cli import main
from ai_character_image_sequence.media import gif_ticks
from ai_character_image_sequence.planning import create_plan, run_dir, workspace
from ai_character_image_sequence.storage import HarnessError, contained, read, save, sha


class HarnessCase(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parents[1] / ".test-work"
        test_root.mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=test_root)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        workspace(self.root)
        self.reference = self.root / "reference.png"
        ref = Image.new("RGBA", (32, 32))
        ImageDraw.Draw(ref).rectangle((6, 6, 25, 25), fill="orange")
        ref.save(self.reference)
        self.request = {"reference": "reference.png", "motion": "A readable action",
                        "phases": ["prepare", "extend", "resolve", "return"], "loop": True,
                        "duration_ms": 1010, "board_size": 128, "frame_size": 32, "gif": True}
        save(self.root / "request.json", self.request)
        self.plan = create_plan(self.root, self.root / "request.json")
        workflow.review(self.root, self.plan["digest"], "reference", "approved", "fixture", "Checked fixture cutout",
                        workflow.REVIEW_CHECKS["reference"])
        self.plan = create_plan(self.root, self.root / "request.json")
        self.pid = self.plan["digest"]
        self.directory = run_dir(self.root, self.plan)
        self.config_path = self.root / ".character-image-sequence" / "adapter.json"
        self.config = {"adapter": "queued_image_mcp_v1", "key_env": "TEST_IMAGE_MCP_KEY",
                       "endpoints": {"generate": "https://example.invalid/image",
                                     "matte": "https://example.invalid/matte"}}
        save(self.config_path, self.config)

    def fixture(self, *, missing=False, duplicate_terminal=False, opaque=False, boundary=False):
        # Enclosed hole, continuous-alpha strip and nonzero hidden RGB reproduce alpha issues.
        im = Image.new("RGBA", (128, 128), (123, 45, 67, 0))
        draw = ImageDraw.Draw(im)
        for i in range(16):
            if missing and i == 8:
                continue
            j = 0 if duplicate_terminal and i == 15 else i
            x, y = i % 4 * 32, i // 4 * 32
            color = (40 + j * 10, 60 + j * 5, 200 - j * 7, 255)
            draw.rectangle((x + 5, y + 5, x + 24, y + 26), fill=color)
            draw.rectangle((x + 11, y + 11, x + 14, y + 14), fill=(200, 200, 200, 0))
            draw.line((x + 4, y + 7, x + 4, y + 24), fill=(*color[:3], 128))
        if boundary:
            draw.point((0, 10), fill="red")
        if opaque:
            im.putalpha(255)
        path = self.root / "matte-input.png"
        im.save(path)
        raw = Image.new("RGBA", im.size, "white")
        raw.alpha_composite(im)
        raw.convert("RGB").save(self.root / "raw-input.png")
        return path

    def reviewed_raw(self, **kwargs):
        matte = self.fixture(**kwargs)
        workflow.import_raw(self.root, self.pid, self.root / "raw-input.png")
        self.approve("raw")
        return matte

    def approve(self, stage):
        return workflow.review(self.root, self.pid, stage, "approved", "fixture-reviewer",
                               "Synthetic regression fixture only", workflow.REVIEW_CHECKS[stage])

    def imported(self, **kwargs):
        matte = self.reviewed_raw(**kwargs)
        save(self.root / "handoff.json", {"schema": "cloud_matte_handoff_v1",
            "source_sha256": sha(self.root / "raw-input.png"), "producer": {"kind": "cloud_mcp"},
            "result": {"path": "matte-input.png", "sha256": sha(matte), "bytes": matte.stat().st_size}})
        workflow.import_matte(self.root, self.pid, self.root / "handoff.json")

    def use_bottom_center_alignment(self):
        draft = self.plan["reference_preparation"]["draft_plan_digest"]
        request = {**self.request, "alignment_mode": "bottom_center",
                   "alignment_reference_frame": 1,
                   "reference_preparation_handoff":
                       f".character-image-sequence/runs/{draft}/reference-preparation-handoff.json"}
        save(self.root / "aligned-request.json", request)
        self.plan = create_plan(self.root, self.root / "aligned-request.json")
        self.pid = self.plan["digest"]
        self.directory = run_dir(self.root, self.plan)

    def use_bottom_y_alignment(self):
        draft = self.plan["reference_preparation"]["draft_plan_digest"]
        request = {**self.request, "alignment_mode": "bottom_y",
                   "alignment_reference_frame": 1,
                   "reference_preparation_handoff":
                       f".character-image-sequence/runs/{draft}/reference-preparation-handoff.json"}
        save(self.root / "bottom-y-request.json", request)
        self.plan = create_plan(self.root, self.root / "bottom-y-request.json")
        self.pid = self.plan["digest"]
        self.directory = run_dir(self.root, self.plan)

    def shifted_transparent_board(self):
        image = Image.new("RGBA", (128, 128))
        draw = ImageDraw.Draw(image)
        for index in range(16):
            x, y = (index % 4) * 32, (index // 4) * 32
            shift = -5 if index >= 12 else 0
            draw.rectangle((x + 8, y + 7 + shift, x + 23, y + 27 + shift),
                           fill=(40 + index * 8, 80, 180, 255))
        image.save(self.root / "shifted-raw.png")
        image.save(self.root / "shifted-matte.png")

    def shifted_xy_transparent_board(self):
        image = Image.new("RGBA", (128, 128))
        draw = ImageDraw.Draw(image)
        for index in range(16):
            x, y = (index % 4) * 32, (index // 4) * 32
            shift_x = 4 if index >= 8 else 0
            shift_y = -5 if index >= 12 else 0
            draw.rectangle((x + 8 + shift_x, y + 7 + shift_y,
                            x + 23 + shift_x, y + 27 + shift_y),
                           fill=(40 + index * 8, 80, 180, 255))
        image.save(self.root / "shifted-xy-raw.png")
        image.save(self.root / "shifted-xy-matte.png")

    def assertCode(self, code, function, *args, **kwargs):
        with self.assertRaises(HarnessError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)

    def auth(self, operation="generate", **kwargs):
        return workflow.authorize(self.root, self.pid, operation, self.config_path, True, **kwargs)["id"]

    def queued(self, config, operation, name, arguments):
        self.assertEqual(name, cloud_mcp.TOOLS[operation])
        submission_files = list((self.directory / "attempts").glob("*/submission.json"))
        self.assertEqual(len(submission_files), 1)
        self.assertEqual(read(submission_files[0], 64 * 1024 * 1024)["arguments"], arguments)
        return {"structuredContent": {"submissionId": arguments["submissionId"],
            "taskId": str(uuid.uuid4()), "status": "queued", "pollAfterSeconds": 0}}

    def submit(self, auth=None, operation="generate"):
        with patch.object(cloud_mcp, "list_tools", return_value={"inputSchema": {"type": "object"}}), \
             patch.object(cloud_mcp, "call", side_effect=self.queued):
            return workflow.submit(self.root, self.pid, operation, self.config_path, auth or self.auth(operation))

    def test_plan_reproducible_and_no_network(self):
        with patch.object(cloud_mcp, "post", side_effect=AssertionError("network forbidden")):
            self.assertEqual(create_plan(self.root, self.root / "request.json"), self.plan)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main(["self-test"]), 0)
            self.assertEqual(self.plan["frame_count"], 16)
            self.assertEqual(self.plan["layout"], [4, 4])
            self.assertIn("0/16 through 15/16", self.plan["prompt"])
            self.assertIn("SAME character", self.plan["prompt"])
            self.assertIn("supporting foot contact point", self.plan["prompt"])
            self.assertIn("do not vary the bottom margin between rows", self.plan["prompt"])
            self.assertNotIn("128x128 pixel square", self.plan["prompt"])

    def test_rejects_layout_override(self):
        save(self.root / "bad.json", {**self.request, "layout": [8, 8]})
        self.assertCode("request_schema_invalid", create_plan, self.root, self.root / "bad.json")

    def test_reference_snapshot_not_live_path(self):
        self.reference.write_bytes(b"changed")
        self.assertEqual(workflow.inspect(self.root, self.pid)["plan_digest"], self.pid)

    def test_full_offline_delivery_and_alpha(self):
        self.imported()
        candidate = workflow.process(self.root, self.pid)
        self.assertEqual(candidate["frame_count"], 16)
        self.assertEqual(candidate["schema"], "character_image_candidate_v2")
        self.assertEqual(candidate["build_state"], "awaiting_semantic_review")
        self.assertTrue((self.directory / "candidate/review/light.png").is_file())
        self.assertTrue((self.directory / "candidate/review/dark.png").is_file())
        self.assertTrue((self.directory / "candidate/review/checker.png").is_file())
        frame = self.directory / "candidate/frames/00.png"
        with Image.open(frame) as im:
            self.assertEqual(im.getpixel((0, 0)), (0, 0, 0, 0))
            self.assertEqual(im.getpixel((12, 12)), (0, 0, 0, 0))
            self.assertEqual(im.getpixel((4, 10))[3], 128)
        with Image.open(self.directory / "candidate/preview.gif") as gif:
            decoded = gif.convert("RGBA")
            self.assertEqual(decoded.getpixel((4, 10))[3], 0)
            self.assertEqual(decoded.getpixel((12, 12))[3], 0)
            self.assertEqual(decoded.getpixel((6, 6))[3], 255)
        self.assertEqual(workflow.process(self.root, self.pid), candidate)
        self.assertCode("visual_review_required", workflow.deliver, self.root, self.pid, self.root / "delivery")
        self.approve("candidate")
        workflow.deliver(self.root, self.pid, self.root / "delivery")
        self.assertEqual(workflow.validate_delivery(self.root / "delivery")["frames"], 16)
        manifest = (self.root / "delivery/manifest.json").read_text()
        self.assertNotIn("attempt_id", manifest)
        self.assertNotIn("example.invalid", manifest)
        self.assertNotIn(str(self.root), manifest)
        self.assertNotIn("fixture-reviewer", manifest)
        self.assertCode("delivery_destination_exists", workflow.deliver, self.root, self.pid, self.root / "delivery")

    def test_bottom_center_alignment_preview_and_delivery_are_auditable(self):
        self.use_bottom_center_alignment()
        self.shifted_transparent_board()
        workflow.import_raw(self.root, self.pid, self.root / "shifted-raw.png")
        self.approve("raw")
        preview = workflow.preview_alignment(self.root, self.pid)
        self.assertEqual(preview["alignment"]["mode"], "bottom_center")
        self.assertEqual([item["translation"] for item in preview["alignment"]["transforms"][-4:]],
                         [[0, 5]] * 4)
        self.assertTrue((self.directory / "alignment-preview/before-gray-512.gif").is_file())
        self.assertTrue((self.directory / "alignment-preview/after-gray-512.gif").is_file())
        save(self.root / "shifted-handoff.json", {"schema": "cloud_matte_handoff_v1",
            "source_sha256": sha(self.root / "shifted-raw.png"), "producer": {"kind": "cloud_mcp"},
            "result": {"path": "shifted-matte.png", "sha256": sha(self.root / "shifted-matte.png"),
                       "bytes": (self.root / "shifted-matte.png").stat().st_size}})
        workflow.import_matte(self.root, self.pid, self.root / "shifted-handoff.json")
        candidate = workflow.process(self.root, self.pid)
        self.assertEqual(candidate["alignment"]["transforms"][-1]["translation"], [0, 5])
        self.assertEqual(len(candidate["source_frames"]), 16)
        self.assertTrue((self.directory / "candidate/unaligned-preview.gif").is_file())
        self.approve("candidate")
        workflow.deliver(self.root, self.pid, self.root / "aligned-delivery")
        self.assertTrue((self.root / "aligned-delivery/source-frames/15.png").is_file())
        self.assertEqual(workflow.validate_delivery(self.root / "aligned-delivery")["frames"], 16)

    def test_bottom_y_alignment_changes_only_vertical_translation(self):
        self.use_bottom_y_alignment()
        self.shifted_xy_transparent_board()
        workflow.import_raw(self.root, self.pid, self.root / "shifted-xy-raw.png")
        self.approve("raw")
        preview = workflow.preview_alignment(self.root, self.pid)
        self.assertEqual(preview["alignment"]["mode"], "bottom_y")
        self.assertEqual(preview["alignment"]["target_anchor"][0], None)
        self.assertTrue(all(item["translation"][0] == 0
                            for item in preview["alignment"]["transforms"]))
        self.assertEqual([item["translation"] for item in preview["alignment"]["transforms"][-4:]],
                         [[0, 5]] * 4)
        self.assertNotEqual(preview["alignment"]["transforms"][0]["output_anchor"][0],
                            preview["alignment"]["transforms"][8]["output_anchor"][0])
        save(self.root / "shifted-xy-handoff.json", {"schema": "cloud_matte_handoff_v1",
            "source_sha256": sha(self.root / "shifted-xy-raw.png"), "producer": {"kind": "cloud_mcp"},
            "result": {"path": "shifted-xy-matte.png", "sha256": sha(self.root / "shifted-xy-matte.png"),
                       "bytes": (self.root / "shifted-xy-matte.png").stat().st_size}})
        workflow.import_matte(self.root, self.pid, self.root / "shifted-xy-handoff.json")
        candidate = workflow.process(self.root, self.pid)
        self.assertEqual(candidate["alignment"]["mode"], "bottom_y")
        self.assertTrue(all(item["translation"][0] == 0
                            for item in candidate["alignment"]["transforms"]))
        self.assertTrue((self.directory / "candidate/unaligned-preview.gif").is_file())

    def test_missing_frame_fails_without_repair(self):
        self.imported(missing=True)
        self.assertCode("frame_empty", workflow.process, self.root, self.pid)
        self.assertFalse((self.directory / "candidate").exists())

    def test_crop_fails_without_normalize(self):
        self.imported(boundary=True)
        self.assertCode("frame_touches_cell_boundary", workflow.process, self.root, self.pid)

    def test_duplicate_loop_terminal_fails(self):
        self.imported(duplicate_terminal=True)
        self.assertCode("loop_terminal_pose_duplicated", workflow.process, self.root, self.pid)

    def test_opaque_matte_fails(self):
        self.assertCode("matte_not_transparent", self.imported, opaque=True)

    def test_cloud_handoff_wrong_source(self):
        matte = self.reviewed_raw()
        save(self.root / "wrong.json", {"schema": "cloud_matte_handoff_v1", "source_sha256": "0" * 64,
             "producer": {"kind": "cloud_mcp"}, "result": {"path": "matte-input.png", "sha256": sha(matte),
                                                            "bytes": matte.stat().st_size}})
        self.assertCode("cloud_handoff_source_mismatch", workflow.import_matte, self.root, self.pid, self.root / "wrong.json")

    def test_raw_review_checks_required(self):
        self.fixture()
        workflow.import_raw(self.root, self.pid, self.root / "raw-input.png")
        self.assertCode("review_checks_incomplete", workflow.review, self.root, self.pid, "raw", "approved", "x", "x", [])

    def test_rejected_review_blocks(self):
        self.fixture()
        workflow.import_raw(self.root, self.pid, self.root / "raw-input.png")
        workflow.review(self.root, self.pid, "raw", "rejected", "fixture", "wrong pose", [])
        inspected = workflow.inspect(self.root, self.pid)
        self.assertEqual(inspected["state"], "raw_rejected")
        self.assertEqual(inspected["review"]["decision"], "rejected")
        self.assertCode("visual_review_not_approved_or_stale", self.auth, "matte")

    def test_alpha_tamper_rejected(self):
        self.imported()
        workflow.process(self.root, self.pid)
        (self.directory / "candidate/frames/00.png").write_bytes(b"bad")
        self.assertCode("artifact_checksum_mismatch", self.approve, "candidate")

    def test_manifest_freshness_rejected(self):
        self.imported()
        workflow.process(self.root, self.pid)
        self.approve("candidate")
        path = self.directory / "candidate/candidate.json"
        candidate = read(path)
        candidate["duration_ms"] = 5000
        path.write_text(json.dumps(candidate))
        self.assertCode("evidence_digest_mismatch", workflow.deliver, self.root, self.pid, self.root / "delivery")

    def test_path_escape_rejected(self):
        self.assertCode("path_traversal", contained, self.root, "../escape.png")
        self.assertCode("path_outside_workspace", contained, self.root, self.root.parent / "outside.png")
        self.assertCode("path_stream_forbidden", contained, self.root, "image.png:secret")

    def test_immutable_save_publishes_complete_file_without_temp_residue(self):
        path = self.root / "atomic-evidence.json"
        save(path, {"value": 1})
        self.assertEqual(read(path), {"value": 1})
        self.assertFalse(list(self.root.glob(".atomic-evidence.json.*.tmp")))
        self.assertCode("artifact_already_exists", save, path, {"value": 2})
        self.assertEqual(read(path), {"value": 1})

    def test_symlink_rejected(self):
        link = self.root / "alias"
        try:
            link.symlink_to(self.root.parent, target_is_directory=True)
        except OSError:
            self.skipTest("OS does not grant symlink creation")
        self.assertCode("path_link_forbidden", contained, self.root, link / "anything")

    def test_authorization_confirmation_required(self):
        self.assertCode("explicit_compute_confirmation_required", workflow.authorize, self.root, self.pid,
                        "generate", self.config_path, False)

    def test_authorization_single_use(self):
        auth = self.auth()
        queued = self.submit(auth)
        self.assertEqual(queued["status"], "queued")
        self.assertCode("authorization_already_used", self.submit, auth)
        self.assertCode("prior_task_pending", self.auth)

    def test_changed_config_invalidates_authorization(self):
        auth = self.auth()
        self.config_path.write_text(json.dumps({**self.config, "timeout_seconds": 30}))
        self.assertCode("authorization_binding_mismatch", self.submit, auth)

    def test_receipt_loss_never_resubmits(self):
        auth = self.auth()
        with patch.object(cloud_mcp, "list_tools", return_value={"inputSchema": {"type": "object"}}), \
             patch.object(cloud_mcp, "call", side_effect=TimeoutError("SECRET URL")) as call:
            result = workflow.submit(self.root, self.pid, "generate", self.config_path, auth)
            self.assertEqual(result["status"], "indeterminate")
            self.assertEqual(call.call_count, 1)
            self.assertNotIn("SECRET", json.dumps(result))
        self.assertCode("fresh_user_retry_decision_required", self.auth)

    def test_matte_waits_for_raw_review(self):
        self.fixture()
        workflow.import_raw(self.root, self.pid, self.root / "raw-input.png")
        self.assertCode("visual_review_required", self.auth, "matte")

    def test_poll_only_get_task_and_persists_png(self):
        self.fixture()
        result = self.submit()
        attempt = self.directory / "attempts" / result["attempt_id"]
        receipt = read(attempt / "receipt.json")
        data = (self.root / "raw-input.png").read_bytes()
        completed = {"structuredContent": {"status": "completed", "taskId": receipt["task_id"],
                     "result": {"mimeType": "image/png", "width": 128, "height": 128, "bytes": len(data),
                                "downloadUrl": "https://example.invalid/secret?signed=secret"}},
                     "content": [{"type": "image", "mimeType": "image/png", "data": base64.b64encode(data).decode()}]}
        with patch.object(cloud_mcp, "call", return_value=completed) as call:
            polled = workflow.poll(self.root, self.pid, self.config_path, result["attempt_id"])
            self.assertEqual(polled["status"], "succeeded")
            self.assertEqual(call.call_args.args[2], "get_task")
            self.assertEqual(call.call_count, 1)
            self.assertEqual(workflow.poll(self.root, self.pid, self.config_path, result["attempt_id"])["status"], "succeeded")
            self.assertEqual(call.call_count, 1)
        self.assertEqual(sha(self.directory / "raw.png"), sha(self.root / "raw-input.png"))
        for path in self.directory.rglob("*.json"):
            self.assertNotIn("signed=secret", path.read_text())

    def test_submit_completed_inline_is_persisted_without_poll(self):
        self.fixture()
        data = (self.root / "raw-input.png").read_bytes()
        auth = self.auth()

        def completed(config, operation, name, arguments):
            return {"structuredContent": {"status": "completed", "submissionId": arguments["submissionId"],
                    "taskId": str(uuid.uuid4()), "result": {"mimeType": "image/png", "width": 128,
                    "height": 128, "bytes": len(data)}}, "content": [{"type": "image",
                    "mimeType": "image/png", "data": base64.b64encode(data).decode()}]}

        with patch.object(cloud_mcp, "list_tools", return_value={"inputSchema": {"type": "object"}}), \
             patch.object(cloud_mcp, "call", side_effect=completed) as call:
            result = workflow.submit(self.root, self.pid, "generate", self.config_path, auth)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(call.call_count, 1)
        self.assertTrue((self.directory / "raw.png").is_file())

    def test_submit_failed_inline_is_terminal(self):
        auth = self.auth()

        def failed(config, operation, name, arguments):
            return {"structuredContent": {"status": "failed", "submissionId": arguments["submissionId"],
                    "taskId": str(uuid.uuid4()), "pollAfterSeconds": 0}}

        with patch.object(cloud_mcp, "list_tools", return_value={"inputSchema": {"type": "object"}}), \
             patch.object(cloud_mcp, "call", side_effect=failed):
            result = workflow.submit(self.root, self.pid, "generate", self.config_path, auth)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["code"], "cloud_task_failed")

    def test_matte_contract_parameters(self):
        config = {**self.config, "matte_options": {"model": "Matting", "operatingResolution": "2048x2048",
                                                 "refineForeground": True}}
        args = cloud_mcp.build_arguments(self.plan, "matte", b"fixture", "image/png", config, str(uuid.uuid4()))
        self.assertIs(args["maskOnly"], False)
        self.assertEqual(args["operatingResolution"], "2048x2048")
        self.assertNotIn("provider", args)
        generation = cloud_mcp.build_arguments(self.plan, "generate", b"fixture", "image/png", config, str(uuid.uuid4()))
        self.assertEqual(set(generation), {"prompt", "referenceImage", "submissionId"})

    def test_mask_result_rejected(self):
        result = {"structuredContent": {"result": {"mimeType": "image/png", "output": "mask"}}}
        self.assertCode("cloud_mask_not_foreground", cloud_mcp.completed_png, result, "matte")

    def test_cloud_matte_completion_uses_reviewed_raw(self):
        matte = self.reviewed_raw()
        submitted = self.submit(operation="matte")
        attempt = self.directory / "attempts" / submitted["attempt_id"]
        submission = read(attempt / "submission.json", 64 * 1024 * 1024)
        self.assertEqual(base64.b64decode(submission["arguments"]["image"]["data"]),
                         (self.directory / "raw.png").read_bytes())
        self.assertIs(submission["arguments"]["maskOnly"], False)
        receipt = read(attempt / "receipt.json")
        data = matte.read_bytes()
        completed = {"structuredContent": {"status": "completed", "taskId": receipt["task_id"],
                     "result": {"mimeType": "image/png", "width": 128, "height": 128,
                                "bytes": len(data), "output": "foreground"}},
                     "content": [{"type": "image", "mimeType": "image/png", "data": base64.b64encode(data).decode()}]}
        with patch.object(cloud_mcp, "call", return_value=completed):
            self.assertEqual(workflow.poll(self.root, self.pid, self.config_path, submitted["attempt_id"])["status"], "succeeded")
        candidate = workflow.process(self.root, self.pid)
        self.assertEqual(candidate["matte_sha256"], sha(matte))
        self.assertEqual(read(self.directory / "matte-receipt.json")["source_sha256"], sha(self.directory / "raw.png"))

    def test_gif_total_duration_exact(self):
        self.assertEqual(sum(gif_ticks(1010)), 1010)
        self.assertEqual(len(gif_ticks(1010)), 16)

    def test_pose_blueprint_and_weighted_timing_are_plan_bound_and_validated(self):
        weights = [2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1]
        blueprint = [f"distinct pose responsibility {index}" for index in range(1, 17)]
        draft = self.plan["reference_preparation"]["draft_plan_digest"]
        request = {**self.request, "pose_blueprint": blueprint, "timing_weights": weights,
                   "reference_preparation_handoff":
                       f".character-image-sequence/runs/{draft}/reference-preparation-handoff.json"}
        save(self.root / "timed-request.json", request)
        self.plan = create_plan(self.root, self.root / "timed-request.json")
        self.pid = self.plan["digest"]
        self.directory = run_dir(self.root, self.plan)
        self.assertEqual(self.plan["timing_weights"], weights)
        self.assertEqual(self.plan["pose_blueprint"], blueprint)
        self.assertIn("Frame 16: distinct pose responsibility 16", self.plan["prompt"])
        ticks = gif_ticks(self.plan["duration_ms"], weights)
        self.assertEqual(sum(ticks), self.plan["duration_ms"])
        self.assertGreater(ticks[0], ticks[1])
        self.imported()
        candidate = workflow.process(self.root, self.pid)
        self.assertEqual(candidate["timing_weights"], weights)
        self.assertNotEqual(candidate["frames"][0]["duration_seconds"],
                            candidate["frames"][1]["duration_seconds"])

    def test_one_shot_includes_terminal_and_gif_does_not_loop(self):
        save(self.root / "one-shot.json", {**self.request, "loop": False})
        self.plan = create_plan(self.root, self.root / "one-shot.json")
        workflow.review(self.root, self.plan["digest"], "reference", "approved", "fixture", "Checked fixture cutout",
                        workflow.REVIEW_CHECKS["reference"])
        self.plan = create_plan(self.root, self.root / "one-shot.json")
        self.pid = self.plan["digest"]
        self.directory = run_dir(self.root, self.plan)
        self.imported(duplicate_terminal=True)
        candidate = workflow.process(self.root, self.pid)
        self.assertEqual(candidate["frames"][-1]["action_phase"], [1, 1])
        with Image.open(self.directory / "candidate/preview.gif") as im:
            self.assertNotIn("loop", im.info)

    def test_square_cloud_output_size_may_differ_from_plan(self):
        submitted = self.submit()
        attempt = self.directory / "attempts" / submitted["attempt_id"]
        receipt = read(attempt / "receipt.json")
        data = self.reference.read_bytes()
        result = {"structuredContent": {"status": "completed", "taskId": receipt["task_id"],
                  "result": {"mimeType": "image/png", "width": 32, "height": 32, "bytes": len(data)}},
                  "content": [{"type": "image", "mimeType": "image/png", "data": base64.b64encode(data).decode()}]}
        with patch.object(cloud_mcp, "call", return_value=result) as call:
            polled = workflow.poll(self.root, self.pid, self.config_path, submitted["attempt_id"])
            self.assertEqual(polled["status"], "succeeded")
            self.assertEqual(call.call_count, 1)
        self.assertTrue((self.directory / "raw.png").exists())
        self.assertTrue((attempt / "result.png").exists())

    def test_non_square_cloud_output_is_terminal_failure(self):
        submitted = self.submit()
        attempt = self.directory / "attempts" / submitted["attempt_id"]
        receipt = read(attempt / "receipt.json")
        image = Image.new("RGB", (64, 32), "white")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        data = buffer.getvalue()
        result = {"structuredContent": {"status": "completed", "taskId": receipt["task_id"],
                  "result": {"mimeType": "image/png", "width": 64, "height": 32, "bytes": len(data)}},
                  "content": [{"type": "image", "mimeType": "image/png",
                               "data": base64.b64encode(data).decode()}]}
        with patch.object(cloud_mcp, "call", return_value=result):
            polled = workflow.poll(self.root, self.pid, self.config_path, submitted["attempt_id"])
        self.assertEqual(polled["status"], "failed")
        self.assertEqual(polled["reason"], "board_aspect_ratio_mismatch")

    def test_arbitrary_square_board_is_normalized_once_before_slicing(self):
        matte = Image.new("RGBA", (132, 132), (0, 0, 0, 0))
        draw = ImageDraw.Draw(matte)
        for i in range(16):
            x, y = (i % 4) * 33, (i // 4) * 33
            draw.rectangle((x + 6, y + 6, x + 25, y + 27),
                           fill=(30 + i * 8, 80, 190 - i * 5, 255))
        matte_path = self.root / "matte-132.png"
        matte.save(matte_path)
        raw = Image.new("RGBA", matte.size, "white")
        raw.alpha_composite(matte)
        raw_path = self.root / "raw-132.png"
        raw.convert("RGB").save(raw_path)
        workflow.import_raw(self.root, self.pid, raw_path)
        self.approve("raw")
        save(self.root / "handoff-132.json", {"schema": "cloud_matte_handoff_v1",
             "source_sha256": sha(raw_path), "producer": {"kind": "cloud_mcp"},
             "result": {"path": "matte-132.png", "sha256": sha(matte_path),
                        "bytes": matte_path.stat().st_size}})
        workflow.import_matte(self.root, self.pid, self.root / "handoff-132.json")
        candidate = workflow.process(self.root, self.pid)
        self.assertEqual(candidate["source_board_dimensions"], [132, 132])
        self.assertEqual(candidate["canonical_board_dimensions"], [128, 128])
        self.assertEqual(candidate["normalization"], "whole_board_lanczos_to_canonical_square")

    def test_query_failure_preserves_receipt_and_only_requeries(self):
        submitted = self.submit()
        attempt = self.directory / "attempts" / submitted["attempt_id"]
        receipt = read(attempt / "receipt.json")
        with patch.object(cloud_mcp, "call", side_effect=HarnessError("mcp_transport_or_response_error")) as call:
            self.assertCode("mcp_transport_or_response_error", workflow.poll, self.root, self.pid,
                            self.config_path, submitted["attempt_id"])
            self.assertEqual(call.call_args.args[2], "get_task")
        self.assertFalse((attempt / "terminal.json").exists())
        with patch.object(cloud_mcp, "call", return_value={"structuredContent": {
            "taskId": receipt["task_id"], "status": "running", "pollAfterSeconds": 5
        }}) as call:
            self.assertEqual(workflow.poll(self.root, self.pid, self.config_path, submitted["attempt_id"])["status"], "running")
            self.assertEqual(workflow.poll(self.root, self.pid, self.config_path, submitted["attempt_id"])["status"], "waiting")
            self.assertEqual(call.call_count, 1)

    def test_publish_crash_reconciles_local_receipt_without_cloud(self):
        self.fixture()
        submitted = self.submit()
        attempt = self.directory / "attempts" / submitted["attempt_id"]
        sub = read(attempt / "submission.json", 64 * 1024 * 1024)
        workflow.store_image(self.root, self.plan, "raw", (self.root / "raw-input.png").read_bytes(), {
            "origin": "cloud_mcp", "attempt_id": submitted["attempt_id"],
            "source_sha256": sub["binding"]["input_sha256"]})
        with patch.object(cloud_mcp, "call", side_effect=AssertionError("network forbidden")):
            self.assertEqual(workflow.poll(self.root, self.pid, self.config_path, submitted["attempt_id"])["status"], "succeeded")

    def test_symlink_detection_does_not_need_os_privilege(self):
        real = Path.is_symlink
        with patch.object(Path, "is_symlink", lambda p: p.name == "alias" or real(p)):
            self.assertCode("path_link_forbidden", contained, self.root, "alias/image.png")

    def test_doctor_redacts_config(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"TEST_IMAGE_MCP_KEY": "private-test-secret"}), contextlib.redirect_stdout(output):
            self.assertEqual(main(["doctor", "--root", str(self.root), "--config", str(self.config_path),
                                   "--operation", "generate"]), 0)
        self.assertNotIn("private-test-secret", output.getvalue())
        self.assertNotIn("example.invalid", output.getvalue())
        self.assertNotIn(str(self.root), output.getvalue())

    def test_reference_opaque_requires_cloud_and_blocks_generation(self):
        Image.new("RGB", (32, 32), "white").save(self.root / "opaque.png")
        save(self.root / "opaque-request.json", {**self.request, "reference": "opaque.png"})
        draft = create_plan(self.root, self.root / "opaque-request.json")
        self.assertIsNone(draft["reference_preparation"])
        self.assertTrue(draft["reference_needs_cloud_matte"])
        self.assertCode("review_reference_then_replan_required", workflow.authorize, self.root, draft["digest"],
                        "generate", self.config_path, True)

    def test_reference_alpha_channel_alone_does_not_skip_cloud(self):
        Image.new("RGBA", (32, 32), (255, 255, 255, 255)).save(self.root / "opaque-alpha.png")
        save(self.root / "opaque-alpha-request.json", {**self.request, "reference": "opaque-alpha.png"})
        draft = create_plan(self.root, self.root / "opaque-alpha-request.json")
        self.assertTrue(draft["reference_needs_cloud_matte"])

    def test_prepared_reference_skips_cloud_and_binds_original(self):
        binding = self.plan["reference_preparation"]
        self.assertIsNotNone(binding)
        draft_path = self.root / ".character-image-sequence/plans" / (binding["draft_plan_digest"] + ".json")
        draft = read(draft_path)
        self.assertFalse(draft["reference_needs_cloud_matte"])
        self.assertEqual(self.plan["reference"]["sha256"], self.plan["original_reference"]["sha256"])
        handoff = read(self.root / ".character-image-sequence/runs" / draft["digest"] / "reference-preparation-handoff.json")
        self.assertEqual(handoff["schema_version"], "ai_reference_preparation_handoff_v1")
        self.assertEqual(handoff["producer"]["version"], __version__)
        self.assertEqual(handoff["handoff_sha256"], binding["handoff_sha256"])
        self.assertCode("reference_already_cutout_review_and_replan", workflow.authorize, self.root, draft["digest"],
                        "reference-matte", self.config_path, True)

    def test_reference_cloud_preparation_replans_with_foreground(self):
        Image.new("RGB", (32, 32), "white").save(self.root / "opaque.png")
        save(self.root / "opaque-request.json", {**self.request, "reference": "opaque.png"})
        self.plan = create_plan(self.root, self.root / "opaque-request.json")
        self.pid = self.plan["digest"]
        self.directory = run_dir(self.root, self.plan)
        submitted = self.submit(operation="reference-matte")
        attempt = self.directory / "attempts" / submitted["attempt_id"]
        receipt = read(attempt / "receipt.json")
        data = self.reference.read_bytes()
        result = {"structuredContent": {"status": "completed", "taskId": receipt["task_id"],
                  "result": {"mimeType": "image/png", "width": 32, "height": 32,
                             "bytes": len(data), "output": "foreground"}},
                  "content": [{"type": "image", "mimeType": "image/png", "data": base64.b64encode(data).decode()}]}
        with patch.object(cloud_mcp, "call", return_value=result):
            self.assertEqual(workflow.poll(self.root, self.pid, self.config_path, submitted["attempt_id"])["status"], "succeeded")
        self.assertIsNone(create_plan(self.root, self.root / "opaque-request.json")["reference_preparation"])
        self.approve("reference")
        final = create_plan(self.root, self.root / "opaque-request.json")
        self.assertNotEqual(final["digest"], self.pid)
        self.assertEqual(final["reference"]["sha256"], sha(self.reference))
        self.assertEqual(final["original_reference"]["sha256"], sha(self.root / "opaque.png"))
        auth = workflow.authorize(self.root, final["digest"], "generate", self.config_path, True)
        self.assertEqual(auth["binding"]["input_sha256"], sha(self.reference))

    def test_reference_preparation_tamper_blocks_generation(self):
        binding = self.plan["reference_preparation"]
        path = self.root / ".character-image-sequence/runs" / binding["draft_plan_digest"] / "reference-preparation-report.json"
        path.write_text('{}')
        self.assertCode("reference_preparation_changed", self.auth)

    def test_reviewed_reference_handoff_reused_across_motion_plans(self):
        binding = self.plan["reference_preparation"]
        handoff = (f".character-image-sequence/runs/{binding['draft_plan_digest']}/"
                   "reference-preparation-handoff.json")
        request = {**self.request, "motion": "A different readable action",
                   "reference_preparation_handoff": handoff}
        save(self.root / "reused-reference.json", request)
        reused = create_plan(self.root, self.root / "reused-reference.json")
        self.assertIsNotNone(reused["reference_preparation"])
        self.assertEqual(reused["reference_preparation"]["handoff_sha256"],
                         binding["handoff_sha256"])
        self.assertEqual(reused["reference"]["sha256"], self.plan["reference"]["sha256"])

    def test_probe_lists_tools_without_business_submission(self):
        tool = {"name": "imagegen", "inputSchema": {"type": "object"}}
        with patch.object(cloud_mcp, "list_tools", return_value=tool) as call:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = main(["probe", "--root", str(self.root), "--config", str(self.config_path),
                             "--operation", "generate"])
        self.assertEqual(code, 0)
        self.assertEqual(call.call_count, 1)
        self.assertEqual(json.loads(output.getvalue())["business_submissions"], 0)

    def test_transparent_webp_reused_without_cloud(self):
        with Image.open(self.reference) as image:
            image.save(self.root / "cutout.webp", lossless=True)
        save(self.root / "webp-request.json", {**self.request, "reference": "cutout.webp"})
        draft = create_plan(self.root, self.root / "webp-request.json")
        self.assertFalse(draft["reference_needs_cloud_matte"])
        with patch.object(cloud_mcp, "call", side_effect=AssertionError("no cloud")):
            workflow.prepare_reference(self.root, draft["digest"])
            workflow.review(self.root, draft["digest"], "reference", "approved", "fixture", "Inspected normalized PNG",
                            workflow.REVIEW_CHECKS["reference"])
            final = create_plan(self.root, self.root / "webp-request.json")
        self.assertEqual(final["original_reference"]["mime"], "image/webp")
        self.assertEqual(final["reference"]["mime"], "image/png")

    def test_no_local_removal_for_opaque_reference(self):
        save(self.root / "cloud-request.json", {**self.request, "reference_mode": "cloud"})
        draft = create_plan(self.root, self.root / "cloud-request.json")
        self.assertCode("reference_cloud_matte_required", workflow.prepare_reference, self.root, draft["digest"])


if __name__ == "__main__":
    unittest.main()
