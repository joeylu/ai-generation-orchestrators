import _bootstrap
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ai_ui_layers.automatic_registration import call_model


class ReviewTransportPathTests(unittest.TestCase):
    def test_relative_review_inputs_survive_cli_temporary_working_directory(self):
        # The live CLI resolves schema/image/output arguments from its own cwd.
        # Use the real command builder and an offline filesystem-only transport.
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            folder = Path(tmp)/'review with spaces'
            folder.mkdir()
            inputs = {'schema.json': b'{}', 'prompt.md': b'Review only.',
                      'reference.png': b'reference fixture', 'generated.png': b'generated fixture'}
            for name, content in inputs.items():
                (folder/name).write_bytes(content)
            relative = Path(os.path.relpath(folder))
            self.assertFalse(relative.is_absolute())

            def transport(args, evidence, cwd, prompt):
                child_cwd = Path(cwd)
                schema = child_cwd/args[args.index('--output-schema')+1]
                self.assertEqual(schema.read_bytes(), inputs['schema.json'])
                images = args[args.index('--image')+1].split(',')
                for filename in images:
                    path = child_cwd/filename
                    self.assertEqual(path.read_bytes(), inputs[path.name])
                output = child_cwd/args[args.index('--output-last-message')+1]
                self.assertEqual(output.parent.resolve(), folder.resolve())
                self.assertEqual(evidence, folder.resolve())
                self.assertEqual(prompt, 'Review only.')
                return {'images': len(images)}

            with patch('ai_ui_layers.automatic_registration.shutil.which', return_value='offline-codex'), \
                 patch('ai_ui_layers.codex_call.skill_overrides', return_value='skills.config=[]'), \
                 patch('ai_ui_layers.automatic_registration.invoke', side_effect=transport) as invoke:
                self.assertEqual(call_model(relative), {'images': 2})
                inputs['detail-compare.png'] = b'closeup fixture'
                (folder/'detail-compare.png').write_bytes(inputs['detail-compare.png'])
                self.assertEqual(call_model(relative), {'images': 3})
                self.assertEqual(invoke.call_count, 2)
            for name, content in inputs.items():
                self.assertEqual((folder/name).read_bytes(), content)


if __name__ == '__main__':
    unittest.main()
