import copy
from pathlib import Path
import unittest
from ai_ui_decomposition.common import write_json,sha256
from ai_ui_decomposition import batch
from ai_ui_decomposition.adapter import export_request,seal_result
from ai_ui_decomposition.board_extraction_revision import revise
from ai_ui_decomposition.revised_receive import receive
import test_foreground_gap_board
import test_harness

class RevisedReceiveTests(unittest.TestCase):
    def test_explicit_revision_reproduced_before_receive_and_no_replay(self):
        f=test_harness.HarnessTests();f.setUp();self.addCleanup(f.tearDown)
        g=test_foreground_gap_board.GapBoardTests();g.setUp();p=copy.deepcopy(f.plan)
        p['assets'][1].update(output_mode='keyed_component',prompt=f"component-family-board-v1:{g.strategy['digest']}:icons")
        write_json(f.root/'p.json',p);write_json(f.root/'s.json',g.strategy)
        batch.freeze(f.root/'p.json',f.workspace,'revision');run=f.workspace/'runs/revision'
        bundle=f.root/'bundle';export_request(run,'button',bundle)
        raw=f.root/'raw.png';g.raw.save(raw);seal_result(bundle,raw)
        revise(raw,f.root/'s.json','icons',sha256(raw),g.policy,'Explicit processing-only revision',f.root/'revision')
        args=(run,bundle,f.root/'s.json',f.root/'revision/extraction-revision.json')
        with self.assertRaisesRegex(ValueError,'APPROVAL'):receive(*args,f.root/'no-approval','')
        self.assertFalse((f.root/'no-approval').exists())
        changed=g.raw.copy();changed.putpixel((0,0),(1,2,3));changed.save(bundle/'result.png')
        with self.assertRaisesRegex(ValueError,'RAW_CHANGED'):receive(*args,f.root/'bad','Explicit user approval')
        g.raw.save(bundle/'result.png')
        receive(*args,f.root/'checked','Explicit user approval')
        self.assertEqual(batch.status(run)['received'],1)
        with self.assertRaisesRegex(ValueError,'RESERVED'):receive(*args,f.root/'again','Explicit user approval')
