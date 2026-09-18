"""Public entry discovery and packaged resource contract."""
from pathlib import Path
import importlib.resources
import json
import unittest
from ai_ui_decomposition.cli import parser


class LoopEntryCatalogTests(unittest.TestCase):
    def test_skill_catalog_advertises_only_callable_loop_entries(self):
        root=Path(__file__).resolve().parents[1]
        commands=json.loads((root/'skill.json').read_text(encoding='utf-8'))['commands']
        for command in ['workflow-export-loop','workflow-exchange-generation']:
            self.assertIn(command,commands)
        # These options parse without running or authorizing any workflow.
        parsed=parser().parse_args(['workflow-export-loop','--job','fixture','--output','run.js','--output-root','images'])
        self.assertEqual(parsed.command,'workflow-export-loop')

    def test_host_bundle_resources_are_package_local(self):
        resources=importlib.resources.files('ai_ui_decomposition')
        for name in ['generation-loop.mjs','generation-loop-host.mjs','generation-loop-node.mjs','generation-loop-bridge.mjs']:
            self.assertTrue(resources.joinpath(name).is_file(),name)
