import _bootstrap
import copy
import hashlib
import io
import json
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

import test_layer_package
from ai_ui_layers.body_registration import KIND, POLICY_SUPPORT
from ai_ui_layers.body_viewport_delivery import build, CANVAS_POLICY, BACKGROUND_POLICY
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.viewport_geometry_revision import validate_viewport_archive


def rewrite(path, value):
    Path(path).write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')


class BodyViewportDeliveryTests(unittest.TestCase):
    def setUp(self):
        test_layer_package.LayerPackageTests.setUp(self)
        config = dict(snapshot=str(self.snapshot),snapshotDigest=read(self.snapshot/'snapshot.json')['digest'],
                      materials={k:v['path'] for k,v in read(self.evidence)['sources'].items()})
        config.update(registrationPolicy=POLICY_SUPPORT, wholePlacements={}, canvasPolicy=CANVAS_POLICY,
                      canvasPolicyInstruction='Fixture approved complete storage and exact original viewport.')
        config['canvasPolicyInstructionSha256'] = hashlib.sha256(config['canvasPolicyInstruction'].encode()).hexdigest()
        placements = read(self.snapshot/'placements.json')['materials']
        first = True
        for row in placements:
            mid = row['id']
            material = next(m for m in self.visual['materials'] if m['id']==mid)
            if material['role'] != 'foreground':
                continue
            # A real alpha=1 support pixel maps left of the original viewport.
            region = row['sourceRegion']
            left, top = region[:2]
            body_left = left+20 if first else 10
            width = max(30, body_left+20)
            image = Image.new('RGBA', (width, 30))
            ImageDraw.Draw(image).rectangle((body_left,10,body_left+9,19), fill=(100,80,60,255))
            image.putpixel((1,10),(50,30,20,1))
            image.save(Path(config['materials'][mid]))
            target = [left+10,top+10,left+20,top+20]
            source_body = [body_left,10,body_left+10,20]
            observation = dict(kind='ui_body_observation_v1', snapshotDigest=config['snapshotDigest'], materialId=mid,
                               sourceSha256=digest(Path(config['materials'][mid])), referenceSha256=digest(self.snapshot/'reference.png'),
                               sourceBodyBox=source_body, targetBodyBox=target, boundaryStatus='complete', issues=[])
            evidence = self.root/(mid+'-observation.json'); save(evidence, observation)
            contract = dict(observation, kind=KIND, evidence=dict(path=str(evidence),sha256=digest(evidence),basis='Fixture whole-body finding'))
            del contract['boundaryStatus']
            path = self.root/(mid+'-contract.json');save(path,contract)
            config['wholePlacements'][mid] = dict(path=str(path),sha256=digest(path))
            if first:
                self.outside_id = mid
                first = False
        self.config = config
        self.config_path = self.root/'body-registration-input.json';save(self.config_path,config)

    def test_full_alpha_world_storage_and_original_reference_byte_identity(self):
        output = self.root/'delivery'
        result = build(self.config_path,output,self.viewer)
        self.assertEqual(result['status'],'pending-human-review')
        self.assertFalse(result['humanVisualAcceptance'])
        self.assertEqual(result['generationCalls'],0)
        self.assertEqual(result['modelCalls'],0)
        self.assertNotIn('fullAutomaticDagPassed',result)
        self.assertEqual((output/'original-reference.png').read_bytes(),(self.snapshot/'reference.png').read_bytes())
        validate_viewport_archive(output/'viewport-ui-layers.zip')
        viewport = result['viewport'];self.assertGreater(viewport['worldShift'][0],0)
        composition = read(output/'package/composition.json')
        layer = next(l for l in composition['layers'] if l['id']==self.outside_id)
        with Image.open(output/'package'/layer['path']) as image:
            self.assertEqual(image.getpixel((0,0))[3],1)
        self.assertLess(layer['x'],viewport['worldViewportBox'][0])
        with zipfile.ZipFile(output/'viewport-ui-layers.zip') as wrapper:
            self.assertEqual(wrapper.read('original-reference.png'),(self.snapshot/'reference.png').read_bytes())
            with Image.open(io.BytesIO(wrapper.read('viewport-preview.png'))) as image:
                self.assertEqual(image.size,(1000,1000))
        with zipfile.ZipFile(output/'ui-layers.zip') as package:
            proof = package.read('review.json').decode()
            self.assertIn('ui_body_observation_v1',proof)
            self.assertNotIn(str(self.root),proof)
            self.assertNotIn(self.config['canvasPolicyInstruction'],proof)
            self.assertNotIn(self.config['canvasPolicyInstructionSha256'],proof)
        public_proof=(output/'body-provenance.json').read_text(encoding='utf-8')
        self.assertNotIn(self.config['canvasPolicyInstruction'],public_proof)
        self.assertNotIn('canvasPolicyInstruction',public_proof)

    def test_explicit_uniform_opaque_rgb_background_edgepad_and_source_identity(self):
        background=next(m['id'] for m in self.visual['materials'] if m['role']=='background')
        source=Path(self.config['materials'][background])
        image=Image.new('RGB',(200,100),(50,100,150))
        ImageDraw.Draw(image).rectangle((50,20,150,80),fill=(200,40,70));image.save(source)
        original=source.read_bytes()
        self.config['backgroundPolicy']=BACKGROUND_POLICY;rewrite(self.config_path,self.config)
        output=self.root/'background-policy';result=build(self.config_path,output,self.viewer)
        self.assertEqual(source.read_bytes(),original)
        composition=read(output/'package/composition.json')
        layer=next(l for l in composition['layers'] if l['id']==background)
        with Image.open(output/'package'/layer['path']) as saved:
            self.assertEqual(saved.size,(1000,1000))
            self.assertEqual(saved.getchannel('A').getextrema(),(255,255))
            self.assertEqual(saved.getpixel((500,0)),(50,100,150,255))
            self.assertEqual(saved.getpixel((500,500)),(200,40,70,255))
        record=next(r for r in read(output/'body-provenance.json')['records'] if r['materialId']==background)
        geometry=record['backgroundGeometry']
        self.assertEqual(geometry['sourceSize'],[200,100]);self.assertEqual(geometry['uniformScale'],5)
        self.assertEqual(geometry['backgroundEdgePadding'],[0,250,0,250])
        self.assertFalse(geometry['axisStretch'])
        self.assertFalse(result['humanVisualAcceptance'])
        rgba=image.convert('RGBA');rgba.putpixel((0,0),(1,2,3,254));rgba.save(source)
        with self.assertRaisesRegex(ValueError,'BACKGROUND_NATIVE_OPAQUE_REQUIRED'):
            build(self.config_path,self.root/'translucent-background',self.viewer)

    def test_tampered_source_contract_and_observation_reject_before_output(self):
        mid = self.outside_id
        source = Path(self.config['materials'][mid])
        original = source.read_bytes();source.write_bytes(original+b'x')
        with self.assertRaisesRegex(ValueError,'BODY_INPUT_CHANGED'):
            build(self.config_path,self.root/'tampered',self.viewer)
        self.assertFalse((self.root/'tampered').exists())
        source.write_bytes(original)
        contract = Path(self.config['wholePlacements'][mid]['path'])
        original = contract.read_bytes();contract.write_bytes(original+b'x')
        with self.assertRaisesRegex(ValueError,'BODY_CONTRACT_CHANGED'):
            build(self.config_path,self.root/'tampered-contract',self.viewer)

    def test_duplicate_input_keys_and_changed_findings_reject(self):
        original = self.config_path.read_bytes()
        self.config_path.write_text('{"materials":{},"materials":{}}',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'DUPLICATE_INPUT_FIELD'):
            build(self.config_path,self.root/'duplicate-input',self.viewer)
        self.config_path.write_bytes(original)
        entry = self.config['wholePlacements'][self.outside_id]
        contract = read(Path(entry['path']))
        finding = Path(contract['evidence']['path'])
        finding.write_bytes(finding.read_bytes()+b'x')
        with self.assertRaisesRegex(ValueError,'BODY_OBSERVATION_CHANGED'):
            build(self.config_path,self.root/'changed-finding',self.viewer)

    def test_strict_dense_body_and_unknown_boundary_gates_survive_expansion(self):
        mid=self.outside_id;entry=self.config['wholePlacements'][mid]
        path=Path(entry['path']);original_contract=read(path)
        finding=Path(original_contract['evidence']['path']);original_finding=read(finding)
        cases=[('boundaryStatus','uncertain','BODY_OBSERVATION_UNRESOLVED'),
               ('sourceBodyBox',[original_finding['sourceBodyBox'][0]+1,11,
                                 original_finding['sourceBodyBox'][2]-1,19],'SOURCE_BODY_OMITS_DENSE_ARTWORK'),
               ('targetBodyBox',[110,60,115,70],'BODY_PROPORTIONS_DIFFER')]
        for i,(field,value,reason) in enumerate(cases):
            observation=dict(original_finding,**{field:value});rewrite(finding,observation)
            contract=copy.deepcopy(original_contract)
            if field in contract:contract[field]=value
            contract['evidence']['sha256']=digest(finding);rewrite(path,contract)
            rewrite(self.config_path,dict(self.config,wholePlacements=dict(self.config['wholePlacements'],
                **{mid:dict(path=str(path),sha256=digest(path))})))
            with self.subTest(field=field), self.assertRaisesRegex(ValueError,reason):
                build(self.config_path,self.root/('strict-'+str(i)),self.viewer)

    def test_incomplete_set_and_unapproved_policy_fail_closed(self):
        changes = [dict(materials={}), dict(wholePlacements={}), dict(canvasPolicy='preserve-alpha-in-reference-v1'),
                   dict(canvasPolicyInstruction=''),dict(canvasPolicyInstructionSha256='0'*64)]
        for i, change in enumerate(changes):
            with self.subTest(change=change):
                rewrite(self.config_path,dict(self.config,**change))
                with self.assertRaises(ValueError):
                    build(self.config_path,self.root/str(i),self.viewer)
                self.assertFalse((self.root/str(i)).exists())

    def test_duplicate_order_and_material_rows_are_rejected(self):
        original = read(self.snapshot/'placements.json')
        for duplicate_order in (False, True):
            changed = copy.deepcopy(original)
            if duplicate_order:
                changed['materials'][1]['drawIndex']=changed['materials'][0]['drawIndex']
            else:
                changed['materials'].append(copy.deepcopy(changed['materials'][0]))
            rewrite(self.snapshot/'placements.json',changed)
            # Isolate entry-point set/order validation; normal inspect additionally
            # rejects the tampered frozen snapshot before reaching these gates.
            with patch('ai_ui_layers.body_viewport_delivery.inspect',return_value=dict(digest=self.config['snapshotDigest'])):
                with self.assertRaisesRegex(ValueError,'COMPLETE_LAYER_SET_REQUIRED|AMBIGUOUS_ORDER'):
                    build(self.config_path,self.root/'duplicate',self.viewer)
            rewrite(self.snapshot/'placements.json',original)

    def test_large_union_canvas_rejects_before_world_reference_allocation(self):
        from ai_ui_layers import body_viewport_delivery as module
        small=Image.new('RGBA',(1,1),(1,2,3,255))
        real_new=Image.new
        def guarded_new(mode,size,*args,**kwargs):
            if size[0]*size[1]>16_777_216:
                self.fail('expanded world allocated before canvas pixel validation')
            return real_new(mode,size,*args,**kwargs)
        def remote_support(source,geometry):
            return small,dict(geometry,layerCanvasRegion=[-4000,-4000,-3999,-3999])
        with patch.object(module,'transform',side_effect=remote_support), \
             patch('PIL.Image.new',side_effect=guarded_new):
            with self.assertRaisesRegex(ValueError,'CANVAS_PIXEL_LIMIT'):
                build(self.config_path,self.root/'huge-world',self.viewer)
        self.assertFalse((self.root/'huge-world').exists())

    def test_uncertain_or_partial_body_and_background_stretch_reject(self):
        mid = self.outside_id;entry=self.config['wholePlacements'][mid]
        path=Path(entry['path']);contract=read(path);original=path.read_bytes()
        for field,value,reason in [('issues',['unresolved'],'BODY_OBSERVATION_UNRESOLVED'),
                                   ('sourceBodyBox',[121,11,129,19],'BODY_OBSERVATION_SCOPE_MISMATCH')]:
            changed=dict(contract,**{field:value});rewrite(path,changed)
            rewrite(self.config_path,dict(self.config,wholePlacements=dict(self.config['wholePlacements'],
                **{mid:dict(path=str(path),sha256=digest(path))})))
            with self.assertRaisesRegex(ValueError,reason):
                build(self.config_path,self.root/'bad-body',self.viewer)
        path.write_bytes(original);rewrite(self.config_path,self.config)
        background=next(m['id'] for m in self.visual['materials'] if m['role']=='background')
        Image.new('RGBA',(500,500),(1,2,3,255)).save(self.config['materials'][background])
        with self.assertRaisesRegex(ValueError,'FROZEN_BACKGROUND_WHOLE_ORIGINAL_SIZE_REQUIRED'):
            build(self.config_path,self.root/'bad-background',self.viewer)


if __name__ == '__main__':
    unittest.main()
