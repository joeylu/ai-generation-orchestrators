import _bootstrap
import unittest
from PIL import Image
import test_layer_package
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers.evaluate import read,save,digest
from ai_ui_layers.preview_partial import preview
from ai_ui_layers.accepted_materials import build
from ai_ui_layers.layer_package import validate_archive


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        test_layer_package.LayerPackageTests.setUp(self)
        snap=read(self.snapshot/'snapshot.json');self.job=self.root/'job'
        job=exchange.prepare(self.snapshot,snap['digest'],self.job)
        exchange.authorize(self.job,job['digest'],'fixture only')
        sources={}
        assets={a['id']:a for a in read(self.snapshot/'execution-plan.candidate.json')['assets']}
        for _ in assets:
            request=exchange.next_request(self.job);mid=request['asset'];a=assets[mid];w,h=a['output_size']
            raw=self.root/(mid+'-raw.png')
            if a['role']=='background':im=Image.new('RGBA',(w,h),(30,60,90,255))
            else:
                im=Image.new('RGBA',(w+80,h+80));im.paste(Image.new('RGBA',(w,h),(50,80,110,255)),(40,40))
            im.save(raw);exchange.receive(self.job,request['submissionDigest'],raw)
            sources[mid]=str(self.job/'attempts'/mid/'raw.png')
        config=self.root/'preview-input.json'
        save(config,dict(snapshot=str(self.snapshot),snapshotDigest=snap['digest'],materials=sources))
        self.preview=self.root/'preview';preview(config,self.preview)
        self.spec=self.root/'selection.json'
        placements=sorted(read(self.snapshot/'placements.json')['materials'],key=lambda x:x['drawIndex'])
        save(self.spec,dict(kind='ui_accepted_material_selection_v1',reference=str(self.snapshot/'reference.png'),
            referenceSha256=digest(self.snapshot/'reference.png'),acceptedPreview=str(self.preview/'partial-transparent.png'),
            acceptedPreviewSha256=digest(self.preview/'partial-transparent.png'),textPolicy='remove-business-text',
            backgroundMode='scene-only',knownDifferences=['Fixture visual acceptance.'],expectedMaterialIds=[p['id'] for p in placements],layers=[dict(
                snapshot=str(self.snapshot),snapshotDigest=snap['digest'],preview=str(self.preview),
                previewReportSha256=digest(self.preview/'report.json'),materialId=p['id'],job=str(self.job),
                requestId=p['id'],sourceMaterialId=p['id']) for p in placements]))

    def test_receipt_replay_and_exact_accepted_composition(self):
        out=self.root/'accepted';result=build(self.spec,out,self.viewer,'User accepted fixture')
        self.assertTrue(result['acceptedPreviewMatched']);self.assertFalse(result['originalDagPromoted'])
        validate_archive(out/'ui-layers.zip')
        self.assertEqual(Image.open(out/'package/preview.png').tobytes(),Image.open(self.preview/'partial-transparent.png').tobytes())
        self.assertNotIn(str(self.root),(out/'package/review.json').read_text(encoding='utf-8'))

    def test_changed_raw_and_missing_acceptance_fail_closed(self):
        with self.assertRaisesRegex(ValueError,'ACCEPTANCE_REQUIRED'):build(self.spec,self.root/'out',self.viewer,'')
        entry=read(self.spec)['layers'][0]
        (self.job/'attempts'/entry['requestId']/'raw.png').write_bytes(b'changed')
        with self.assertRaises(ValueError):build(self.spec,self.root/'out',self.viewer,'accepted')
        self.assertFalse((self.root/'out').exists())

    def test_omitted_layer_cannot_match_accepted_preview(self):
        spec=read(self.spec);spec['layers'].pop();other=self.root/'omitted.json';save(other,spec)
        with self.assertRaisesRegex(ValueError,'LAYER_SET_MISMATCH'):build(other,self.root/'out',self.viewer,'accepted')


if __name__=='__main__':unittest.main()
