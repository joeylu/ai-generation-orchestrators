from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import jsonschema
from PIL import Image

from ai_frame_animation.planning import compile_plan


ROOT = Path(__file__).parents[1]
SCHEMAS = ROOT / "src" / "ai_frame_animation" / "schemas"


class SchemaTests(unittest.TestCase):
    def test_all_schemas_are_valid(self) -> None:
        for path in SCHEMAS.glob("*.schema.json"):
            with self.subTest(path=path.name):
                jsonschema.Draft202012Validator.check_schema(json.loads(path.read_text(encoding="utf-8")))

    def test_example_job_matches_public_schema_shape(self) -> None:
        schema = json.loads((SCHEMAS / "job.schema.json").read_text(encoding="utf-8"))
        example = json.loads((ROOT / "examples" / "job.example.json").read_text(encoding="utf-8"))
        jsonschema.validate(example, schema)

    def test_compiled_plan_matches_public_schema(self) -> None:
        schema = json.loads((SCHEMAS / "plan.schema.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            Image.new("RGB", (4, 4), (255, 0, 0)).save(root / "reference.png")
            plan = compile_plan(
                {
                    "schema_version": "1.0",
                    "job_id": "schema-fixture",
                    "character": {"reference": "reference.png"},
                    "motion": {"request": "idle", "continuity": "loop"},
                    "delivery": {"frame_counts": [16], "size": 128},
                    "provider": {"plugin": "fixture"},
                },
                root,
            )
            jsonschema.validate(plan, schema)


if __name__ == "__main__":
    unittest.main()
