import _bootstrap  # Enable source-layout imports for unittest discovery.
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

import test_compile_visual
from ai_ui_layers.body_registration import POLICY, KIND, checked_inputs, process
from ai_ui_layers.evaluate import digest, read, save
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.preview_partial import preview
from ai_ui_layers.automatic_registration import run as automatic_run
from ai_ui_layers.accepted_materials import replay
from ai_ui_layers.delivery_dag import main as delivery_main


class BodyRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root/'source.png'
        self.reference = self.root/'reference.png'
        self.evidence = self.root/'observation.json'
        self.region = [20, 20, 180, 100]
        self.body = [20, 20, 60, 40]
        self.target = [70, 45, 110, 65]
        self.material_id = 'button'
        self.snapshot_digest = 'a'*64
        Image.new('RGB', (200, 120), 'gray').save(self.reference)
        self.make_source()

    def make_source(self):
        image = Image.new('RGBA', (80, 60))
        draw = ImageDraw.Draw(image)
        draw.rectangle((20, 20, 59, 39), fill=(210, 30, 40, 255))
        draw.rectangle((32, 26, 41, 33), fill=(0, 0, 0, 0))
        image.putpixel((18, 18), (80, 30, 20, 3))
        image.putpixel((61, 41), (80, 30, 20, 3))
        image.save(self.source)

    def bound_entry(self, *, source_body=None, target_body=None, changes=None,
                    observation_changes=None):
        source_body=source_body or self.body
        target_body=target_body or self.target
        observation=dict(kind='ui_body_observation_v1',snapshotDigest=self.snapshot_digest,
                         materialId=self.material_id,sourceSha256=digest(self.source),
                         referenceSha256=digest(self.reference),sourceBodyBox=source_body,
                         targetBodyBox=target_body,boundaryStatus='complete',issues=[])
        observation.update(observation_changes or {})
        self.evidence.write_text(json.dumps(observation),encoding='utf-8')
        contract = dict(kind=KIND, snapshotDigest=self.snapshot_digest,
                        materialId=self.material_id, sourceSha256=digest(self.source),
                        referenceSha256=digest(self.reference),
                        sourceBodyBox=source_body,
                        targetBodyBox=target_body,
                        evidence=dict(path=str(self.evidence), sha256=digest(self.evidence),
                                      basis='reviewed visible body; shadow excluded'), issues=[])
        contract.update(changes or {})
        path = self.root/('contract-'+str(len(list(self.root.glob('contract-*.json'))))+'.json')
        save(path, contract)
        return dict(path=str(path), sha256=digest(path))

    def place(self, entry, name='placed', *, region=None, material_id=None, snapshot_digest=None):
        return process(self.source, self.reference, entry, region or self.region,
                       material_id or self.material_id, snapshot_digest or self.snapshot_digest,
                       self.root/name)

    def test_wide_planning_crop_does_not_expand_visible_body(self):
        result = self.place(self.bound_entry())
        self.assertEqual(result['fitting']['mode'], POLICY)
        self.assertEqual(result['fitting']['uniformScale'], 1)
        self.assertEqual(result['fitting']['layerCanvasRegion'], self.region)
        self.assertEqual(result['status'], 'processed_pending_visual_review')
        self.assertFalse(result['humanVisualAcceptance'])
        with Image.open(self.root/'placed/material.png') as image:
            self.assertEqual(image.size, (160, 80))
            # The 40x20 body remains at the observed position, while the
            # old crop fit would have enlarged it toward 160x80.
            self.assertEqual(image.getpixel((50, 25))[3], 255)
            self.assertEqual(image.getpixel((89, 44))[3], 255)
            self.assertEqual(image.getpixel((20, 25))[3], 0)
            self.assertEqual(image.getpixel((110, 25))[3], 0)

    def test_uniform_scale_position_shadow_and_hole_survive(self):
        result = self.place(self.bound_entry(target_body=[70, 45, 150, 85]))
        self.assertEqual(result['fitting']['uniformScale'], 2)
        self.assertAlmostEqual(result['fitting']['rasterScaleXY'][0],
                               result['fitting']['rasterScaleXY'][1])
        with Image.open(self.root/'placed/material.png') as image:
            self.assertEqual(image.getpixel((60, 35))[3], 255)
            self.assertEqual(image.getpixel((120, 55))[3], 255)
            self.assertGreater(image.getpixel((46, 21))[3], 0)  # faint exterior pixel
            self.assertEqual(image.getpixel((80, 40))[3], 0)  # transparent interior hole
        self.assertEqual(read(self.root/'placed/report.json')['materialSha256'],
                         digest(self.root/'placed/material.png'))

    def test_body_aspect_mismatch_blocks_instead_of_stretching(self):
        entry = self.bound_entry(target_body=[70, 45, 150, 75])  # 80x30 vs 40x20
        with self.assertRaisesRegex(ValueError, 'BODY_PROPORTIONS_DIFFER'):
            self.place(entry)
        self.assertFalse((self.root/'placed/material.png').exists())

    def test_every_nonzero_alpha_pixel_must_fit_output_region(self):
        image = Image.open(self.source).convert('RGBA')
        image.putpixel((1, 20), (20, 20, 20, 1))
        image.save(self.source)
        entry = self.bound_entry(target_body=[21, 45, 61, 65])
        with self.assertRaisesRegex(ValueError, 'BODY_TRANSFORM_WOULD_CLIP_ALPHA'):
            self.place(entry)

    def test_subpixel_shadow_overflow_blocks_before_it_disappears_in_sampling(self):
        image=Image.open(self.source).convert('RGBA')
        image.putpixel((1,20),(20,20,20,1));image.save(self.source)
        entry=self.bound_entry(target_body=[21,21,25,23])  # scale .1; faint pixel could vanish
        with self.assertRaisesRegex(ValueError,'BODY_TRANSFORM_WOULD_CLIP_ALPHA'):
            self.place(entry)

    def test_internal_icon_cannot_be_the_whole_body_anchor(self):
        entry=self.bound_entry(source_body=[25,22,45,32],target_body=[70,45,110,65])
        with self.assertRaisesRegex(ValueError,'SOURCE_BODY_OMITS_DENSE_ARTWORK'):
            self.place(entry)

    def test_small_subject_uses_one_affine_scale_for_both_axes(self):
        im=Image.new('RGBA',(12,12));ImageDraw.Draw(im).rectangle((4,4,5,4),fill='red');im.save(self.source)
        entry=self.bound_entry(source_body=[4,4,6,5],target_body=[70,45,73,47])
        result=self.place(entry)
        self.assertEqual(result['fitting']['rasterScaleXY'],[1.5,1.5])
        coefficients=result['fitting']['inverseAffine']
        self.assertEqual(coefficients[0],coefficients[4])

    def test_input_contract_evidence_and_scope_tampering_fail_closed(self):
        cases = [
            ('source', lambda entry: self.source.write_bytes(self.source.read_bytes()+b'x'), 'BODY_INPUT_CHANGED'),
            ('reference', lambda entry: self.reference.write_bytes(self.reference.read_bytes()+b'x'), 'BODY_INPUT_CHANGED'),
            ('contract', lambda entry: Path(entry['path']).write_text('{}', encoding='utf-8'), 'BODY_CONTRACT_CHANGED'),
            ('evidence', lambda entry: self.evidence.write_text('changed', encoding='utf-8'), 'BODY_OBSERVATION_CHANGED'),
        ]
        for name, tamper, error in cases:
            with self.subTest(name=name):
                self.make_source()
                Image.new('RGB', (200, 120), 'gray').save(self.reference)
                entry = self.bound_entry()
                tamper(entry)
                with self.assertRaisesRegex(ValueError, error):
                    self.place(entry, 'reject-'+name)
        self.make_source()
        Image.new('RGB', (200, 120), 'gray').save(self.reference)
        entry = self.bound_entry()
        for kwargs in (dict(material_id='other'), dict(snapshot_digest='b'*64),
                       dict(region=[80, 20, 180, 100])):
            with self.subTest(scope=kwargs):
                with self.assertRaisesRegex(ValueError, 'BODY_CONTRACT_SCOPE_MISMATCH|TARGET_BODY_OUTSIDE_MATERIAL'):
                    self.place(entry, 'scope-'+str(len(kwargs))+str(next(iter(kwargs))), **kwargs)

    def test_observation_scope_and_boundary_status_must_match_contract(self):
        changes=(dict(snapshotDigest='b'*64),dict(materialId='other'),
                 dict(sourceSha256='0'*64),dict(referenceSha256='0'*64),
                 dict(sourceBodyBox=[19,20,61,40]),dict(targetBodyBox=[71,45,111,65]),
                 dict(boundaryStatus='partial'),dict(issues=['uncertain boundary']))
        for i,changed in enumerate(changes):
            with self.subTest(changed=changed):
                entry=self.bound_entry(observation_changes=changed)
                with self.assertRaises(ValueError):
                    self.place(entry,'bad-observation-'+str(i))
                self.assertFalse((self.root/('bad-observation-'+str(i))/'material.png').exists())

    def test_missing_or_conflicting_evidence_never_selects_legacy_fit(self):
        entry = self.bound_entry()
        base = dict(registrationPolicy=POLICY, wholePlacements={'button':entry})
        self.assertEqual(set(checked_inputs(base, [], {'button'})), {'button'})
        for changed, error in (
            ({'wholePlacements':{}}, 'COMPLETE_BODY_EVIDENCE_REQUIRED'),
            ({'wholePlacements':{'button':entry,'other':entry}}, 'COMPLETE_BODY_EVIDENCE_REQUIRED'),
            ({'partPlacements':{'button':'part.json'}}, 'BODY_POLICY_CONFLICTING_OVERRIDES'),
            ({'frameBoundsMaterials':['button']}, 'BODY_POLICY_CONFLICTING_OVERRIDES'),
        ):
            with self.subTest(changed=changed):
                with self.assertRaisesRegex(ValueError, error):
                    checked_inputs({**base, **changed}, [], {'button'})
        with self.assertRaisesRegex(ValueError, 'BODY_POLICY_REQUIRED'):
            checked_inputs({'wholePlacements':{'button':entry}}, [], {'button'})
        with self.assertRaisesRegex(ValueError, 'BODY_CONTRACT_CHANGED'):
            checked_inputs({**base,'wholePlacements':{'button':{**entry,'sha256':'0'*64}}}, [], {'button'})

    def test_variant_replay_reconstructs_exact_body_pixels_and_contract(self):
        entry=self.bound_entry()
        report=self.place(entry)
        job=self.root/'received-job'
        (job/'snapshot').mkdir(parents=True)
        (job/'snapshot/reference.png').write_bytes(self.reference.read_bytes())
        selection=dict(job=str(job),requestId=self.material_id,sourceMaterialId=self.material_id)
        row=dict(id=self.material_id,sourceSha256=digest(self.source),report=report)
        placement=dict(sourceRegion=self.region,outputSize=[160,80])
        with patch('ai_ui_layers.accepted_materials.received',
                   return_value=(self.source, {}, {'sourceReceipt':'fixture'})):
            output,lineage=replay(selection,row,placement,'foreground',digest(self.reference),
                                  self.root/'replay')
        self.assertEqual(digest(output),report['materialSha256'])
        self.assertEqual(lineage['processing']['fitting']['mode'],POLICY)
        self.assertEqual(digest(self.root/'replay/body-contract.json'),report['bodyContractSha256'])

    def test_variant_replay_rejects_noncanonical_embedded_contract(self):
        report=self.place(self.bound_entry())
        report['bodyContractSha256']='0'*64
        row=dict(id=self.material_id,sourceSha256=digest(self.source),report=report)
        job=self.root/'received-job'
        (job/'snapshot').mkdir(parents=True)
        (job/'snapshot/reference.png').write_bytes(self.reference.read_bytes())
        selection=dict(job=str(job),requestId=self.material_id,sourceMaterialId=self.material_id)
        with patch('ai_ui_layers.accepted_materials.received',
                   return_value=(self.source, {}, {})):
            with self.assertRaisesRegex(ValueError,'BODY_CONTRACT_REPLAY_MISMATCH'):
                replay(selection,row,dict(sourceRegion=self.region,outputSize=[160,80]),
                       'foreground',digest(self.reference),self.root/'replay')


class BodyRegistrationPreviewTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        self.key = 'asset-buy-button'
        material = next(m for m in self.visual['materials'] if m['id']==self.key)
        l,t,r,b = material['bboxNorm']
        self.visual['objects'].append(dict(id='owned-icon', materialId=self.key,
            kind='icon', label='Fixed icon inside button',
            bboxNorm=[l+.02, t+.01, l+.04, t+.04]))
        (self.run/'m1/draft.json').write_text(json.dumps(self.visual),encoding='utf-8')
        for path in (self.run/'result.json', self.run/'m2/request.json'):
            data=read(path);data['sourcePlanSha256']=digest(self.run/'m1/draft.json')
            path.write_text(json.dumps(data),encoding='utf-8')
        self.snapshot=self.root/'snapshot'
        frozen=freeze(self.run,self.snapshot,5)
        self.snapshot_digest=frozen['digest']
        self.source=self.root/'raw.png'
        image=Image.new('RGBA',(120,80))
        draw=ImageDraw.Draw(image)
        draw.rectangle((20,20,99,59),fill=(120,40,30,255))
        draw.rectangle((30,26,39,35),fill=(240,210,50,255))
        image.save(self.source)
        evidence=self.root/'observation.json'
        save(evidence,dict(kind='ui_body_observation_v1',snapshotDigest=self.snapshot_digest,
            materialId=self.key,sourceSha256=digest(self.source),
            referenceSha256=digest(self.snapshot/'reference.png'),
            sourceBodyBox=[20,20,100,60],targetBodyBox=[600,780,680,820],
            boundaryStatus='complete',issues=[]))
        contract=self.root/'body.json'
        save(contract,dict(kind=KIND,snapshotDigest=self.snapshot_digest,materialId=self.key,
            sourceSha256=digest(self.source),referenceSha256=digest(self.snapshot/'reference.png'),
            sourceBodyBox=[20,20,100,60],targetBodyBox=[600,780,680,820],
            evidence=dict(path=str(evidence),sha256=digest(evidence),basis='reviewed whole button body'),
            issues=[]))
        self.config=self.root/'config.json'
        save(self.config,dict(snapshot=str(self.snapshot),snapshotDigest=self.snapshot_digest,
            materials={self.key:str(self.source)},registrationPolicy=POLICY,
            wholePlacements={self.key:dict(path=str(contract),sha256=digest(contract))}))

    def test_preview_integrated_material_uses_body_transform(self):
        report=preview(self.config,self.root/'preview')
        self.assertEqual(report['registrationPolicy'],POLICY)
        fitted=report['records'][0]['report']['fitting']
        self.assertEqual(fitted['mode'],POLICY)
        self.assertEqual(fitted['targetBodyBox'],[600,780,680,820])
        with Image.open(self.root/'preview'/self.key/'material.png') as image:
            self.assertEqual(image.getchannel('A').getbbox(),(100,30,180,70))

    def test_automatic_opt_in_does_not_call_model_or_frame_fit(self):
        def forbidden(_):
            raise AssertionError('opt-in explicit evidence must not call localization model')
        result=automatic_run(self.config,self.root/'automatic',model_call=forbidden)
        self.assertEqual(result['modelCalls'],0)
        self.assertEqual(result['localizations'],[])
        report=read(self.root/'automatic/preview'/self.key/'report.json')
        self.assertEqual(report['fitting']['mode'],POLICY)
        self.assertEqual(report['materialSha256'],digest(self.root/'automatic/preview'/self.key/'material.png'))

    def test_preview_missing_evidence_and_conflicts_stop_before_output(self):
        base=read(self.config)
        for change, error in (({'wholePlacements':{}},'COMPLETE_BODY_EVIDENCE_REQUIRED'),
                              ({'frameBoundsMaterials':[self.key]},'BODY_POLICY_CONFLICTING_OVERRIDES'),
                              ({'partPlacements':{self.key:'parts.json'}},'BODY_POLICY_CONFLICTING_OVERRIDES')):
            with self.subTest(change=change):
                config=self.root/('bad-'+str(len(list(self.root.glob('bad-*.json'))))+'.json')
                save(config,{**base,**change})
                out=self.root/('bad-out-'+str(len(list(self.root.glob('bad-out-*')))))
                with self.assertRaisesRegex(ValueError,error):
                    preview(config,out)
                self.assertFalse(out.exists())

    def test_public_cli_opt_in_route_is_explicit_and_model_free(self):
        output=self.root/'cli-output'
        stdout=io.StringIO()
        with patch('sys.argv',['ui-layer','register-materials','--config',str(self.config),
                               '--output',str(output)]), \
             patch('ai_ui_layers.delivery_dag.register',return_value=dict(status='awaiting_visual_review',
                 modelCalls=0)) as registered, \
             patch('sys.stdout',stdout):
            delivery_main()
        registered.assert_called_once_with(str(self.config),str(output),selected=[])
        self.assertEqual(json.loads(stdout.getvalue())['modelCalls'],0)
        legacy=self.root/'legacy-cli.json'
        config=read(self.config);config.pop('registrationPolicy');save(legacy,config)
        with patch('sys.argv',['ui-layer','register-materials','--config',str(legacy),
                               '--output',str(self.root/'blocked-cli')]), \
             patch('ai_ui_layers.delivery_dag.register') as registered, \
             patch('sys.stdout',io.StringIO()):
            with self.assertRaises(SystemExit):delivery_main()
        registered.assert_not_called()


if __name__ == '__main__':
    unittest.main()
