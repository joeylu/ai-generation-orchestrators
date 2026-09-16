import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition import workflow_worker


class _Driver:
    def __init__(self, options):
        self.options = options

    def run(self, _context):
        if self.options.get("contract") is not None:
            raise ContractError(self.options["contract"])
        if self.options.get("value") is not None:
            raise ValueError(self.options["value"])
        return {"status": "ok", "data": {"fixture": True}, "artifacts": {}}


def create(options):
    return _Driver(options)


class WorkflowWorkerErrorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def run_worker(self, options, name="node"):
        directory = self.root / name
        directory.mkdir()
        context = {
            "spec": {
                "factory": f"{__name__}:create",
                "options": options,
            }
        }
        context_path = directory / "context.json"
        context_path.write_text(json.dumps(context), encoding="utf-8")
        with patch("sys.argv", ["workflow_worker", str(context_path)]):
            status = workflow_worker.main()
        return status, directory

    def read_error(self, directory):
        return json.loads((directory / "error.json").read_text(encoding="utf-8"))

    def test_contract_error_keeps_only_a_valid_code(self):
        status, directory = self.run_worker(
            {"contract": "NODE_INPUT_INVALID"}, "valid")
        self.assertNotEqual(status, 0)
        self.assertEqual(self.read_error(directory), {
            "kind": "ui_workflow_node_error_v1",
            "code": "NODE_INPUT_INVALID",
        })

    def test_invalid_or_non_contract_errors_use_generic_code(self):
        cases = [
            ({"contract": "lower_case"}, "lower"),
            ({"contract": "NODE path=C:\\private token=secret"}, "details"),
            ({"contract": "A" + "B" * 100}, "long"),
            ({"value": "TOKEN=secret path=C:\\private"}, "value"),
        ]
        for options, name in cases:
            with self.subTest(name=name):
                status, directory = self.run_worker(options, name)
                self.assertNotEqual(status, 0)
                self.assertEqual(self.read_error(directory), {
                    "kind": "ui_workflow_node_error_v1",
                    "code": "WORKFLOW_NODE_FAILED",
                })
                payload = (directory / "error.json").read_text(encoding="utf-8")
                self.assertNotIn("TOKEN", payload)
                self.assertNotIn("secret", payload)
                self.assertNotIn("private", payload)

    def test_normal_result_path_keeps_result_and_zero_exit(self):
        status, directory = self.run_worker({}, "success")
        self.assertEqual(status, 0)
        self.assertEqual(json.loads((directory / "result.json").read_text(encoding="utf-8")), {
            "status": "ok",
            "data": {"fixture": True},
            "artifacts": {},
        })
        self.assertFalse((directory / "error.json").exists())

    def test_error_record_write_failure_still_returns_nonzero(self):
        directory = self.root / "write-failure"
        directory.mkdir()
        context_path = directory / "context.json"
        context_path.write_text("{}", encoding="utf-8")
        with patch("sys.argv", ["workflow_worker", str(context_path)]), \
             patch.object(workflow_worker, "write_json", side_effect=OSError("TOKEN=secret")):
            status = workflow_worker.main()
        self.assertNotEqual(status, 0)

    def test_controller_exposes_safe_code_without_error_prose(self):
        from PIL import Image
        from ai_ui_decomposition import workflow
        ref=self.root/'reference.png';Image.new('RGB',(32,32),'black').save(ref)
        for name,options,expected in [('contract',{'contract':'BOARD_RELATIVE_CANVAS_ASPECT'},'BOARD_RELATIVE_CANVAS_ASPECT'),
                                      ('private',{'value':'private endpoint TOKEN=secret'},'WORKFLOW_NODE_FAILED')]:
            job=self.root/name
            workflow.create_job(ref,job,factory='test_workflow_worker_errors:create',options=options,fixture=True)
            status=workflow.advance(job,allow_vision=True)
            self.assertEqual(status['status'],'failed');self.assertEqual(status['errorCode'],expected)
            self.assertNotIn('secret',json.dumps(status))


if __name__ == "__main__":
    unittest.main()
