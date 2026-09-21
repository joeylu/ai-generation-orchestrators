"""Offline transport regression tests. Never launches a model or CLI."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from codex_call import command, inspect_events
from jsonschema import Draft202012Validator


class TransportTests(unittest.TestCase):
    @patch('codex_call.skill_overrides', return_value='skills.config=[]')
    def test_isolation_and_literal_arguments(self, _):
        args = command('codex', Path('dir with spaces'), Path('empty'), 'gpt-5.6-luna', 'xhigh')
        for value in ('--strict-config','--ignore-user-config','--ephemeral','read-only',
                      'approval_policy="never"','project_doc_max_bytes=0',
                      'features.shell_tool=false','features.view_image=false','skills.config=[]'):
            self.assertIn(value, args)
        self.assertNotIn('--ignore-rules', args)
        self.assertEqual(args[-1], '-')
        self.assertEqual(args[args.index('--image')+1], str(Path('dir with spaces')/'reference.png'))

    def events(self, values):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td)/'events.jsonl'
            p.write_text('\n'.join(json.dumps(v) for v in values), encoding='utf-8')
            return inspect_events(p)

    def test_completion_and_usage(self):
        result = self.events([{'type':'item.completed','item':{'type':'agent_message'}},
                              {'type':'turn.completed','usage':{'input_tokens':12}}])
        self.assertTrue(result['turnCompleted'])
        self.assertEqual(result['usage']['input_tokens'], 12)
        self.assertFalse(result['unexpectedEvents'])

    def test_tool_or_failure_cannot_pass(self):
        for kind in ('command_execution','mcp_tool_call','web_search','unknown'):
            self.assertTrue(self.events([{'type':'item.started','item':{'type':kind}}])['unexpectedEvents'])
        self.assertTrue(self.events([{'type':'turn.failed'}])['unexpectedEvents'])

    def test_recovered_transport_is_reported_but_config_warnings_rejected(self):
        result = self.events([{'type':'error','message':'Reconnecting... 2/5'},
                              {'type':'turn.completed'}])
        self.assertTrue(result['turnCompleted'])
        self.assertEqual(result['transportNotices'], 1)
        self.assertFalse(result['unexpectedEvents'])
        self.assertTrue(self.events([{'type':'item.completed','item':{'type':'error','message':'Unknown configuration'}}])['unexpectedEvents'])

    def test_current_schema_is_explicit_and_example_valid(self):
        root = Path(__file__).resolve().parents[2]/'game-ui-harnesses/ui-decomposition-harness/planning-harness'
        schema = json.loads((root/'schemas/visual-plan.schema.json').read_text(encoding='utf-8'))
        example = json.loads((root/'examples/visual-plan.json').read_text(encoding='utf-8'))
        Draft202012Validator.check_schema(schema)
        Draft202012Validator(schema).validate(example)
        def visit(node):
            if isinstance(node, dict):
                if 'const' in node or 'enum' in node:
                    self.assertIn('type', node)
                for value in node.values():
                    visit(value)
            elif isinstance(node, list):
                for value in node:
                    visit(value)
        visit(schema)


if __name__ == '__main__':
    unittest.main()
