import contextlib,copy,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from PIL import Image,ImageDraw
from ai_frame_animation.canonical import fingerprint,write_json_atomic,stamp_document
from ai_frame_animation.preparation import prepare_reference,load_preparation,inspect_preparation
from ai_frame_animation.planning import compile_plan
from ai_frame_animation.cli import main,_check_reference
from ai_frame_animation.media.dual_segmentation import BACKEND,ISNET
from tests.test_reference_fusion import fixture
from tests.reference_doubles import foreground_double

class FusionPreparationTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);self.root=Path(tmp.name)
        self.config=self.root/'config.json';settings={'backend':BACKEND};self.evidence={}
        for name,backend in [('primary','onnx_birefnet'),('auxiliary',ISNET)]:
            path=self.root/(name+'.onnx');path.write_bytes(name.encode())
            settings[name]={'backend':backend,'model_path':path.name,'model_sha256':fingerprint(path)['sha256']}
            self.evidence[name]={k:settings[name][k] for k in ['backend','model_sha256']}
            self.evidence[name].update(execution='local_cpu',runtime_version='fixture')
        write_json_atomic(self.config,settings)
        image=Image.new('RGBA',(128,128),'white');draw=ImageDraw.Draw(image);draw.rectangle((20,20,107,107),fill=(80,130,180,255));draw.rectangle((50,50,61,61),fill='white');image.save(self.root/'source.png')
        a,b,_=fixture()
        def patched(name,**kwargs):
            p=patch(name,**kwargs);m=p.start();self.addCleanup(p.stop);return m
        self.first=patched('ai_frame_animation.media.segmentation.infer_birefnet_mask',return_value=(Image.fromarray(a),self.evidence['primary']))
        self.second=patched('ai_frame_animation.media.dual_segmentation.infer_isnet_mask',return_value=(Image.fromarray(b),self.evidence['auxiliary']))
        self.runtime=patched('ai_frame_animation.media.dual_segmentation._runtime')
        foreground=foreground_double(lambda rgb,alpha:rgb)
        self.matte=foreground.__enter__()
        self.addCleanup(foreground.__exit__,None,None,None)
        self.report=self.prepare('out')
    def prepare(self,out,reference='source.png'):return prepare_reference(root=self.root,reference=reference,out_dir=out,config_path=self.config)
    def job(self,reference='source.png'):return {'schema_version':'1.0','job_id':'fusion','character':{'reference':reference,'description':'fixture'},'motion':{'request':'idle','continuity':'loop'},'delivery':{'frame_counts':[16,32,64],'size':512,'quality':'strict','gif':True,'key_color':'auto'},'provider':{'plugin':'fixture'}}
    def save(self,report):write_json_atomic(self.root/'out/preparation.json',stamp_document(report,'preparation_sha256'))
    def test_v6_roundtrip_plan_and_preflight(self):
        self.assertEqual(load_preparation(self.root,'out/preparation.json'),self.report)
        plan=compile_plan(self.job(),self.root,prepared_reference='out/preparation.json');_check_reference(self.root,plan)
        self.assertEqual(plan['character']['reference_preparation']['sha256'],self.report['preparation_sha256'])
        self.first.assert_called_once();self.second.assert_called_once();self.matte.assert_called_once()
    def test_final_alpha_and_zero_rgb(self):
        rgba=np.array(Image.open(self.root/'out/cutout.png'));mask=np.array(Image.open(self.root/'out/fused-mask.png'))
        np.testing.assert_array_equal(rgba[:,:,3],mask);self.assertFalse(np.any(rgba[rgba[:,:,3]==0,:3]))
        self.assertEqual(self.report['matting']['alpha_policy'],'preserve_source_times_fused_mask')
    def test_source_partial_alpha_never_increases(self):
        image=Image.open(self.root/'source.png');image.putpixel((30,30),(80,130,180,100));image.save(self.root/'partial.png')
        r=self.prepare('partial-out','partial.png');self.assertTrue(r['fusion']['source_alpha_bypass'])
        self.assertEqual(Image.open(self.root/'partial-out/cutout.png').getpixel((30,30))[3],100)
        load_preparation(self.root,'partial-out/preparation.json')
    def test_existing_transparency_bypasses_both_models_and_estimator(self):
        image=Image.open(self.root/'out/cutout.png');image.save(self.root/'transparent.png')
        self.config.unlink();r=self.prepare('transparent-out','transparent.png')
        self.assertEqual(r['method'],'existing_alpha');self.first.assert_called_once();self.second.assert_called_once();self.matte.assert_called_once()
        np.testing.assert_array_equal(np.array(image)[:,:,3],np.array(Image.open(self.root/'transparent-out/cutout.png'))[:,:,3])
    def test_aux_failure_publishes_nothing_and_no_retry(self):
        self.first.reset_mock();self.second.reset_mock();self.matte.reset_mock();self.second.side_effect=ValueError('reference_isnet_inference_failed')
        with self.assertRaises(ValueError):self.prepare('failed')
        self.first.assert_called_once();self.second.assert_called_once();self.matte.assert_not_called();self.assertFalse((self.root/'failed').exists())
    def test_existing_output_never_reinfers(self):
        with self.assertRaises(ValueError):self.prepare('out')
        self.first.assert_called_once();self.second.assert_called_once();self.matte.assert_called_once()
    def test_config_not_needed_to_validate_finished_report(self):
        self.config.unlink();(self.root/'primary.onnx').unlink();(self.root/'auxiliary.onnx').unlink()
        load_preparation(self.root,'out/preparation.json');self.first.assert_called_once();self.second.assert_called_once()
    def test_cli_same_prepare_entry(self):
        stream=io.StringIO()
        with contextlib.redirect_stdout(stream):code=main(['prepare','--root',str(self.root),'--reference','source.png','--out-dir','cli-out','--config',str(self.config)])
        self.assertEqual(code,0);result=json.loads(stream.getvalue());self.assertEqual(result['status'],'prepared_requires_visual_review');self.assertEqual(result['method'],'local_segmentation_fusion')
    def test_doctor_static_and_redacted(self):
        result=inspect_preparation(self.root,'source.png',self.config)
        self.assertEqual(result['method'],'local_segmentation_fusion')
        self.assertEqual(result['status'],'ready');self.first.assert_called_once();self.second.assert_called_once();self.assertNotIn(str(self.root),str(result));self.assertNotIn('model_path',str(result))
    def test_wrong_source_plan_rejected(self):
        Image.new('RGBA',(128,128),'red').save(self.root/'other.png')
        with self.assertRaisesRegex(ValueError,'source_mismatch'):compile_plan(self.job('other.png'),self.root,prepared_reference='out/preparation.json')
    def test_original_replacement_invalidates_report(self):
        (self.root/'source.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'artifact_changed'):load_preparation(self.root,'out/preparation.json')
    def test_mask_replacement_invalidates_report(self):
        (self.root/'out/auxiliary-mask.png').write_bytes(b'changed')
        with self.assertRaises(ValueError):load_preparation(self.root,'out/preparation.json')
    def test_restamped_fusion_parameter_tamper_rejected(self):
        r=copy.deepcopy(self.report);r['fusion']['profile']['minimum_gain']=1;self.save(r)
        with self.assertRaisesRegex(ValueError,'fusion_mismatch'):load_preparation(self.root,'out/preparation.json')
    def test_restamped_mask_relation_tamper_rejected(self):
        p=self.root/'out/fused-mask.png';im=Image.open(p);im.putpixel((30,30),0);im.save(p)
        r=copy.deepcopy(self.report);r['masks']['fused'].update(fingerprint(p));self.save(r)
        with self.assertRaisesRegex(ValueError,'fusion_mismatch'):load_preparation(self.root,'out/preparation.json')
    def test_restamped_cutout_alpha_tamper_rejected(self):
        p=self.root/'out/cutout.png';im=Image.open(p);im.putpixel((30,30),(80,130,180,24));im.save(p)
        r=copy.deepcopy(self.report);r['cutout'].update(fingerprint(p));self.save(r)
        with self.assertRaisesRegex(ValueError,'alpha_mismatch'):load_preparation(self.root,'out/preparation.json')
    def test_restamped_foreground_fit_tamper_rejected(self):
        p=self.root/'out/foreground.png';im=Image.open(p);im.putpixel((30,30),(255,0,0,255));im.save(p)
        r=copy.deepcopy(self.report);r['foreground'].update(fingerprint(p));self.save(r)
        with self.assertRaisesRegex(ValueError,'fit_mismatch'):load_preparation(self.root,'out/preparation.json')
    def test_unsafe_path_rejected(self):
        r=copy.deepcopy(self.report);r['cutout']['path']='../escape.png';self.save(r)
        with self.assertRaisesRegex(ValueError,'path_unsafe'):load_preparation(self.root,'out/preparation.json')
    def test_gpu_evidence_rejected(self):
        r=copy.deepcopy(self.report);r['segmentation']['auxiliary']['execution']='gpu';self.save(r)
        with self.assertRaisesRegex(ValueError,'segmentation_invalid'):load_preparation(self.root,'out/preparation.json')
    def test_correction_still_requires_exact_preview_confirmation(self):
        from ai_frame_animation.correction import preview_correction,apply_correction
        preview=preview_correction(root=self.root,prepared_reference='out/preparation.json',region=[48,48,64,64],background_point=[55,55],out_dir='preview')
        with self.assertRaisesRegex(ValueError,'confirmation_mismatch'):apply_correction(root=self.root,preview_path='preview/correction.json',confirm_correction_sha256='0'*64,out_dir='wrong')
        report=apply_correction(root=self.root,preview_path='preview/correction.json',confirm_correction_sha256=preview['correction_sha256'],out_dir='corrected')
        self.assertEqual(load_preparation(self.root,'corrected/preparation.json'),report)
        self.first.assert_called_once();self.second.assert_called_once();self.matte.assert_called_once()
