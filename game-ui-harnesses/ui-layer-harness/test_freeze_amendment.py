import unittest
import test_compile_visual as fixtures
from freeze_visual import freeze
from freeze_amendment import freeze_amendment
from evaluate import digest,read
from execution_preflight import preflight

class AmendmentTests(unittest.TestCase):
    setUp=fixtures.VisualCompileTests.setUp
    def test_explicit_amendment_preserves_parent_and_does_not_claim_new_review(self):
        parent=self.root/'parent';r=freeze(self.run,parent,5);before=digest(parent/'snapshot.json')
        self.visual['objects'].append({'id':'decoration','kind':'decoration','materialId':'asset-panel','label':'hollow ornament','bboxNorm':None})
        out=self.root/'amendment';s=freeze_amendment(parent,r['digest'],self.visual,out,'user asks to preserve ornament')
        self.assertFalse(s['newM2ReviewPerformed']);self.assertEqual(digest(parent/'snapshot.json'),before)
        self.assertEqual(preflight(out,s['digest'])['inputChecks'],'passed')
        self.assertFalse((out/'surface-details.json').exists())
        self.assertIn('hollow ornament',(out/'materials/asset-panel/prompt.txt').read_text(encoding='utf-8'))
