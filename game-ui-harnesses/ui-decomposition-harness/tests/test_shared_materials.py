"""Offline native Image sharing regressions; no provider or media generation."""
import copy
import io
from pathlib import Path
import subprocess
import tempfile
import unittest

from PIL import Image, ImageDraw

from ai_ui_decomposition import batch
from ai_ui_decomposition.adapter import export_request, import_result, seal_result
from ai_ui_decomposition.common import read_json, sha256
from ai_ui_decomposition.delivery_adapter import compile_delivery, prepare_handoff
from test_native_delivery import native_fixture


def add_coin_images(request, raws):
    root = request["document"]["root"]
    style = copy.deepcopy(root["props"]["style"])
    canvas_width = request["document"]["canvas"]["width"]
    rows = []
    for index, component_id in enumerate(("coin-source", "coin-copy-a", "coin-copy-b")):
        x, y = 16 + index * 40, 16
        node = dict(id=component_id, type="Image",
                    layout=dict(x=x, y=y, width=24, height=24),
                    props=dict(source=f"layers/{component_id}.png", fit="contain",
                               drawBackground=False, style=copy.deepcopy(style)))
        if x + 24 > canvas_width:
            raise AssertionError("synthetic coin fixture does not fit canvas")
        root["children"].append(node)
        request["capabilities"].append(dict(id=component_id, type="Image", profiles=["base"]))
        request["appearance"]["bindings"].append(dict(
            componentId=component_id, componentType="Image",
            parts=[dict(role="image", layerId=component_id)]))
        request["acceptanceScope"]["components"].append(dict(
            componentId=component_id, mode="compare", reason="Synthetic shared-image fixture"))
        material = dict(layerId=component_id, componentId=component_id,
                        rect=[x, y, 24, 24], description="Procedural semantic coin icon",
                        groupId="icons")
        if component_id != "coin-source":
            material["sharedSource"] = dict(
                version="1.0", sourceLayerId="coin-source",
                evidence="All three reference instances show the same coin symbol.")
        rows.append(material)
        if component_id == "coin-source":
            picture = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
            draw = ImageDraw.Draw(picture)
            draw.ellipse((2, 2, 21, 21), fill=(220, 170, 40, 255))
            draw.ellipse((7, 7, 16, 16), outline=(90, 55, 8, 255), width=2)
            output = io.BytesIO()
            picture.save(output, format="PNG")
            raws[component_id] = output.getvalue()
    request["materials"].extend(rows)
    request["boardPolicies"]["icons"] = dict(
        version="1.0", mode="relative-cell", target_padding=2,
        max_canvas_aspect_error=0.15)


class SharedNativeImageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.consumer = Path(__file__).resolve().parents[2] / "ui-component-harness"
        subprocess.run([
            "node", str(Path(__file__).with_name("stateful-fixtures.mjs")),
            str(cls.consumer), str(cls.root / "fixtures")], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_identical_images_share_one_generated_source_in_both_handoff_paths(self):
        fixture = self.root / "fixtures" / "CheckBox"
        request, raws = native_fixture(fixture)
        add_coin_images(request, raws)
        out = self.root / "shared"
        compiled = out / "compiled"
        compile_delivery(fixture / "reference.png", request, compiled, self.consumer, 8)

        plan = read_json(compiled / "plan.json")
        catalog = read_json(compiled / "material-catalog.json")
        strategy = read_json(compiled / "strategy-icons.json")
        self.assertEqual({slot["asset_id"] for slot in strategy["boards"][0]["slots"]},
                         {"coin-source"})
        self.assertNotIn("coin-copy-a", {asset["id"] for asset in plan["assets"]})
        self.assertNotIn("coin-copy-b", {asset["id"] for asset in plan["assets"]})
        coin_rows = {row["layerId"]: row for row in catalog["parts"]
                     if row["layerId"].startswith("coin-")}
        self.assertEqual(coin_rows["coin-copy-a"]["generationAsset"],
                         coin_rows["coin-source"]["generationAsset"])
        self.assertEqual(coin_rows["coin-copy-b"]["generationAsset"],
                         coin_rows["coin-source"]["generationAsset"])
        self.assertEqual(coin_rows["coin-copy-a"]["rect"], [56, 16, 24, 24])
        self.assertEqual(coin_rows["coin-copy-b"]["rect"], [96, 16, 24, 24])

        batch.freeze(compiled / "plan.json", out / "generation", "one",
                     capability_request=compiled / "capabilities.json",
                     component_document=compiled / "semantic-document.json",
                     layout_spacing=compiled / "layout-spacing.json")
        run = out / "generation" / "runs" / "one"
        for asset in plan["assets"]:
            key = asset["id"]
            bundle = out / "requests" / key
            export_request(run, key, bundle)
            if key.startswith("board-"):
                group = key[6:]
                board = read_json(compiled / f"strategy-{group}.json")["boards"][0]
                image = Image.new("RGB", board["canvas"], "#F808F8")
                for slot in board["slots"]:
                    part = Image.open(io.BytesIO(raws[slot["asset_id"]])).convert("RGBA")
                    left, top, right, bottom = slot["search_window"]
                    position = ((left + right - part.width) // 2,
                                (top + bottom - part.height) // 2)
                    image.paste(part, position, part)
            else:
                image = Image.open(io.BytesIO(raws[key])).convert("RGB")
            raw = out / f"{key}.png"
            image.save(raw)
            seal_result(bundle, raw)
            import_result(run, bundle)

        prepared = out / "prepared"
        prepare_handoff(compiled, run, prepared, self.consumer)
        record = read_json(prepared / "shared-material-map.json")
        self.assertEqual({(link["sourceLayerId"], link["layerId"]) for link in record["links"]},
                         {("coin-source", "coin-copy-a"), ("coin-source", "coin-copy-b")})
        for link in record["links"]:
            source = prepared / "materials" / f"{link['sourceLayerId']}.png"
            target = prepared / "materials" / f"{link['layerId']}.png"
            self.assertNotEqual(source, target)
            self.assertEqual(sha256(source), sha256(target))
            self.assertEqual(sha256(target), link["sha256"])

        from ai_ui_decomposition.cached import verified_result
        from ai_ui_decomposition.sourced_handoff import prepare_from_sources
        sources = {}
        for key in {row["generationAsset"] for row in catalog["parts"]
                    if "sharedSource" not in row}:
            frozen, _item, receipt, _raw = verified_result(run, key)
            sources[key] = dict(runDirectory=str(run), assetId=key,
                                batchDigest=frozen["digest"],
                                expectedRawSha256=receipt["raw_sha256"],
                                basis="Offline source reuse fixture")
        joined = out / "joined"
        prepare_from_sources(compiled, sources, joined, self.consumer)
        joined_map = read_json(joined / "shared-material-map.json")
        self.assertEqual([(link["sourceLayerId"], link["layerId"])
                          for link in joined_map["links"]],
                         [(link["sourceLayerId"], link["layerId"])
                          for link in record["links"]])
        for link in joined_map["links"]:
            source = joined / "materials" / f"{link['sourceLayerId']}.png"
            target = joined / "materials" / f"{link['layerId']}.png"
            self.assertEqual(sha256(source), sha256(target))

    def test_invalid_shared_source_declarations_are_rejected(self):
        fixture = self.root / "fixtures" / "CheckBox"
        base, raws = native_fixture(fixture)
        add_coin_images(base, raws)
        mutations = [
            ("missing", lambda request: request["materials"][-1]["sharedSource"].update(
                sourceLayerId="missing"), "NATIVE_SHARED_SOURCE_MISSING"),
            ("self", lambda request: request["materials"][-1]["sharedSource"].update(
                sourceLayerId="coin-copy-b"), "NATIVE_SHARED_SOURCE_SELF"),
            ("chain", lambda request: request["materials"][-2]["sharedSource"].update(
                sourceLayerId="coin-copy-b"),
             "NATIVE_SHARED_SOURCE_CHAIN"),
            ("cycle", lambda request: (
                request["materials"][-2]["sharedSource"].update(sourceLayerId="coin-copy-b"),
                request["materials"][-1]["sharedSource"].update(sourceLayerId="coin-copy-a")),
             "NATIVE_SHARED_SOURCE_CHAIN"),
            ("version", lambda request: request["materials"][-1]["sharedSource"].update(
                version="2.0"), "NATIVE_SHARED_SOURCE_SCHEMA"),
            ("empty_evidence", lambda request: request["materials"][-1]["sharedSource"].update(
                evidence="  "), "NATIVE_SHARED_SOURCE_EVIDENCE"),
            ("size", lambda request: (
                request["materials"][-1]["rect"].__setitem__(2, 25),
                next(node for node in request["document"]["root"]["children"]
                     if node["id"] == "coin-copy-b")["layout"].update(width=25)),
             "NATIVE_SHARED_SOURCE_SIZE"),
            ("different_group", lambda request: request["materials"][-1].update(groupId="other"),
             "NATIVE_SHARED_SOURCE_GROUP"),
            ("state_distinction", lambda request: next(
                row for row in request["appearance"]["bindings"]
                if row["componentId"] == "coin-source").update(states={"hover": {}}),
             "NATIVE_SHARED_SOURCE_STATE_DISTINCTION"),
        ]
        for name, mutate, code in mutations:
            with self.subTest(name=name):
                request = copy.deepcopy(base)
                mutate(request)
                with self.assertRaisesRegex(ValueError, code):
                    compile_delivery(fixture / "reference.png", request,
                                     self.root / f"invalid-{name}", self.consumer, 8)


if __name__ == "__main__":
    unittest.main()
