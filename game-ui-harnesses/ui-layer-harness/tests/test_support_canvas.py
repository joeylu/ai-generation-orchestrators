import _bootstrap  # Enable source-layout imports for unittest discovery.
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from ai_ui_layers.accepted_materials import replay
from ai_ui_layers.body_registration import KIND, POLICY, POLICY_SUPPORT, checked_inputs, process
from ai_ui_layers.evaluate import digest, read, save
from ai_ui_layers.freeze_visual import body_digest
from ai_ui_layers.layer_package import build, sources_from_preview
from ai_ui_layers.preview_partial import preview as make_preview


class SupportCanvasTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name)
        self.snapshot_digest='a'*64
        self.source=self.root/'source.png'
        self.reference=self.root/'reference.png'
        self.region=[20,20,180,100]
        self.body=[20,20,60,40]
        self.target=[21,45,61,65]
        Image.new('RGB',(200,120),'gray').save(self.reference)
        image=Image.new('RGBA',(80,60))
        ImageDraw.Draw(image).rectangle((20,20,59,39),fill=(210,30,40,255))
        image.putpixel((1,20),(60,40,20,1))
        image.save(self.source)
        observation=self.root/'observation.json'
        save(observation,dict(kind='ui_body_observation_v1',snapshotDigest=self.snapshot_digest,
            materialId='button',sourceSha256=digest(self.source),referenceSha256=digest(self.reference),
            sourceBodyBox=self.body,targetBodyBox=self.target,boundaryStatus='complete',issues=[]))
        contract=self.root/'contract.json'
        save(contract,dict(kind=KIND,snapshotDigest=self.snapshot_digest,materialId='button',
            sourceSha256=digest(self.source),referenceSha256=digest(self.reference),
            sourceBodyBox=self.body,targetBodyBox=self.target,
            evidence=dict(path=str(observation),sha256=digest(observation),basis='reviewed body'),issues=[]))
        self.entry=dict(path=str(contract),sha256=digest(contract))

    def place(self, output, policy=POLICY_SUPPORT):
        return process(self.source,self.reference,self.entry,self.region,'button',
                       self.snapshot_digest,output,policy=policy)

    def test_policy_explicit_and_old_clip_preserved(self):
        self.assertEqual(set(checked_inputs(dict(registrationPolicy=POLICY_SUPPORT,
            wholePlacements={'button':self.entry}),[],{'button'})),{'button'})
        with self.assertRaisesRegex(ValueError,'BODY_TRANSFORM_WOULD_CLIP_ALPHA'):
            self.place(self.root/'legacy',POLICY)
        self.assertFalse((self.root/'legacy').exists())
        report=self.place(self.root/'support')
        fit=report['fitting'];l,t,r,b=fit['layerCanvasRegion']
        self.assertEqual(fit['mode'],POLICY_SUPPORT)
        self.assertEqual(fit['ownershipRegion'],self.region)
        self.assertEqual(report['bodyContractCanonicalDigest'],body_digest(report['bodyContract']))
        self.assertLess(l,self.region[0])
        self.assertEqual(report['targetSize'],[r-l,b-t])
        with Image.open(self.root/'support/material.png') as im:
            self.assertEqual(im.size,(r-l,b-t))
            self.assertEqual(im.getpixel((21-l,45-t))[3],255)
            self.assertGreater(im.getpixel((2-l,45-t))[3],0)

    def test_true_reference_overflow_blocks(self):
        with Image.open(self.source) as im:image=im.convert('RGBA')
        image.putpixel((0,20),(60,40,20,1));image.save(self.source)
        observation=self.root/'overflow-observation.json'
        save(observation,dict(kind='ui_body_observation_v1',snapshotDigest=self.snapshot_digest,
            materialId='button',sourceSha256=digest(self.source),referenceSha256=digest(self.reference),
            sourceBodyBox=self.body,targetBodyBox=[1,45,41,65],boundaryStatus='complete',issues=[]))
        contract=self.root/'overflow-contract.json'
        save(contract,dict(kind=KIND,snapshotDigest=self.snapshot_digest,materialId='button',
            sourceSha256=digest(self.source),referenceSha256=digest(self.reference),
            sourceBodyBox=self.body,targetBodyBox=[1,45,41,65],
            evidence=dict(path=str(observation),sha256=digest(observation),basis='reviewed body'),issues=[]))
        self.entry=dict(path=str(contract),sha256=digest(contract))
        # Shift the ownership area to the actual reference edge.
        self.region=[0,20,80,100]
        with self.assertRaisesRegex(ValueError,'BODY_TRANSFORM_WOULD_CLIP_REFERENCE'):
            self.place(self.root/'overflow')
        self.assertFalse((self.root/'overflow').exists())

    def test_support_package_and_fingerprint_binding(self):
        snapshot=self.root/'snapshot';(snapshot/'evidence').mkdir(parents=True)
        (snapshot/'reference.png').write_bytes(self.reference.read_bytes())
        background=self.root/'background.png'
        Image.new('RGBA',(200,120),(50,60,70,255)).save(background)
        placements=[dict(id='background',drawIndex=0,sourceRegion=[0,0,200,120],
                         outputSize=[200,120],xy=[0,0]),
                    dict(id='button',drawIndex=1,sourceRegion=self.region,
                         outputSize=[160,80],xy=[20,20])]
        save(snapshot/'placements.json',dict(materials=placements))
        save(snapshot/'execution-plan.candidate.json',dict(canvas=[200,120],assets=[
            dict(id='background',role='background'),dict(id='button',role='foreground')]))
        save(snapshot/'evidence/m1-draft.json',dict(textPolicy='remove-business-text',
            backgroundMode='scene-only',objects=[],materials=[
                dict(id='background',label='Background',role='background'),
                dict(id='button',label='Button',role='foreground')]))
        config=self.root/'preview-config.json'
        save(config,dict(snapshot=str(snapshot),snapshotDigest=self.snapshot_digest,
            materials={'background':str(background),'button':str(self.source)},
            registrationPolicy=POLICY_SUPPORT,wholePlacements={'button':self.entry}))
        preview=self.root/'preview'
        with patch('ai_ui_layers.preview_partial.inspect',return_value={'digest':self.snapshot_digest}):
            make_preview(config,preview)
        report=read(preview/'button/report.json')
        l,t,r,b=report['fitting']['layerCanvasRegion']
        expected=Image.new('RGBA',(200,120),(50,60,70,255))
        with Image.open(preview/'button/material.png') as layer:
            expected.alpha_composite(layer,(l,t))
        with Image.open(preview/'partial-transparent.png') as image:
            self.assertEqual(image.tobytes(),expected.tobytes())
        viewer=self.root/'viewer';viewer.mkdir()
        (viewer/'viewer.html').write_text('<html></html>',encoding='utf-8')
        (viewer/'viewer.js').write_text('void 0;',encoding='utf-8')
        with patch('ai_ui_layers.layer_package.inspect',return_value={'digest':self.snapshot_digest}):
            sources=sources_from_preview(snapshot,preview)
            result=build(snapshot,sources,self.root/'package',viewer)
        self.assertEqual(result['layerCount'],2)
        composition=read(self.root/'package/package/composition.json')
        layer=composition['layers'][1]
        self.assertEqual([layer['x'],layer['y'],layer['width'],layer['height']],
                         [l,t,r-l,b-t])
        with Image.open(self.root/'package/package/preview.png') as im:
            self.assertEqual(im.tobytes(),expected.tobytes())
        (preview/'button/report.json').write_text('{}',encoding='utf-8')
        with patch('ai_ui_layers.layer_package.inspect',return_value={'digest':self.snapshot_digest}):
            with self.assertRaisesRegex(ValueError,'SUPPORT_REPORT_CHANGED'):
                build(snapshot,sources,self.root/'tampered-package',viewer)
        changed=dict(report,fitting=dict(report['fitting'],ownershipRegion=[0,20,180,100]))
        (preview/'button/report.json').write_text(json.dumps(changed),encoding='utf-8')
        outer=read(preview/'report.json')
        next(row for row in outer['records'] if row['id']=='button')['report']=changed
        (preview/'report.json').write_text(json.dumps(outer),encoding='utf-8')
        with patch('ai_ui_layers.layer_package.inspect',return_value={'digest':self.snapshot_digest}):
            with self.assertRaisesRegex(ValueError,'SUPPORT_OWNERSHIP_MISMATCH'):
                sources_from_preview(snapshot,preview)

    def test_replay_exact_geometry_and_tamper(self):
        report=self.place(self.root/'support')
        job=self.root/'job';(job/'snapshot').mkdir(parents=True)
        (job/'snapshot/reference.png').write_bytes(self.reference.read_bytes())
        entry=dict(job=str(job),requestId='button',sourceMaterialId='button')
        row=dict(id='button',sourceSha256=digest(self.source),report=report)
        placement=dict(sourceRegion=self.region,outputSize=[160,80])
        with patch('ai_ui_layers.accepted_materials.received',return_value=(self.source,{},{})):
            result,lineage=replay(entry,row,placement,'foreground',digest(self.reference),
                                  self.root/'replay')
        self.assertEqual(digest(result),report['materialSha256'])
        self.assertEqual(lineage['processing']['fitting'],report['fitting'])
        changed=dict(row,report=dict(report,fitting=dict(report['fitting'],
                     layerCanvasRegion=[0,20,180,100])))
        with patch('ai_ui_layers.accepted_materials.received',return_value=(self.source,{},{})):
            with self.assertRaisesRegex(ValueError,'SUPPORT_GEOMETRY_REPLAY_MISMATCH'):
                replay(entry,changed,placement,'foreground',digest(self.reference),
                       self.root/'tampered-replay')


if __name__=='__main__':
    unittest.main()
