"""Native compiler coverage for the consumer's ProgressBar and ScrollView.

The inputs and pixels come from the existing deterministic consumer fixtures;
this test never contacts a provider or edits a checked-in sample.
"""
import copy
import io
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from ai_ui_decomposition import batch
from ai_ui_decomposition.acceptance_execution import AcceptanceExecution
from ai_ui_decomposition.adapter import export_request, import_result, seal_result
from ai_ui_decomposition.common import read_json
from ai_ui_decomposition.delivery_adapter import compile_delivery, prepare_handoff
from ai_ui_decomposition.handoff_build import build_handoff
from test_native_delivery import native_fixture


class NativeScrollProgressTests(unittest.TestCase):
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

    def _case(self, kind):
        fixture = self.root / "fixtures" / kind
        request, raws = native_fixture(fixture)
        if kind == "ProgressBar":
            # The fixture's 220x14 fill is a thin-control; one-pixel authored
            # board padding keeps its measured support aspect within the
            # existing relative-cell extractor tolerance.
            request["boardPolicies"]["progressbar"]["target_padding"] = 1
        if kind == "ScrollView":
            # The standard spacing entry gate intentionally requires the
            # supported one-List content model. Compose that child from the
            # existing deterministic List fixture in this temporary request;
            # no checked-in sample is changed.
            list_fixture = self.root / "fixtures" / "List"
            list_request, list_raws = native_fixture(list_fixture)
            scroll = next(node for node in self._walk(request["document"]["root"])
                          if node["type"] == "ScrollView")
            source_list = next(node for node in self._walk(list_request["document"]["root"])
                               if node["type"] == "List")
            list_node = copy.deepcopy(source_list)
            list_node["id"] = "scroll-list"
            list_node["layout"] = {"x": 0, "y": 0, "width": 200, "height": 100}
            scroll["children"] = [list_node]
            scroll["props"]["contentHeight"] = 240
            request["capabilities"] = [
                row for row in request["capabilities"]
                if row["id"] != "scroll-content-marker"
            ]
            request["acceptanceScope"]["components"] = [
                row for row in request["acceptanceScope"]["components"]
                if row["componentId"] != "scroll-content-marker"
            ]
            list_binding = copy.deepcopy(next(
                binding for binding in list_request["appearance"]["bindings"]
                if binding["componentType"] == "List"
            ))
            list_binding["componentId"] = list_node["id"]
            request["appearance"]["bindings"].append(list_binding)
            for row in list_request["materials"]:
                if row["componentId"] != source_list["id"]:
                    continue
                copied = copy.deepcopy(row)
                copied["componentId"] = list_node["id"]
                copied["rect"][0] = scroll["layout"]["x"] + list_node["layout"]["x"] + (row["rect"][0] - source_list["layout"]["x"])
                copied["rect"][1] = scroll["layout"]["y"] + list_node["layout"]["y"] + (row["rect"][1] - source_list["layout"]["y"])
                request["materials"].append(copied)
                raws[copied["layerId"]] = list_raws[copied["layerId"]]
            request["boardPolicies"]["list"] = copy.deepcopy(list_request["boardPolicies"]["list"])
            request["boardPolicies"]["scrollview"]["target_padding"] = 1
            request["capabilities"].append({"id": list_node["id"], "type": "List", "profiles": ["base"]})
            list_state = copy.deepcopy(next(
                row for row in list_request["referenceState"]["components"]
                if row["componentId"] == source_list["id"]
            ))
            list_state["componentId"] = list_node["id"]
            request["referenceState"]["components"].append(list_state)
            request["acceptanceScope"]["components"].append({
                "componentId": list_node["id"], "mode": "compare",
                "reason": "Synthetic List child for the explicit ScrollView spacing gate",
            })
            list_evidence = copy.deepcopy(list_request["stateEvidence"]["components"][source_list["id"]])
            request["stateEvidence"]["components"][list_node["id"]] = list_evidence
            for spec in list_request["visualObservations"]["texts"]:
                observed = copy.deepcopy(spec)
                observed["componentId"] = list_node["id"]
                request["visualObservations"]["texts"].append(observed)
            request["layoutSpacing"]["scrollBottomSpaces"] = [{
                "componentId": scroll["id"], "bottomWhitespace": 140,
                "reason": "Synthetic explicit bottom-space decision for the List child",
            }]
            # The fixture track intentionally has decorative top/bottom
            # whitespace.  Use a deterministic full-height local track for
            # this materialization test so the existing long-control board
            # extractor sees the declared 10x100 target geometry.
            track = Image.new("RGBA", (10, 100), (248, 8, 248, 255))
            ImageDraw.Draw(track).rectangle((2, 0, 7, 99), fill=(32, 64, 96, 255))
            encoded = io.BytesIO()
            track.save(encoded, format="PNG")
            raws["scroll-track"] = encoded.getvalue()
        return fixture, request, raws

    def _compile_and_import(self, kind):
        fixture, request, raws = self._case(kind)
        out = self.root / ("delivery-" + kind)
        out.mkdir()
        compiled = out / "compiled"
        compile_delivery(fixture / "reference.png", request, compiled, self.consumer, 8)

        capability = read_json(compiled / "capability-check.json")
        self.assertEqual(capability["status"], "capability_supported")
        self.assertIn(kind, {row["componentType"] for row in capability["checks"]})

        batch.freeze(
            compiled / "plan.json", out / "generation", "one",
            capability_request=compiled / "capabilities.json",
            component_document=compiled / "semantic-document.json",
            layout_spacing=compiled / "layout-spacing.json",
        )
        run = out / "generation" / "runs" / "one"
        for asset in read_json(compiled / "plan.json")["assets"]:
            key = asset["id"]
            bundle = out / ("request-" + key)
            export_request(run, key, bundle)
            if key.startswith("board-"):
                board = read_json(compiled / ("strategy-" + key[6:] + ".json"))["boards"][0]
                image = Image.new("RGB", board["canvas"], "#F808F8")
                for slot in board["slots"]:
                    part = Image.open(io.BytesIO(raws[slot["asset_id"]])).convert("RGBA")
                    left, top, right, bottom = slot["search_window"]
                    image.paste(part, ((left + right - part.width) // 2,
                                       (top + bottom - part.height) // 2), part)
            else:
                image = Image.open(io.BytesIO(raws[key])).convert("RGB")
            path = out / (key + ".png")
            image.save(path)
            seal_result(bundle, path)
            import_result(run, bundle)

        build = prepare_handoff(compiled, run, out / "prepared", self.consumer)
        build_handoff(build, self.consumer, out / "handoff", AcceptanceExecution(90))

        source = out / "handoff" / "acceptance-inputs" / "source.zip"
        official = out / "official-consumer-output.json"
        result = subprocess.run(
            [
                "node",
                str(self.consumer / "scripts" / "cli.mjs"),
                "component-handoff",
                str(source),
                "--output",
                str(official),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        imported = read_json(official, max_bytes=64_000_000)
        node = next(
            node for node in self._walk(imported["document"]["root"])
            if node["type"] == kind
        )
        self.assertIn("appearance", node["props"])
        return compiled, request, imported

    @staticmethod
    def _walk(node):
        yield node
        for child in node.get("children", []):
            yield from NativeScrollProgressTests._walk(child)

    def test_progress_bar_compiles_and_official_consumer_imports(self):
        compiled, request, imported = self._compile_and_import("ProgressBar")
        node = next(n for n in self._walk(imported["document"]["root"])
                    if n["type"] == "ProgressBar")
        self.assertEqual(node["props"]["appearance"]["fillSource"], "full-range-template")
        self.assertEqual(
            request["appearance"]["bindings"][1]["states"]["progressBar"]["sourceState"],
            "full-range-template",
        )
        self.assertEqual(read_json(compiled / "capability-check.json")["status"],
                         "capability_supported")

    def test_scroll_view_compiles_and_official_consumer_imports(self):
        compiled, request, imported = self._compile_and_import("ScrollView")
        node = next(n for n in self._walk(imported["document"]["root"])
                    if n["type"] == "ScrollView")
        appearance = node["props"]["appearance"]
        self.assertEqual(appearance["sourceCanvas"], {"width": 200, "height": 120})
        self.assertEqual(appearance["scrollbarTrack"]["canvas"],
                         {"width": 10, "height": 100})
        self.assertEqual(appearance["scrollbarThumbCanvas"],
                         {"width": 10, "height": 20})
        self.assertEqual(appearance["scrollbarThumbPositions"], {
            "min": {"x": 180, "y": 10}, "max": {"x": 180, "y": 80},
        })
        binding = request["appearance"]["bindings"][1]
        self.assertEqual(
            {part["role"] for part in binding["parts"]},
            {"viewport", "scrollbar-track", "scrollbar-thumb"},
        )
        ownership = read_json(compiled / "material-ownership.json")
        self.assertTrue(all(
            row["surface"]
            for row in ownership["layers"]
            if row["role"] in {"viewport", "scrollbar-track", "scrollbar-thumb"}
        ))

    def test_progress_bar_rejects_missing_material_and_illegal_state(self):
        fixture, request, _raws = self._case("ProgressBar")
        missing = copy.deepcopy(request)
        fill_layer = next(part["layerId"] for part in request["appearance"]["bindings"][1]["parts"]
                          if part["role"] == "fill")
        missing["materials"] = [
            row for row in missing["materials"]
            if row["layerId"] != fill_layer
        ]
        with self.assertRaisesRegex(ValueError, "NATIVE_LAYER_UNKNOWN"):
            compile_delivery(fixture / "reference.png", missing,
                             self.root / "invalid-progress-material", self.consumer, 8)

        illegal = copy.deepcopy(request)
        illegal["appearance"]["bindings"][1]["states"]["progressBar"]["sourceState"] = "current-value"
        with self.assertRaisesRegex(ValueError, "NATIVE_PROGRESS_FULL_RANGE_TEMPLATE"):
            compile_delivery(fixture / "reference.png", illegal,
                             self.root / "invalid-progress-state", self.consumer, 8)

    def test_scroll_view_rejects_missing_material_and_illegal_state(self):
        fixture, request, _raws = self._case("ScrollView")
        missing = copy.deepcopy(request)
        thumb_layer = next(part["layerId"] for part in request["appearance"]["bindings"][1]["parts"]
                           if part["role"] == "scrollbar-thumb")
        missing["materials"] = [
            row for row in missing["materials"]
            if row["layerId"] != thumb_layer
        ]
        with self.assertRaisesRegex(ValueError, "NATIVE_LAYER_UNKNOWN"):
            compile_delivery(fixture / "reference.png", missing,
                             self.root / "invalid-scroll-material", self.consumer, 8)

        illegal = copy.deepcopy(request)
        positions = illegal["appearance"]["bindings"][1]["states"]["scrollView"]["thumbPositions"]
        positions["max"]["x"] += 1
        with self.assertRaisesRegex(ValueError, "NATIVE_SCROLL_AXIS"):
            compile_delivery(fixture / "reference.png", illegal,
                             self.root / "invalid-scroll-state", self.consumer, 8)


if __name__ == "__main__":
    unittest.main()
