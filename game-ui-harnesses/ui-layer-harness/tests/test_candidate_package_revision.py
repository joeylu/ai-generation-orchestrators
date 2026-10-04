"""Explicit candidate revisions use offline exchange fixtures, never generation."""
import _bootstrap
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

import test_package_revision
import test_host_material_review
from ai_ui_layers import candidate_package_revision as candidate
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers import host_material_review as host
from ai_ui_layers.evaluate import read,save,digest
from ai_ui_layers.layer_package import composite,validate_archive


class CandidatePackageRevisionTests(unittest.TestCase):
    def setUp(self):
        test_package_revision.PackageRevisionTests.setUp(self)
        folder=self.root/'completed-host-review'
        host.prepare(self.job,self.key,folder,material_authors=['fixture-generator'],review_registry=self.root/'registry')
        answer=dict(materialIds=[self.key],findings=[dict(materialId=self.key,category='geometry',
            referenceState='not-applicable',generatedState='not-applicable',magnitude='major',ownership='clear',
            evidence='Fixture owned body aspect mismatch remains visible.',suggestion='Inspect the complete candidate composition.')])
        external=test_host_material_review.HostEvidence.response(self,folder,answer=answer)
        host.receive(**external)
        body=self.root/'candidate-body-evidence';body.mkdir()
        raw=self.job/'attempts'/self.key/'raw.png';placement=next(p for p in read(self.snapshot/'placements.json')['materials'] if p['id']==self.key)
        schema=dict(type='object',required=['boundaryStatus','sourceBodyBox','targetBodyBox','evidence','issues'],
            properties=dict(boundaryStatus=dict(enum=['uncertain','complete']),sourceBodyBox=dict(type=['array','null']),
                targetBodyBox=dict(type=['array','null']),evidence=dict(type='string'),issues=dict(type='array')))
        save(body/'schema.json',schema)
        with Image.open(raw) as image:size=list(image.size)
        frozen=read(self.snapshot/'snapshot.json')
        save(body/'request.json',dict(materialId=self.key,snapshotDigest=frozen['digest'],sourceSha256=digest(raw),
            referenceSha256=digest(self.snapshot/'reference.png'),sourceSize=size,ownershipRegion=placement['sourceRegion'],
            schemaSha256=digest(body/'schema.json')))
        answer=dict(boundaryStatus='uncertain',sourceBodyBox=None,targetBodyBox=None,
                    evidence='Fixture whole-body shape remains uncertain.',issues=['Fixture body aspect mismatch unresolved.'])
        save(body/'response.json',answer)
        save(body/'result.json',dict(status='body_observation_unresolved',answer=answer,
            responseSha256=digest(body/'response.json'),humanVisualAcceptance=False))
        self.selection=self.root/'candidate-selection.json'
        spec=dict(kind=candidate.KIND,sourceArchive=str(self.original/'ui-layers.zip'),
            sourceArchiveSha256=digest(self.original/'ui-layers.zip'),knownDifferences=['Fixture unresolved shape and visual findings.'],
            replacements=[dict(materialId=self.key,snapshot=str(self.snapshot),snapshotDigest=frozen['digest'],
                job=str(self.job),requestId=self.key,uniformAxis='width',edgeAnchor='top-left',
                hostReview=dict(directory=str(folder),requestSha256=digest(folder/'request.json'),
                    resultSha256=digest(folder/'result.json'),producerRuntime=str(Path(exchange.__file__).resolve().parents[4])),
                bodyEvidence={key:dict(path=str(body/(key+'.json')),sha256=digest(body/(key+'.json')))
                              for key in ('request','response','result','schema')})])
        save(self.selection,spec)

    def prepare(self):
        frozen=self.root/'candidate-frozen';config=candidate.freeze(self.selection,frozen)
        return frozen,config

    def test_revision_preserves_other_bytes_and_unrelated_pixels_and_discloses_blocked_body(self):
        frozen,config=self.prepare();output=self.root/'candidate-out'
        result=candidate.revise(frozen,config['digest'],output,self.viewer)
        self.assertEqual(result['status'],'pending-human-review')
        self.assertFalse(result['fullAutomaticDagPassed']);self.assertFalse(result['observedBody'])
        self.assertEqual(result['generationCalls'],0);self.assertEqual(result['modelCalls'],0)
        self.assertFalse(result['humanVisualAcceptance'])
        validate_archive(output/'delivery/ui-layers.zip')
        old=read(self.original/'package/composition.json');new=read(output/'delivery/package/composition.json')
        old_layers={l['id']:l for l in old['layers']};new_layers={l['id']:l for l in new['layers']}
        for mid,layer in old_layers.items():
            if mid!=self.key:
                self.assertEqual(layer,new_layers[mid])
                self.assertEqual((self.original/'package'/layer['path']).read_bytes(),
                                 (output/'delivery/package'/layer['path']).read_bytes())
        before=np.array(composite(self.original/'package',old));after=np.array(composite(output/'delivery/package',new))
        allowed=np.zeros(before.shape[:2],dtype=bool)
        for layer in (old_layers[self.key],new_layers[self.key]):
            allowed[layer['y']:layer['y']+layer['height'],layer['x']:layer['x']+layer['width']]=True
        self.assertTrue(np.array_equal(before[~allowed],after[~allowed]))
        self.assertIn('body_observation_unresolved',(output/'delivery/package/review.json').read_text('utf-8'))
        self.assertIn('blocked_no_retry',(output/'delivery/package/review.json').read_text('utf-8'))
        self.assertNotIn(str(self.root),(output/'delivery/package/review.json').read_text('utf-8'))
        self.assertEqual(result['replacements'][0]['bodyEvidence']['result']['status'],'body_observation_unresolved')
        self.assertEqual(result['replacements'][0]['hostReview']['result']['status'],'blocked_no_retry')

    def test_height_axis_bottom_anchor_preserves_aspect_and_expands_instead_of_contain_recentering(self):
        source=self.root/'wide.png';image=Image.new('RGBA',(104,24))
        ImageDraw.Draw(image).rectangle((2,2,101,21),fill=(30,70,110,200));image.putpixel((1,1),(2,4,6,1));image.save(source)
        owner=[100,200,200,300]
        rendered,geometry=candidate.transform(source,owner,(1000,1000),'height','bottom-left')
        region=geometry['layerCanvasRegion']
        self.assertEqual(region[0],owner[0]);self.assertEqual(region[3],owner[3])
        self.assertEqual(rendered.height,100);self.assertGreater(rendered.width,100)
        self.assertGreater(region[2],owner[2]);self.assertEqual(region[1],owner[1])
        self.assertFalse(geometry['implicitShrink']);self.assertFalse(geometry['alphaSupportClipped'])
        full=geometry['sourceFullAlphaBox'];self.assertEqual(full,[1,1,102,22])
        self.assertAlmostEqual(geometry['uniformScale'],96/(full[3]-full[1]+4))
        alpha=np.array(rendered)[:,:,3]
        self.assertFalse(alpha[:2,:].any());self.assertFalse(alpha[-2:,:].any())
        self.assertTrue(np.any((alpha>0)&(alpha<255)))

    def test_width_axis_wrong_aspect_can_extend_below_owner_and_is_never_recentred(self):
        source=self.root/'tall.png';image=Image.new('RGBA',(24,104))
        ImageDraw.Draw(image).rectangle((2,2,21,101),fill=(80,90,110,200));image.save(source)
        rendered,geometry=candidate.transform(source,[100,200,200,300],(1000,1000),'width','top-left')
        self.assertEqual(geometry['layerCanvasRegion'][:2],[100,200]);self.assertEqual(rendered.width,100)
        self.assertGreater(geometry['layerCanvasRegion'][3],300)
        with self.assertRaisesRegex(ValueError,'OUTSIDE_REFERENCE_NO_SHRINK'):
            candidate.transform(source,[100,950,200,990],(1000,1000),'width','top-left')

    def test_receipt_tampering_and_frozen_axis_change_are_rejected(self):
        frozen,config=self.prepare()
        receipt=self.job/'attempts'/self.key/'received.json';receipt.write_bytes(receipt.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'INPUT_CHANGED'):
            candidate.revise(frozen,config['digest'],self.root/'tampered',self.viewer)
        self.assertFalse((self.root/'tampered').exists())
        selected=read(frozen/'selection.json');selected['replacements'][0]['uniformAxis']='height'
        (frozen/'selection.json').write_text(json.dumps(selected),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'SELECTION_CHANGED'):
            candidate.revise(frozen,config['digest'],self.root/'changed-axis',self.viewer)

    def test_old_source_preview_is_recomposed_even_when_archive_hashes_are_valid(self):
        test_package_revision.PackageRevisionTests._rebuild_source(self,lambda files:files.update({'preview.png':self._false_preview()}))
        # _rebuild_source changes this test's selection source archive and hash.
        frozen,config=self.prepare()
        with self.assertRaisesRegex(ValueError,'SOURCE_PREVIEW_MISMATCH'):
            candidate.revise(frozen,config['digest'],self.root/'false-preview',self.viewer)
        self.assertFalse((self.root/'false-preview/delivery').exists())

    def _false_preview(self):
        import io
        buffer=io.BytesIO();Image.new('RGBA',(1000,1000),'red').save(buffer,format='PNG');return buffer.getvalue()

    def test_unknown_geometry_and_source_runtime_change_are_rejected(self):
        spec=read(self.selection);spec['replacements'][0]['uniformAxis']='contain'
        self.selection.write_text(json.dumps(spec),encoding='utf-8')
        with self.assertRaises(Exception):candidate.freeze(self.selection,self.root/'bad-axis')
        self.assertFalse((self.root/'bad-axis').exists())


if __name__=='__main__':unittest.main()
