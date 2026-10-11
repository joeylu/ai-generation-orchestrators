import _bootstrap
from copy import deepcopy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

import numpy as np
from PIL import Image

from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.layer_package import write_package, composite
from ai_ui_layers import layout_registration_revision as layout
from ai_ui_layers import viewport_geometry_revision as viewport


class LayoutRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)
        self.viewer=self.root/'viewer';self.viewer.mkdir()
        for name in ('viewer.html','viewer.js'):(self.viewer/name).write_text('fixture',encoding='utf-8')
        self.reference=self.root/'reference.png'
        Image.new('RGBA',(160,128),(220,230,240,255)).save(self.reference)
        (self.root/'native').mkdir();self.source=self.root/'native/source.png'
        image=Image.new('RGBA',(64,48),(255,0,0,0))
        image.paste((30,60,90,255),(10,10,50,30))
        image.putpixel((0,0),(30,60,90,1));image.save(self.source)
        self.material=dict(materialId='panel',mode='frame',targetBox=[30,40,110,60],
            measurementAlphaThreshold=128)

    def archive(self):
        composition=dict(kind='ui_layer_composition_v1',canvas=dict(width=160,height=128),
            coordinates='top-left-pixels',order='array-back-to-front',textPolicy='remove-business-text',
            backgroundMode='scene-only',reference='reference.png',preview='preview.png',layers=[
                dict(id='background',name='Background',role='background',path='layers/layer-001.png',
                    x=0,y=0,width=160,height=128,visible=True),
                dict(id='panel',name='Panel',role='foreground',path='layers/layer-002.png',
                    x=0,y=0,width=64,height=48,visible=True)])
        output=self.root/'old'
        write_package(self.reference,composition,dict(
            background=dict(path=str(self.reference),sha256=digest(self.reference)),
            panel=dict(path=str(self.source),sha256=digest(self.source))),output,self.viewer,
            ['Placement diagnosis: '+json.dumps(dict(materialId='panel',sourceSha256=digest(self.source)))])
        shutil.copyfile(self.reference,output/'original-reference.png')
        shutil.copyfile(output/'package/preview.png',output/'viewport-preview.png')
        save(output/'viewport.json',dict(kind='ui_original_viewport_v1',policy=viewport.POLICY,
            originalSize=[160,128],worldSize=[160,128],worldShift=[0,0],worldViewportBox=[0,0,160,128],
            originalReferenceSha256=digest(self.reference)))
        viewport._wrapper(output)
        archive=output/'viewport-ui-layers.zip'
        self.spec=dict(kind=layout.KIND,policy=layout.POLICY,sourceArchive=str(archive),
            sourceArchiveSha256=digest(archive),originalReferenceSha256=digest(self.reference),
            materials=[deepcopy(self.material)],constraints=[],knownDifferences=['Fixture remains unaccepted.'])
        return archive

    def export(self, output=None):
        selection=self.root/'plan.json'
        save(selection,self.spec)
        return layout.revise(selection,output or self.root/'new',self.viewer)

    def test_frame_corrects_contain_shrink_using_measured_output_pixels(self):
        image,geometry=layout.render(self.source,self.material)
        self.assertEqual(geometry['registeredProxyBox'],[30,40,110,60])
        self.assertEqual(geometry['targetBoxResidualPixels'],[0,0,0,0])
        self.assertEqual(geometry['constraintMeasurementBasis'],'post-render-alpha-threshold')
        proxy=image.getchannel('A').point(lambda a:255 if a>=128 else 0).getbbox()
        region=geometry['layerCanvasRegion']
        self.assertEqual([proxy[i]+region[i%2] for i in range(4)],geometry['registeredProxyBox'])
        self.assertTrue(geometry['axisStretch']);self.assertFalse(geometry['observedBody'])

    def test_uniform_shape_retains_aspect_and_reports_actual_residual(self):
        self.material['mode']='uniform'
        _,geometry=layout.render(self.source,self.material)
        self.assertEqual(geometry['registeredProxyBox'],[50,40,90,60])
        self.assertEqual(geometry['targetBoxResidualPixels'],[20,0,-20,0])
        self.assertFalse(geometry['axisStretch'])

    def test_measurement_does_not_erase_faint_support_or_leave_hidden_rgb(self):
        self.material['targetBox']=[30,40,70,60]
        image,geometry=layout.render(self.source,self.material)
        region=geometry['layerCanvasRegion']
        self.assertEqual(image.getpixel((20-region[0],30-region[1]))[3],1)
        pixels=np.array(image)
        self.assertFalse(np.any(pixels[pixels[:,:,3]==0,:3]))
        self.assertFalse(geometry['alphaSupportClipped'])

    def test_inner_separator_landmark_moves_pixels_not_just_outer_frame(self):
        image=Image.new('RGBA',(100,120))
        image.paste((220,220,220,255),(10,10,90,110))
        image.paste((20,20,20,255),(10,59,90,61));image.save(self.source)
        self.material.update(targetBox=[30,20,110,120],yLandmarks=[[59,74],[60,75],[61,76]])
        rendered,geometry=layout.render(self.source,self.material)
        region=geometry['layerCanvasRegion']
        self.assertLess(rendered.getpixel((50-region[0],75-region[1]))[0],40)
        self.assertGreater(rendered.getpixel((50-region[0],70-region[1]))[0],200)
        self.assertEqual(geometry['registeredProxyBox'],[30,20,110,120])

    def test_nonmonotone_and_uniform_landmarks_rejected(self):
        self.material['xLandmarks']=[[25,90],[35,50]]
        with self.assertRaisesRegex(ValueError,'MONOTONE'):layout.render(self.source,self.material)
        self.material['mode']='uniform'
        with self.assertRaisesRegex(ValueError,'UNIFORM_LANDMARKS'):layout.render(self.source,self.material)

    def test_combined_band_and_divider_anchor_capacity_remains_bounded(self):
        from jsonschema import Draft202012Validator, ValidationError
        # 16 band pairs with three points per edge + 32 divider triples = 192.
        points=[[12+3*i,22+3*i] for i in range(192)]
        validator=Draft202012Validator(layout.POINTS);validator.validate(points)
        with self.assertRaises(ValidationError):validator.validate([[i,i] for i in range(257)])
        image=Image.new('RGBA',(80,640));image.paste((220,220,220,255),(10,10,70,630));image.save(self.source)
        self.material.update(targetBox=[30,20,90,640],yLandmarks=points)
        _,geometry=layout.render(self.source,self.material)
        self.assertEqual(geometry['targetBoxResidualPixels'],[0,0,0,0])
        self.assertGreaterEqual(len(geometry['sourceYToReferenceY']),192)

    def test_constraint_uses_pixels_and_bad_axis_or_nonfinite_is_rejected(self):
        constraint=dict(id='join',a=dict(materialId='a',edge='right'),
            b=dict(materialId='b',edge='left'),expectedDelta=0,tolerancePixels=1)
        result=layout.assess_constraints([constraint],dict(a=[0,0,10,10],b=[13,0,23,10]))[0]
        self.assertEqual(result['residualPixels'],-3);self.assertFalse(result['passed'])
        constraint['expectedDelta']=float('nan')
        with self.assertRaisesRegex(ValueError,'FINITE_CONSTRAINT'):layout.assess_constraints([constraint],{})
        constraint['expectedDelta']=0;constraint['b']['edge']='top'
        with self.assertRaisesRegex(ValueError,'AXES_MISMATCH'):layout.assess_constraints([constraint],{})

    def test_export_preserves_source_identity_background_and_viewport_recomposition(self):
        archive=self.archive();before=digest(archive);native=digest(self.source)
        self.spec['materials'][0]['sourceOverride']=dict(path=str(self.source),sha256=native)
        result=self.export();delivery=self.root/'new/delivery'
        verified=viewport.validate_viewport_archive(delivery/'viewport-ui-layers.zip')
        self.assertEqual(result['viewportArchive']['sha256'],verified['sha256'])
        self.assertEqual(digest(archive),before);self.assertEqual(digest(self.source),native)
        self.assertEqual(digest(delivery/'original-reference.png'),digest(self.reference))
        with zipfile.ZipFile(self.root/'old/ui-layers.zip') as a,zipfile.ZipFile(delivery/'ui-layers.zip') as b:
            self.assertEqual(a.read('layers/layer-001.png'),b.read('layers/layer-001.png'))
        composition=read(delivery/'package/composition.json')
        world=composite(delivery/'package',composition)
        with Image.open(delivery/'viewport-preview.png') as image:
            self.assertEqual(image.tobytes(),world.crop(result['viewport']['worldViewportBox']).tobytes())
        for key in ('observedBody','strictBodyRegistrationPassed','humanVisualAcceptance',
                    'originalDagPromoted','materialReviewPassed','fullAutomaticDagPassed'):
            self.assertFalse(result[key])
        self.assertEqual(result['generationCalls'],0);self.assertEqual(result['modelCalls'],0)

    def test_failed_visual_constraint_warns_without_false_technical_success(self):
        self.archive()
        self.spec['constraints']=[dict(id='width',a=dict(materialId='panel',edge='right'),
            b=dict(materialId='panel',edge='left'),expectedDelta=90,tolerancePixels=1)]
        result=self.export()
        self.assertFalse(result['layoutConstraintsPassed'])
        self.assertEqual(result['status'],'layout-candidate-pending-human-review')
        issues=read(self.root/'new/delivery/package/review.json')['issues']
        self.assertTrue(any(x.startswith('Layout constraint: ') for x in issues))

    def test_changed_override_bytes_and_unrelated_native_lineage_rejected(self):
        self.archive();native=digest(self.source)
        self.spec['materials'][0]['sourceOverride']=dict(path=str(self.source),sha256=native)
        self.source.write_bytes(self.source.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):self.export()
        self.spec['materials'][0]['sourceOverride']['sha256']=digest(self.source)
        (self.root/'plan.json').unlink()
        with self.assertRaisesRegex(ValueError,'NATIVE_LINEAGE'):self.export()
        self.assertFalse((self.root/'new').exists())

    def test_input_hash_collision_and_output_overwrite_rejected(self):
        archive=self.archive()
        self.spec['materials'][0]['sourceOverride']=dict(path=str(archive),sha256='0'*64)
        with self.assertRaisesRegex(ValueError,'CONFLICTING_INPUT_BINDING'):self.export()
        del self.spec['materials'][0]['sourceOverride'];(self.root/'plan.json').unlink()
        with self.assertRaisesRegex(ValueError,'FRESH_INDEPENDENT'):self.export(self.root/'old/child')
        self.assertFalse((self.root/'old/child').exists())

    def test_unknown_background_duplicate_and_outside_targets_rejected(self):
        self.archive();base=deepcopy(self.spec)
        cases=[('UNKNOWN_MATERIAL',lambda s:s['materials'][0].update(materialId='unknown')),
            ('FOREGROUND_ONLY',lambda s:s['materials'][0].update(materialId='background')),
            ('DUPLICATE_MATERIAL',lambda s:s['materials'].append(deepcopy(s['materials'][0]))),
            ('POSITIVE_BOX',lambda s:s['materials'][0].update(targetBox=[0,0,161,80]))]
        for error,mutate in cases:
            with self.subTest(error=error):
                self.spec=deepcopy(base);mutate(self.spec)
                (self.root/'plan.json').unlink(missing_ok=True)
                with self.assertRaisesRegex(ValueError,error):self.export()
                self.assertFalse((self.root/'new').exists())


if __name__=='__main__':unittest.main()
