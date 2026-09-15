import copy
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from ai_ui_decomposition.common import ContractError, sha256
from ai_ui_decomposition.composition_checks import check_composition

class CompositionChecksTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.shot=self.root/'shot.png';Image.new('RGBA',(100,100),'white').save(self.shot)
        self.parent=self.root/'parent.png';Image.new('RGBA',(100,100),'white').save(self.parent)
        self.doc={'canvas':{'width':100,'height':100},'root':{'id':'panel','type':'Panel','props':{},'children':[{'id':'tabs','type':'Tabs','props':{'drawBackground':False}},{'id':'list','type':'List','props':{}}]}}
        self.plan={'version':'1.0','screenshotSha256':sha256(self.shot),'backgrounds':[{'componentId':'tabs','ownerId':'panel','reason':'Panel owns exposed corners','parentOnly':{'path':'parent.png','sha256':sha256(self.parent)},'points':[[1,1]],'tolerance':0}],'rowSpacing':[{'componentId':'list','state':'normal','reason':'Measured visible borders in this screenshot','paintBounds':[[0,10,50,20],[0,34,50,20]],'preferredGap':[2,3]}]}
    def tearDown(self):self.tmp.cleanup()
    def run_check(self):return check_composition(self.doc,self.shot,self.plan,self.root)
    def test_density_is_advisory_and_unchecked_explicit(self):
        r=self.run_check();self.assertEqual(r['status'],'passed_with_advisories');self.assertEqual(r['warnings'][0]['code'],'ROW_DENSITY_ADVISORY');self.assertEqual(r['uncheckedBackgroundIds'],['list'])
    def test_empty_plan_is_not_checked_not_passed(self):
        self.plan.update(backgrounds=[],rowSpacing=[])
        r=self.run_check();self.assertEqual(r['status'],'not_checked');self.assertEqual(r['checks'],[])
    def test_duplicate_background_fails_even_if_color_matches(self):
        self.doc['root']['children'][0]['props']['drawBackground']=True
        self.assertEqual(self.run_check()['errors'][0]['code'],'BACKGROUND_DUPLICATE_OWNER')
    def test_exposed_pixels_detect_runtime_plate_despite_false_flag(self):
        im=Image.open(self.shot);im.putpixel((1,1),(0,0,0,255));im.save(self.shot);self.plan['screenshotSha256']=sha256(self.shot)
        self.assertEqual(self.run_check()['errors'][0]['code'],'BACKGROUND_EXPOSED_PIXEL_MISMATCH')
    def test_stale_images_and_illegal_paths_rejected(self):
        self.plan['screenshotSha256']='0'*64
        with self.assertRaises(ContractError):self.run_check()
        self.plan['screenshotSha256']=sha256(self.shot);self.plan['backgrounds'][0]['parentOnly']['path']='../parent.png'
        with self.assertRaises(ContractError):self.run_check()
    def test_overlap_is_failure(self):
        self.plan['rowSpacing'][0]['paintBounds'][1][1]=29
        self.assertEqual(self.run_check()['errors'][0]['code'],'ROW_PAINT_OVERLAP')
    def test_wrong_owner_bad_geometry_and_missing_points_rejected(self):
        original=copy.deepcopy(self.plan)
        for mutate in [lambda p:p['backgrounds'][0].update(ownerId='list'),lambda p:p['backgrounds'][0].update(points=[]),lambda p:p['rowSpacing'][0].update(preferredGap=[0,float('nan')])]:
            self.plan=copy.deepcopy(original);mutate(self.plan)
            with self.assertRaises(ContractError):self.run_check()
    def test_resized_screenshot_not_native_pixel_evidence(self):
        Image.new('RGBA',(50,50),'white').save(self.shot);self.plan['screenshotSha256']=sha256(self.shot)
        with self.assertRaisesRegex(ContractError,'NATIVE_SCREENSHOT'):self.run_check()
