"""Offline integration coverage for reviewed transparent board recovery."""

import copy
import io
from pathlib import Path
import subprocess
import tempfile
import unittest

from PIL import Image

from ai_ui_decomposition import batch
from ai_ui_decomposition.adapter import export_request, import_result, seal_result
from ai_ui_decomposition.common import read_json, sha256
from ai_ui_decomposition.delivery_adapter import compile_delivery
from ai_ui_decomposition.handoff_build import build_handoff
from ai_ui_decomposition.acceptance_execution import AcceptanceExecution
from ai_ui_decomposition.material_preflight import check_batch
from ai_ui_decomposition.reviewed_recovery import prepare
from test_native_delivery import native_fixture


def _walk(node):
    yield node
    for child in node.get("children", []):
        yield from _walk(child)


class ReviewedRecoveryIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.consumer = Path(__file__).resolve().parents[2] / "ui-component-harness"
        subprocess.run(
            [
                "node",
                str(Path(__file__).with_name("stateful-fixtures.mjs")),
                str(cls.consumer),
                str(cls.root / "fixtures"),
            ],
            check=True,
            capture_output=True,
            text=True,
        )

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _context(self, name):
        fixture = self.root / "fixtures" / "CheckBox"
        request, raws = native_fixture(fixture)
        request["boardPolicies"]["checkbox"] = {
            "version": "1.1",
            "mode": "foreground-gap-row",
            "target_padding": 2,
            "canvas_policy": "content-bounds",
            "max_internal_gap_ratio": 0.08,
            "max_part_aspect_error": 0.5,
        }
        out = self.root / name
        out.mkdir()
        reference = out / "reference.png"
        with Image.open(fixture / "reference.png") as picture:
            picture.convert("RGBA").save(reference)
        request["referenceSha256"] = sha256(reference)
        compiled = out / "compiled"
        compile_delivery(reference, request, compiled, self.consumer, 8)
        batch.freeze(
            compiled / "plan.json",
            out / "generation",
            "one",
            capability_request=compiled / "capabilities.json",
            component_document=compiled / "semantic-document.json",
            layout_spacing=compiled / "layout-spacing.json",
            material_preflight="after-generation-v1",
        )
        run = out / "generation" / "runs" / "one"
        regions = None
        for asset in read_json(compiled / "plan.json")["assets"]:
            key = asset["id"]
            bundle = out / ("request-" + key)
            export_request(run, key, bundle)
            if key == "board-checkbox":
                strategy = read_json(compiled / "strategy-checkbox.json")
                board = strategy["boards"][0]
                image = Image.new("RGBA", tuple(board["canvas"]), (17, 29, 41, 0))
                regions = {}
                for slot in board["slots"]:
                    part = Image.open(io.BytesIO(raws[slot["asset_id"]])).convert("RGBA")
                    left, top, right, bottom = slot["search_window"]
                    x = (left + right - part.width) // 2
                    y = (top + bottom - part.height) // 2
                    image.alpha_composite(part, (x, y))
                    region = [x - 1, y - 1, part.width + 2, part.height + 2]
                    self.assertGreaterEqual(region[0], 0)
                    self.assertGreaterEqual(region[1], 0)
                    self.assertLessEqual(region[0] + region[2], image.width)
                    self.assertLessEqual(region[1] + region[3], image.height)
                    regions[slot["asset_id"]] = region
                # Keep the deliberately non-key transparent perimeter.  The
                # alpha-aware review may preserve it, while the original
                # keyed board gate must record the unresolved extraction.
                pixels = image.load()
                for y in range(image.height):
                    for x in range(image.width):
                        if pixels[x, y][3] == 0:
                            pixels[x, y] = (17, 29, 41, 0)
                self.assertEqual(image.getchannel("A").getextrema(), (0, 255))
            else:
                image = Image.open(io.BytesIO(raws[key])).convert("RGB")
            path = out / (key + ".png")
            image.save(path)
            seal_result(bundle, path)
            import_result(run, bundle)

        report = check_batch(compiled, run, out / "material-preflight.json")
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["failed"], 1)
        board_row = next(row for row in report["materials"] if row["asset"] == "board-checkbox")
        self.assertIn("BOARD_KEY_BACKGROUND_REQUIRED", board_row["errors"])
        board_entry = read_json(run / "batch.json")["requests"]["board-checkbox"]
        board_raw = run / "requests" / board_entry["id"] / "raw.png"
        specification = {
            "version": "1.0",
            "batchDigest": read_json(run / "batch.json")["digest"],
            "revisions": {
                "board-checkbox": {
                    "kind": "board-regions",
                    "rawSha256": sha256(board_raw),
                    "reason": "Reviewed transparent board regions preserve the received alpha canvas.",
                    "sourceRegions": regions,
                    "sourceAlpha": "preserve",
                }
            },
        }
        return out, compiled, run, specification, board_raw

    def test_transparent_board_recovery_imports_officially_and_preserves_failed_quality(self):
        out, compiled, run, specification, board_raw = self._context("success")
        quality = run / "requests" / read_json(run / "batch.json")["requests"]["board-checkbox"]["id"] / "quality.json"
        quality_sha = sha256(quality)
        received = read_json(quality.parent / "received.json")
        self.assertEqual(received["kind"], "ai_ui_decomposition_request_received_v1")

        recovery = out / "recovery"
        build_plan = prepare(compiled, run, specification, recovery, self.consumer)
        revision = read_json(recovery / "board-checkbox" / "extraction-revision.json")
        self.assertEqual(revision["version"], "1.1")
        self.assertEqual(revision["sourceAlpha"], "preserve")
        self.assertEqual(sha256(quality), quality_sha)
        self.assertEqual(read_json(quality)["status"], "failed")

        official = out / "official"
        build_handoff(build_plan, self.consumer, official, AcceptanceExecution(90))
        consumed = read_json(official / "consumed.json", max_bytes=64 * 1024 * 1024)
        checkbox = next(node for node in _walk(consumed["document"]["root"]) if node["type"] == "CheckBox")
        self.assertIn("appearance", checkbox["props"])

        lineage = read_json(recovery / "recovery-lineage.json")
        self.assertEqual(lineage["generationCalls"], 0)
        board_lineage = next(row for row in lineage["sources"] if row["asset"] == "board-checkbox")
        self.assertEqual(board_lineage["originalQualityStatus"], "failed")
        self.assertEqual(board_lineage["originalQualitySha256"], quality_sha)
        self.assertEqual(read_json(quality.parent / "received.json")["kind"], "ai_ui_decomposition_request_received_v1")
        self.assertEqual(batch.state(run, read_json(run / "batch.json")["requests"]["board-checkbox"]), "received")
        materialized = read_json(recovery / "workspace" / "runs" / "materialized" / "batch.json")
        self.assertEqual(materialized["maximum_calls"], 0)
        self.assertFalse(materialized["provider_invocation_included"])
        self.assertEqual(board_raw.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

    def test_raw_tampering_is_rejected_before_reviewed_materialization(self):
        out, compiled, run, specification, board_raw = self._context("raw-tamper")
        board_raw.write_bytes(board_raw.read_bytes() + b"tampered")
        with self.assertRaisesRegex(ValueError, "MATERIAL_QUALITY_CHANGED"):
            prepare(compiled, run, specification, out / "recovery", self.consumer)
        self.assertFalse((out / "recovery" / "recovery-lineage.json").exists())

    def test_source_region_tampering_is_rejected_by_alpha_geometry(self):
        out, compiled, run, specification, _board_raw = self._context("region-tamper")
        tampered = copy.deepcopy(specification)
        region = tampered["revisions"]["board-checkbox"]["sourceRegions"]["checkbox-box"]
        region[0] += 2
        region[2] -= 2
        with self.assertRaisesRegex(ValueError, "BOARD_SOURCE_REGIONS_ALPHA_EDGE"):
            prepare(compiled, run, tampered, out / "recovery", self.consumer)
        self.assertFalse((out / "recovery" / "recovery-lineage.json").exists())


if __name__ == "__main__":
    unittest.main()
