import json
import unittest
from PIL import Image
from ai_ui_decomposition import batch
from ai_ui_decomposition.cached import result_binding
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.process import process


class RejectedResultTests(unittest.TestCase):
    def test_known_opaque_result_is_terminal_not_reusable_or_resubmittable(self):
        import test_harness
        f=test_harness.HarnessTests();f.setUp()
        try:
            f.plan['assets'][1]['output_mode']='transparent_component'
            path=f.root/'native.json';path.write_text(json.dumps(f.plan))
            batch.freeze(path,f.workspace,'native');run=f.workspace/'runs/native'
            batch.reserve(run,'button')
            raw=f.root/'opaque.png';Image.new('RGB',(20,12),'#aaaaaa').save(raw)
            with self.assertRaisesRegex(ContractError,'TRANSPARENT_RESULT_REQUIRED'):batch.receive(run,'button',raw)
            state=batch.status(run);self.assertEqual(state['rejected'],1);self.assertEqual(state['indeterminate'],0)
            directory=run/'requests/fixture-r001-button-r001'
            self.assertEqual((directory/'raw.png').read_bytes(),raw.read_bytes())
            before=(directory/'rejected.json').read_bytes()
            for action in [lambda:batch.reserve(run,'button'),lambda:batch.receive(run,'button',raw),lambda:result_binding(run,'button'),lambda:process(run)]:
                with self.assertRaises(ContractError):action()
            self.assertEqual((directory/'rejected.json').read_bytes(),before)
            self.assertFalse((directory/'received.json').exists())
        finally:f.tearDown()
