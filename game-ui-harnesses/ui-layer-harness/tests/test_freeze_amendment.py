import _bootstrap  # Enable source-layout imports for unittest discovery.
import json
import unittest
import test_compile_visual as fixtures
from ai_ui_layers.freeze_visual import freeze,inspect,body_digest
from ai_ui_layers.freeze_amendment import freeze_amendment
from ai_ui_layers.evaluate import digest,read
from ai_ui_layers.execution_preflight import preflight

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
        (out/'compile-report.json').write_text(json.dumps({'visualTexturePolicy':'unbound'}),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'VISUAL_TEXTURE_METADATA_MISMATCH'):
            inspect(out,s['digest'])

    def test_standard_snapshot_still_requires_its_compile_report(self):
        folder=self.root/'standard';snapshot=freeze(self.run,folder,5)
        (folder/'compile-report.json').unlink()
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED:compile-report.json'):
            inspect(folder,snapshot['digest'])
        # Even a newly hashed manifest cannot adopt the legacy exception merely
        # by omitting the report from its inventory.
        snapshot['files'].pop('compile-report.json')
        snapshot['digest']=body_digest({k:v for k,v in snapshot.items() if k!='digest'})
        (folder/'snapshot.json').write_text(json.dumps(snapshot),encoding='utf-8')
        with self.assertRaises(FileNotFoundError):inspect(folder,snapshot['digest'])
