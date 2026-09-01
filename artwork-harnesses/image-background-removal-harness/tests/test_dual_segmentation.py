import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from PIL import Image
from ai_image_background_removal.canonical import fingerprint,write_json_atomic
from ai_image_background_removal.media.dual_segmentation import BACKEND,ISNET,inspect_dual_segmenter,infer_isnet_mask,infer_dual_masks
from test_segmentation import runtime_double

class DualSegmentationTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        self.primary=self.root/'primary.onnx';self.primary.write_bytes(b'primary fixture')
        self.aux=self.root/'auxiliary.onnx';self.aux.write_bytes(b'auxiliary fixture')
        def m(path,backend):return {'backend':backend,'model_path':path.name,'model_sha256':fingerprint(path)['sha256']}
        self.settings={'backend':BACKEND,'primary':m(self.primary,'onnx_birefnet'),'auxiliary':m(self.aux,ISNET)}
        self.config=self.root/'config.json';write_json_atomic(self.config,self.settings)
        self.digest=fingerprint(self.aux)['sha256'];self.source=Image.new('RGB',(96,64),(120,60,30))
    def test_isnet_distinct_normalization_and_no_sigmoid(self):
        r,s=runtime_double();prediction=s.run.return_value[0]
        with patch.dict('sys.modules',{'onnxruntime':r}):mask,e=infer_isnet_mask(self.source,self.aux,self.digest)
        tensor=s.run.call_args.args[1]['image']
        np.testing.assert_array_equal(tensor[0,:,0,0],(np.array([1,.5,.25])-np.array([.485,.456,.406])).astype(np.float32))
        p=prediction[0,0];expected=Image.fromarray(((p-p.min())/(p.max()-p.min())*255).astype(np.uint8)).resize(self.source.size,Image.Resampling.LANCZOS)
        np.testing.assert_array_equal(np.asarray(mask),np.asarray(expected));self.assertEqual(e['backend'],ISNET)
        s.run.assert_called_once();s.disable_fallback.assert_called_once();self.assertEqual(r.InferenceSession.call_args.kwargs['providers'],['CPUExecutionProvider'])
    def test_all_black_normalization_finite(self):
        r,s=runtime_double()
        with patch.dict('sys.modules',{'onnxruntime':r}):infer_isnet_mask(Image.new('RGB',(64,64)),self.aux,self.digest)
        self.assertTrue(np.isfinite(s.run.call_args.args[1]['image']).all())
    def test_auxiliary_contracts_and_gpu_rejected_without_run(self):
        for case in ['gpu','shape','type','multiple']:
            r,s=runtime_double()
            if case=='gpu':s.get_providers.return_value=['CUDAExecutionProvider','CPUExecutionProvider']
            if case=='shape':s.get_inputs.return_value[0].shape=[1,3,320,320]
            if case=='type':s.get_inputs.return_value[0].type='tensor(float16)'
            if case=='multiple':s.get_inputs.return_value*=2
            with self.subTest(case=case),patch.dict('sys.modules',{'onnxruntime':r}),self.assertRaises(ValueError):infer_isnet_mask(self.source,self.aux,self.digest)
            s.run.assert_not_called()
    def test_invalid_predictions_rejected(self):
        for p in [np.zeros((1,1,1024,1024),np.float32),np.full((1,1,1024,1024),np.nan,np.float32),np.zeros((1,1,8,8),np.float32),np.zeros((1,1,1024,1024),np.float64)]:
            r,s=runtime_double(p)
            with patch.dict('sys.modules',{'onnxruntime':r}),self.assertRaises(ValueError):infer_isnet_mask(self.source,self.aux,self.digest)
            s.run.assert_called_once()
    def test_verified_bytes_before_session(self):
        self.aux.write_bytes(b'changed');r,s=runtime_double()
        with patch.dict('sys.modules',{'onnxruntime':r}),self.assertRaisesRegex(ValueError,'digest_mismatch'):infer_isnet_mask(self.source,self.aux,self.digest)
        r.InferenceSession.assert_not_called()
    def test_aux_error_is_redacted_and_not_retried(self):
        r,s=runtime_double();s.run.side_effect=RuntimeError('private local path and credential')
        with patch.dict('sys.modules',{'onnxruntime':r}),self.assertRaisesRegex(ValueError,'^reference_isnet_inference_failed$'):infer_isnet_mask(self.source,self.aux,self.digest)
        s.run.assert_called_once()
    def test_static_inspection_no_session_or_paths(self):
        r,s=runtime_double()
        with patch('importlib.util.find_spec',return_value=object()),patch('ai_image_background_removal.media.reference_matte.require_segmentation_runtime'),patch.dict('sys.modules',{'onnxruntime':r}):result=inspect_dual_segmenter(self.config)
        r.InferenceSession.assert_not_called();self.assertNotIn(str(self.root),str(result));self.assertNotIn('model_path',str(result))
    def test_missing_aux_stops_before_primary_inference(self):
        self.aux.unlink()
        with patch('ai_image_background_removal.media.segmentation.infer_birefnet_mask') as first,self.assertRaisesRegex(ValueError,'model_missing'):infer_dual_masks(self.source,self.config)
        first.assert_not_called()
    def test_two_serial_sessions_one_call_each(self):
        r,first=runtime_double();_,second=runtime_double();r.InferenceSession.side_effect=[first,second]
        with patch('ai_image_background_removal.media.dual_segmentation._runtime'),patch.dict('sys.modules',{'onnxruntime':r}):mask,e,m,f=infer_dual_masks(self.source,self.config)
        self.assertEqual(r.InferenceSession.call_count,2);first.run.assert_called_once();second.run.assert_called_once()
        self.assertEqual(mask.size,self.source.size);self.assertEqual(set(m),{'primary','auxiliary','fused'})
        self.assertEqual(e['primary']['backend'],'onnx_birefnet');self.assertEqual(e['auxiliary']['backend'],ISNET)
    def test_aux_failure_no_primary_fallback(self):
        r,first=runtime_double();_,second=runtime_double();second.run.side_effect=RuntimeError('failed');r.InferenceSession.side_effect=[first,second]
        with patch('ai_image_background_removal.media.dual_segmentation._runtime'),patch.dict('sys.modules',{'onnxruntime':r}),self.assertRaisesRegex(ValueError,'isnet_inference_failed'):infer_dual_masks(self.source,self.config)
        first.run.assert_called_once();second.run.assert_called_once();self.assertEqual(r.InferenceSession.call_count,2)
    def test_bad_nested_config_and_same_model_rejected(self):
        for changed in [{**self.settings,'extra':'no'},{**self.settings,'auxiliary':{**self.settings['primary'],'backend':ISNET}},{**self.settings,'auxiliary':{**self.settings['auxiliary'],'backend':'onnx_birefnet'}}]:
            write_json_atomic(self.config,changed)
            with self.assertRaises(ValueError):inspect_dual_segmenter(self.config)
