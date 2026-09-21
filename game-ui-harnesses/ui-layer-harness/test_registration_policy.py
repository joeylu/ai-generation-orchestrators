import copy
import tempfile
import unittest
from pathlib import Path
from PIL import Image,ImageDraw
from evaluate import read,save,digest
from freeze_visual import freeze
from registration_policy import integrated_surface
from automatic_registration import candidates,run
import test_compile_visual


class RegistrationPolicyTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        self.material=next(m for m in self.visual['materials'] if m['id']=='asset-buy-button')
        self.region=self.material['bboxNorm']
        outer=next(o for o in self.visual['objects'] if o['id']=='buy-button')
        outer['bboxNorm']=list(self.region)
        l,t,r,b=self.region
        self.visual['objects'].append(dict(id='owned-icon',materialId=self.material['id'],kind='icon',label='Owned detail',
            bboxNorm=[l+(r-l)*.1,t+(b-t)*.1,l+(r-l)*.3,t+(b-t)*.8]))

    def test_single_outer_surface_is_whole_not_group(self):
        self.assertEqual(integrated_surface(self.visual,self.material),'buy-button')
        self.assertNotIn(self.material['id'],candidates(self.visual))

    def test_unknown_or_outside_details_remain_candidates(self):
        for bounds in (None,[0,0,.01,.01]):
            visual=copy.deepcopy(self.visual);visual['objects'][-1]['bboxNorm']=bounds
            self.assertIsNone(integrated_surface(visual,self.material))
            self.assertIn(self.material['id'],candidates(visual))

    def test_separate_buttons_remain_group(self):
        outer=next(o for o in self.visual['objects'] if o['id']=='buy-button')
        outer['bboxNorm']=[.51,.76,.60,.82]
        self.visual['objects'][-1].update(kind='button',bboxNorm=[.70,.76,.79,.82])
        self.assertIn(self.material['id'],candidates(self.visual))

    def test_real_whole_placement_without_model_or_fragmentation(self):
        import json
        (self.run/'m1/draft.json').write_text(json.dumps(self.visual),encoding='utf-8')
        for p in (self.run/'result.json',self.run/'m2/request.json'):
            value=read(p);value['sourcePlanSha256']=digest(self.run/'m1/draft.json');p.write_text(json.dumps(value))
        snapshot=self.root/'frozen';frozen=freeze(self.run,snapshot,5)
        raw=self.root/'raw.png';im=Image.new('RGBA',(120,80));draw=ImageDraw.Draw(im)
        draw.rectangle((10,10,109,69),fill=(50,80,100,255));draw.rectangle((20,20,39,49),fill=(255,20,30,255));im.save(raw)
        config=self.root/'config.json';save(config,dict(snapshot=str(snapshot),snapshotDigest=frozen['digest'],materials={self.material['id']:str(raw)}))
        def forbidden(_):raise AssertionError('integrated material must not call a localization model')
        output=self.root/'output';result=run(config,output,forbidden)
        self.assertEqual(result['modelCalls'],0)
        self.assertEqual(result['localizations'],[])
        report=read(output/'preview/report.json')['records'][0]['report']
        self.assertEqual(report['fitting']['mode'],'frame-bounds')
        self.assertFalse(report['registrationPolicy']['internalRepositioning'])
        with Image.open(output/'preview'/self.material['id']/'material.png') as image:
            self.assertEqual(image.getchannel('A').getbbox(),(0,0,*image.size))
