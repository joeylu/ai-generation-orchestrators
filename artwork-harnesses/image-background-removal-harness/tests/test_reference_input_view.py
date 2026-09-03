"""Synthetic contracts only; no real model, RGB estimation, or user approval."""
import copy,contextlib,io,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch
import numpy as np
from PIL import Image,ImageDraw,ImageOps
from ai_image_background_removal.canonical import fingerprint,stamp_document,write_json_atomic
from ai_image_background_removal.preparation import prepare_reference,load_preparation,inspect_preparation
from ai_image_background_removal.media.reference_input_view import PROFILE,WARNING,primary_input_view
from ai_image_background_removal.media.dual_segmentation import BACKEND,ISNET
from ai_image_background_removal.cli import main
from reference_doubles import foreground_double
ROOT=Path(__file__).parents[3]
sys.path.insert(0,str(ROOT/'.github'))
from release_tools.build_release_metadata import BACKGROUND_SKILL_ROOT,BACKGROUND_SDIST_SUPPORT_FILES

CASE=json.loads((Path(__file__).parent/'fixtures/golden/reference-jpeg-input-view-cases.json').read_text(encoding='utf-8'))
VERSION='ai_frame_animation_reference_preparation_v7'

def artwork():
    image=Image.new('RGB',tuple(CASE['size']),'white');draw=ImageDraw.Draw(image)
    draw.rectangle(CASE['body'],fill=(80,130,180));draw.rectangle(CASE['hole'],fill='white')
    draw.rectangle(CASE['white_field'],fill='white');image.putpixel(tuple(CASE['isolated_dark_pixel']),(0,0,0))
    draw.line(CASE['single_pixel_line'],fill='black',width=1)
    return image


class InputViewBehaviorTests(unittest.TestCase):
    def test_new_fixture_and_test_are_in_source_distribution_contract(self):
        fixture='tests/fixtures/golden/reference-jpeg-input-view-cases.json'
        test='tests/test_reference_input_view.py'
        self.assertIn(fixture,BACKGROUND_SDIST_SUPPORT_FILES);self.assertIn(test,BACKGROUND_SDIST_SUPPORT_FILES)
        manifest=(ROOT/BACKGROUND_SKILL_ROOT/'MANIFEST.in').read_text(encoding='utf-8')
        self.assertIn('recursive-include tests *.py *.json *.md',manifest)
    def test_fixed_view_speckle_changes_only_copy(self):
        source=artwork().convert('RGBA');before=source.tobytes();out=primary_input_view(source,'JPEG')
        self.assertEqual(source.tobytes(),before);self.assertEqual(out.size,source.size);self.assertEqual(out.mode,'RGB')
        self.assertEqual(out.getpixel(tuple(CASE['isolated_dark_pixel'])),(255,255,255))
        self.assertEqual(out.getpixel((70,80)),(255,255,255))
    def test_single_pixel_line_loss_is_explicit_information_loss_not_quality_pass(self):
        source=artwork();out=primary_input_view(source,'JPEG')
        self.assertEqual(source.getpixel((15,50)),(0,0,0));self.assertEqual(out.getpixel((15,50)),(255,255,255))
    def test_non_jpeg_bypasses_and_continuous_alpha_bypasses(self):
        source=artwork().convert('RGBA')
        for fmt in ['PNG','WEBP','BMP',None]:self.assertIs(primary_input_view(source,fmt),source)
        source.putpixel((90,90),(255,255,255,128));self.assertIs(primary_input_view(source,'JPEG'),source)
    def test_constant_white_remains_and_small_mode_inputs_work(self):
        for mode in ['L','RGB','RGBA']:
            im=Image.new(mode,(16,24),'white');result=primary_input_view(im,'JPEG')
            self.assertEqual(result.size,im.size);self.assertEqual(result.getextrema(),((255,255),)*3)


class InputViewPreparationTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);self.root=Path(tmp.name)
        artwork().save(self.root/'source.jpg',quality=80,subsampling=0)
        self.config=self.root/'dual.json';settings={'backend':BACKEND};self.evidence={}
        for k,backend in [('primary','onnx_birefnet'),('auxiliary',ISNET)]:
            path=self.root/(k+'.onnx');path.write_bytes(k.encode());digest=fingerprint(path)['sha256']
            settings[k]={'backend':backend,'model_path':path.name,'model_sha256':digest}
            self.evidence[k]={'backend':backend,'model_sha256':digest,'runtime_version':'fixture','execution':'local_cpu'}
        write_json_atomic(self.config,settings)
        def fake(image,key):
            mask=Image.new('L',image.size);draw=ImageDraw.Draw(mask);draw.rectangle((20,20,image.width-21,image.height-21),fill=254)
            if key=='auxiliary':draw.rectangle(CASE['hole'],fill=0)
            return mask,self.evidence[key]
        def start(name,**kwargs):
            p=patch(name,**kwargs);m=p.start();self.addCleanup(p.stop);return m
        self.first=start('ai_image_background_removal.media.segmentation.infer_birefnet_mask',side_effect=lambda im,*args:fake(im,'primary'))
        self.single=start('ai_image_background_removal.preparation.infer_foreground_mask',side_effect=lambda im,*args:fake(im,'primary'))
        self.second=start('ai_image_background_removal.media.dual_segmentation.infer_isnet_mask',side_effect=lambda im,*args:fake(im,'auxiliary'))
        start('ai_image_background_removal.media.dual_segmentation._runtime')
        self.rgb=Mock(side_effect=lambda rgb,alpha:rgb.copy())
        ctx=foreground_double(self.rgb);ctx.__enter__();self.addCleanup(ctx.__exit__,None,None,None)
    def source(self,name='source.jpg'):
        with Image.open(self.root/name) as image:return ImageOps.exif_transpose(image).convert('RGBA')
    def prepare(self,name='out',reference='source.jpg',dual=True):
        return prepare_reference(root=self.root,reference=reference,out_dir=name,config_path=self.config if dual else None)
    def job(self):return {'schema_version':'1.0','job_id':'view-fixture','character':{'reference':'source.jpg'},'motion':{'request':'idle','continuity':'loop'},'delivery':{'frame_counts':[16,32,64],'size':512,'quality':'strict','gif':True,'key_color':'auto'},'provider':{'plugin':'fixture'}}
    def save(self,report):write_json_atomic(self.root/'out/preparation.json',stamp_document(report,'preparation_sha256'))
    def test_dual_routes_view_only_to_primary_original_to_aux_and_rgb(self):
        source=self.source();before=(self.root/'source.jpg').read_bytes();report=self.prepare()
        self.assertEqual(report['schema_version'],VERSION);self.assertIn(WARNING,report['quality']['warnings'])
        np.testing.assert_array_equal(self.first.call_args.args[0],primary_input_view(source,'JPEG'))
        np.testing.assert_array_equal(self.second.call_args.args[0],source)
        np.testing.assert_array_equal(self.rgb.call_args.args[0],np.asarray(source)[:,:,:3]/255.0)
        self.first.assert_called_once();self.second.assert_called_once();self.rgb.assert_called_once();self.single.assert_not_called()
        self.assertEqual((self.root/'source.jpg').read_bytes(),before)
        self.assertEqual(load_preparation(self.root,'out/preparation.json'),report)
        cutout=np.asarray(Image.open(self.root/'out/cutout.png'));mask=np.asarray(Image.open(self.root/'out/fused-mask.png'))
        np.testing.assert_array_equal(cutout[:,:,3],mask);self.assertFalse(np.any(cutout[:,:,:3][mask==0]))
    def test_single_routes_same_view_but_keeps_original_rgb(self):
        report=self.prepare(dual=False);self.assertEqual(report['schema_version'],VERSION)
        self.single.assert_called_once();self.first.assert_not_called();self.second.assert_not_called()
        np.testing.assert_array_equal(self.single.call_args.args[0],primary_input_view(self.source(),'JPEG'))
        np.testing.assert_array_equal(self.rgb.call_args.args[0],np.asarray(self.source())[:,:,:3]/255.0)
        self.assertIn('mask',report);self.assertNotIn('masks',report);self.assertEqual(load_preparation(self.root,'out/preparation.json'),report)
    def test_actual_file_format_not_extension_and_png_output_stays_v6(self):
        artwork().save(self.root/'png-disguised.jpg',format='PNG')
        r=self.prepare(reference='png-disguised.jpg');self.assertTrue(r['schema_version'].endswith('_v6'))
        self.assertNotIn('input_view',r);self.assertNotIn(WARNING,r['quality']['warnings'])
        self.assertIs(self.first.call_args.args[0],self.second.call_args.args[0]);load_preparation(self.root,'out/preparation.json')
        (self.root/'source.png').write_bytes((self.root/'source.jpg').read_bytes())
        r=self.prepare('disguised',reference='source.png');self.assertEqual(r['schema_version'],VERSION)
    def test_exif_orientation_before_view_and_masks(self):
        im=artwork().resize((128,96));exif=Image.Exif();exif[274]=6;im.save(self.root/'rotated.jpg',exif=exif)
        report=self.prepare(reference='rotated.jpg');self.assertEqual(self.first.call_args.args[0].size,(96,128))
        np.testing.assert_array_equal(self.first.call_args.args[0],primary_input_view(self.source('rotated.jpg'),'JPEG'))
        self.assertEqual(load_preparation(self.root,'out/preparation.json'),report)
    def test_continuous_alpha_existing_and_nonexisting_routes_do_not_filter(self):
        im=artwork().convert('RGBA');im.putpixel((90,90),(255,255,255,100));im.save(self.root/'partial.png')
        r=self.prepare(reference='partial.png');self.assertTrue(r['schema_version'].endswith('_v6'));self.assertNotIn('input_view',r)
        self.assertEqual(Image.open(self.root/'out/cutout.png').getpixel((90,90))[3],100)
        im=Image.new('RGBA',(128,128));ImageDraw.Draw(im).rectangle((30,30,90,90),fill=(255,255,255,128));im.save(self.root/'transparent.jpg',format='PNG')
        self.first.reset_mock();self.second.reset_mock();self.rgb.reset_mock();r=self.prepare('alpha',reference='transparent.jpg')
        self.assertEqual(r['method'],'existing_alpha');self.assertNotIn('input_view',r)
        self.first.assert_not_called();self.second.assert_not_called();self.rgb.assert_not_called()
    def test_v7_roundtrip_binds_foreground(self):
        r=self.prepare();self.assertEqual(load_preparation(self.root,'out/preparation.json'),r)
        self.assertEqual(r['foreground']['path'],'out/foreground.png')
        self.assertFalse((self.root/'.ai-frame-animation/attempts').exists())
    def test_doctor_static_redacted_and_exposes_tradeoff(self):
        result=inspect_preparation(self.root,'source.jpg',self.config)
        self.assertEqual(result['status'],'ready');self.assertEqual(result['primary_input_view'],PROFILE['id']);self.assertEqual(result['input_view_warning'],WARNING)
        self.first.assert_not_called();self.second.assert_not_called();self.rgb.assert_not_called()
        self.assertNotIn(str(self.root),str(result));self.assertNotIn('model_path',str(result))
    def test_same_cli_prepare_no_new_flags(self):
        with self.assertRaises(SystemExit):
            main(['prepare','--root',str(self.root),'--reference','source.jpg','--out-dir','out','--config',str(self.config)])
        self.assertFalse((self.root/'out').exists())
    def test_aux_failure_no_retry_no_output_and_no_rgb(self):
        self.second.side_effect=ValueError('reference_isnet_inference_failed')
        with self.assertRaises(ValueError):self.prepare()
        self.first.assert_called_once();self.second.assert_called_once();self.rgb.assert_not_called();self.assertFalse((self.root/'out').exists())
    def test_existing_output_never_repeats_inference(self):
        self.prepare()
        with self.assertRaises(ValueError):self.prepare()
        self.first.assert_called_once();self.second.assert_called_once();self.rgb.assert_called_once()
    def test_finished_v7_load_without_config_weights_or_estimator(self):
        r=self.prepare();self.config.unlink();(self.root/'primary.onnx').unlink();(self.root/'auxiliary.onnx').unlink()
        self.first.side_effect=self.second.side_effect=self.rgb.side_effect=AssertionError('inference forbidden')
        self.assertEqual(load_preparation(self.root,'out/preparation.json'),r)
    def test_view_changed_bytes_rejected(self):
        self.prepare();(self.root/'out/primary-input.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'artifact_changed'):load_preparation(self.root,'out/preparation.json')
    def test_rehashed_view_not_derived_from_original_rejected(self):
        r=self.prepare();p=self.root/'out/primary-input.png';im=Image.open(p);im.putpixel((80,90),(4,5,6));im.save(p)
        r['input_view']['artifact'].update(fingerprint(p));self.save(r)
        with self.assertRaisesRegex(ValueError,'input_view_mismatch'):load_preparation(self.root,'out/preparation.json')
    def test_profile_path_warning_tamper_rejected_after_restamp(self):
        original=self.prepare()
        for change in ['kernel','profile_hash','path','warning','private_field']:
            r=copy.deepcopy(original)
            if change=='kernel':r['input_view']['profile']['kernel_size']=5
            elif change=='profile_hash':r['input_view']['profile_sha256']='0'*64
            elif change=='path':r['input_view']['artifact']['path']='../escape.png'
            elif change=='warning':r['quality']['warnings']=[]
            else:r['input_view']['model_path']='private'
            self.save(r)
            with self.subTest(change=change),self.assertRaises(ValueError):load_preparation(self.root,'out/preparation.json')
    def test_single_rehashed_cutout_mask_relation_tamper_rejected(self):
        r=self.prepare(dual=False);p=self.root/'out/cutout.png';im=Image.open(p);im.putpixel((80,90),(255,255,255,10));im.save(p)
        r['cutout'].update(fingerprint(p));self.save(r)
        with self.assertRaisesRegex(ValueError,'alpha_mismatch'):load_preparation(self.root,'out/preparation.json')
    def test_v7_correction_parent_preview_gate_remains_required(self):
        from ai_image_background_removal.correction import preview_correction,apply_correction
        self.prepare(dual=False)
        preview=preview_correction(root=self.root,prepared_reference='out/preparation.json',region=[48,48,64,64],background_point=[55,55],out_dir='preview')
        with self.assertRaisesRegex(ValueError,'confirmation_mismatch'):apply_correction(root=self.root,preview_path='preview/correction.json',confirm_correction_sha256='0'*64,out_dir='refused')
        # Test-double confirmation exercises the contract; it is not real user approval.
        result=apply_correction(root=self.root,preview_path='preview/correction.json',confirm_correction_sha256=preview['correction_sha256'],out_dir='corrected-fixture')
        self.assertEqual(load_preparation(self.root,'corrected-fixture/preparation.json'),result);self.rgb.assert_called_once()
