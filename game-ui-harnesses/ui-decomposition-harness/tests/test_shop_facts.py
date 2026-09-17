"""Bounded shop-facts compiler regressions and an offline native delivery loop."""
from __future__ import annotations

import copy
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from ai_ui_decomposition import batch
from ai_ui_decomposition.acceptance_execution import AcceptanceExecution
from ai_ui_decomposition.adapter import export_request, import_result, seal_result
from ai_ui_decomposition.common import read_json, sha256
from ai_ui_decomposition.delivery_adapter import compile_delivery, prepare_handoff
from ai_ui_decomposition.handoff_build import build_handoff
from ai_ui_decomposition.shop_facts import expand_shop_facts, synthetic_facts


def walk(node):
    yield node
    for child in node.get("children", []):
        yield from walk(child)


class ShopFactsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.consumer = Path(__file__).resolve().parents[2] / "ui-component-harness"

    def source_case(self, root: Path, size=(640, 480), variant="a"):
        reference = root / f"reference-{variant}-{size[0]}x{size[1]}.png"
        Image.new("RGB", size, "#203040").save(reference)
        return reference, synthetic_facts(sha256(reference), list(size), variant=variant)

    def test_scratch_expansion_tracks_facts_and_canvas(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ref_a, facts_a = self.source_case(root, (640, 480), "a")
            ref_b, facts_b = self.source_case(root, (800, 600), "b")
            facts_b["rows"]["items"][0]["name"] = "Northstar Compass"
            facts_b["rows"]["items"][0]["searchText"] = "Northstar Compass Packed travel provisions"
            facts_b["footer"]["selectedName"]["text"] = "Selected: Northstar Compass"
            native_a = expand_shop_facts(ref_a, facts_a)
            native_b = expand_shop_facts(ref_b, facts_b)
            self.assertEqual(native_a["referenceSha256"], sha256(ref_a))
            self.assertEqual(native_b["referenceSha256"], sha256(ref_b))
            self.assertEqual(native_a["document"]["canvas"], {"width": 640, "height": 480})
            self.assertEqual(native_b["document"]["canvas"], {"width": 800, "height": 600})
            text_b = [n["props"].get("text") for n in walk(native_b["document"]["root"])]
            self.assertIn("Northstar Compass", text_b)
            self.assertNotIn("Cargo Crate", text_b)
            self.assertNotIn("row-image-cargo", {m["layerId"] for m in native_b["materials"]})
            self.assertNotEqual(native_a["document"]["root"], native_b["document"]["root"])

    def test_reference_sha_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference, facts = self.source_case(root)
            facts["source"]["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "SHOP_FACTS_SOURCE_SHA_MISMATCH"):
                expand_shop_facts(reference, facts)

    def test_required_facts_sections_cannot_be_omitted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference, facts = self.source_case(root)
            del facts["runtimeDerivations"]
            with self.assertRaisesRegex(ValueError, "SHOP_FACTS_FIELDS:root"):
                expand_shop_facts(reference, facts)

    def test_duplicate_supplied_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference, facts = self.source_case(root)
            duplicate = copy.deepcopy(facts["rows"]["items"][0])
            duplicate.update(name="Second crate", searchText="Second crate provisions", selected=False)
            facts["rows"]["items"].append(duplicate)
            with self.assertRaisesRegex(ValueError, "SHOP_FACTS_DUPLICATE_ID"):
                expand_shop_facts(reference, facts)

    def test_out_of_canvas_geometry_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference, facts = self.source_case(root)
            facts["footer"]["buttons"][0]["rect"] = [630, 460, 20, 30]
            with self.assertRaisesRegex(ValueError, "SHOP_FACTS_RECT_BOUNDS|SHOP_FACTS_GEOMETRY_RELATION"):
                expand_shop_facts(reference, facts)

    def test_initial_sort_order_is_checked_against_derived_mapping(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference, facts = self.source_case(root)
            facts["sort"]["selectedValue"] = "not-a-declared-option"
            with self.assertRaisesRegex(ValueError, "SHOP_FACTS_SORT_SELECTION"):
                expand_shop_facts(reference, facts)

    def test_unsorted_source_rows_are_rejected_for_selected_sort(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference, facts = self.source_case(root)
            facts["sort"]["selectedValue"] = "name-asc"
            first = facts["rows"]["items"][0]
            first.update(name="Zulu crate", searchText="Zulu crate", selected=True)
            second = copy.deepcopy(first)
            second.update(id="alpha", name="Alpha crate", searchText="Alpha crate", selected=False)
            facts["rows"]["items"] = [first, second]
            with self.assertRaisesRegex(ValueError, "SHOP_FACTS_INITIAL_SORT_ORDER"):
                expand_shop_facts(reference, facts)

    def test_unknown_input_editing_state_stays_unknown(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference, facts = self.source_case(root)
            native = expand_shop_facts(reference, facts)
            input_state = next(row for row in native["referenceState"]["components"]
                               if row["componentType"] == "Input")
            self.assertEqual(set(input_state["fields"]), {
                "value", "focused", "caretVisible", "selectionStart", "selectionEnd", "selectionDirection"
            })
            for field in ("focused", "caretVisible", "selectionStart", "selectionEnd", "selectionDirection"):
                self.assertEqual(input_state["fields"][field]["status"], "unknown")

    def test_zero_total_fraction_digits_are_formatting_not_scaling(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference, facts = self.source_case(root)
            item = facts["rows"]["items"][0]
            item["unitPrice"] = 0
            item["priceText"] = "0.00"
            facts["footer"]["total"].update(text="Total: 0.00 G", fractionDigits=2)
            native = expand_shop_facts(reference, facts)
            total = next(node for node in walk(native["document"]["root"]) if node["id"] == "shop-total")
            self.assertEqual(total["props"]["text"], "Total: 0.00 G")
            linkage = native["document"]["componentLinkages"]["pipelines"][0]["total"]
            self.assertEqual(linkage["fractionDigits"], 2)

    def test_astral_initial_sort_uses_utf16_code_units(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference, facts = self.source_case(root)
            facts["sort"]["selectedValue"] = "name-asc"
            first = facts["rows"]["items"][0]
            astral = copy.deepcopy(first)
            astral.update(id="astral", name="😀 Star", searchText="😀 Star", unitPrice=0,
                          priceText="0", selected=True)
            bmp = copy.deepcopy(first)
            bmp.update(id="bmp", name="\ue000 Orb", searchText="\ue000 Orb", unitPrice=5,
                       priceText="5", selected=False)
            facts["rows"]["items"] = [astral, bmp]
            facts["footer"]["selectedName"]["text"] = "Selected: 😀 Star"
            facts["footer"]["total"].update(text="Total: 0 G", fractionDigits=0)
            native = expand_shop_facts(reference, facts)
            list_node = next(node for node in walk(native["document"]["root"]) if node["id"] == "shop-list")
            self.assertEqual([row["id"] for row in list_node["props"]["items"]], ["astral", "bmp"])

    def _synthetic_generated_material(self, size, color, *, canonical=False):
        image = Image.new("RGBA", tuple(size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        if canonical:
            channel = sum(color) // 3
            color = (channel, channel, channel, 255)
        else:
            color = (*color[:3], 255)
        draw.rectangle((1, 1, size[0] - 2, size[1] - 2), fill=color)
        hole = max(1, min(size) // 12)
        cx, cy = size[0] // 2, size[1] // 2
        draw.rectangle((cx - hole, cy - hole, cx + hole, cy + hole), fill=(0, 0, 0, 0))
        return image

    def _board_result(self, compiled: Path, asset_id: str, catalog: dict, derived_canonical: set[str]):
        group = asset_id[6:]
        board = read_json(compiled / f"strategy-{group}.json")["boards"][0]
        canvas = Image.new("RGB", board["canvas"], "#F808F8")
        draw = ImageDraw.Draw(canvas)
        for index, slot in enumerate(board["slots"]):
            left, top, right, bottom = slot["search_window"]
            width, height = slot["target_size"]
            x, y = (left + right - width) // 2, (top + bottom - height) // 2
            if slot["asset_id"] in derived_canonical:
                shade = 110 + index % 80
                color = (shade, shade, shade)
            else:
                palette = ((40, 80, 180), (60, 150, 80), (190, 120, 40),
                           (120, 50, 170), (40, 150, 170), (200, 190, 50))
                color = palette[index % len(palette)]
            # Leave horizontal separation for the board extractor, while
            # matching long controls' inner target aspect ratio after its
            # official 2 px fit padding.
            shape_width = max(1, width - 2)
            target_ratio = max(0.01, (width - 4) / max(1, height - 4))
            shape_height = max(1, min(height - 2,
                                      int(shape_width / target_ratio)))
            sx = x + (width - shape_width) // 2
            sy = y + (height - shape_height) // 2
            draw.rectangle((sx, sy, sx + shape_width - 1,
                            sy + shape_height - 1), fill=color)
            if slot["asset_id"] != "sort-popup":
                hole = max(1, min(shape_width, shape_height) // 12)
                cx, cy = sx + shape_width // 2, sy + shape_height // 2
                draw.rectangle((cx - hole, cy - hole, cx + hole, cy + hole), fill="#F808F8")
        return canvas

    def test_full_offline_compile_generation_import_and_cli_handoff(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference, facts = self.source_case(root, (640, 480), "a")
            popup = facts["sort"]["popupRect"]
            facts["sort"]["popupContentRect"] = [popup[0] + 4, popup[1] + 4,
                                                  popup[2] - 8, popup[3] - 8]
            native = expand_shop_facts(reference, facts)
            compiled = root / "compiled"
            compile_delivery(reference, native, compiled, self.consumer, 9)
            batch.freeze(
                compiled / "plan.json", root / "workspace", "shop-facts-offline",
                capability_request=compiled / "capabilities.json",
                component_document=compiled / "semantic-document.json",
                layout_spacing=compiled / "layout-spacing.json",
            )
            run = root / "workspace" / "runs" / "shop-facts-offline"
            catalog = read_json(compiled / "material-catalog.json")
            derived_canonical = {row["canonicalLayerId"] for row in native.get("derivedGlyphs", [])}
            for asset in read_json(compiled / "plan.json")["assets"]:
                key = asset["id"]
                bundle = root / "requests" / key
                export_request(run, key, bundle)
                if key.startswith("board-"):
                    image = self._board_result(compiled, key, catalog, derived_canonical)
                elif key == "background":
                    image = Image.new("RGB", asset["output_size"], "#27343B")
                else:
                    part = next(row for row in catalog["parts"] if row.get("generationAsset") == key)
                    color = (80 + len(key) % 100, 120, 180)
                    image = self._synthetic_generated_material(part["rect"][2:], color,
                                                               canonical=key in derived_canonical).convert("RGB")
                    # Keep the per-asset test cutout on the contract key color.
                    rgba = self._synthetic_generated_material(part["rect"][2:], color,
                                                              canonical=key in derived_canonical)
                    rgb = Image.new("RGB", rgba.size, "#F808F8")
                    rgb.paste(rgba, mask=rgba.getchannel("A"))
                    image = rgb
                raw_path = root / f"{key}.png"
                image.save(raw_path)
                seal_result(bundle, raw_path)
                try:
                    import_result(run, bundle)
                except Exception as error:
                    self.fail(f"synthetic result for {key} was rejected: {error}")

            prepared = root / "prepared"
            build = prepare_handoff(compiled, run, prepared, self.consumer)
            product = next(part for part in catalog["parts"] if part["componentId"] == "row-image-cargo")
            extracted = Image.open(prepared / "materials" / f"{product['layerId']}.png").convert("RGBA")
            self.assertIn(0, extracted.getchannel("A").getextrema())
            self.assertEqual(extracted.getchannel("A").getextrema()[1], 255)
            handoff = root / "handoff"
            try:
                imported_plan = build_handoff(build, self.consumer, handoff, AcceptanceExecution(90))
            except Exception:
                geometry = handoff / "visible-material-geometry.json"
                if geometry.is_file() and read_json(geometry).get("status") != "passed":
                    self.fail(str(read_json(geometry).get("checks")))
                report = handoff / "layout-check.json"
                if report.is_file():
                    self.fail(str(read_json(report).get("issues")))
                raise
            self.assertTrue(imported_plan.is_file())
            self.assertTrue((handoff / "consumed.json").is_file())
            self.assertEqual(read_json(handoff / "consumed.json")["document"]["canvas"], native["document"]["canvas"])


if __name__ == "__main__":
    unittest.main()
