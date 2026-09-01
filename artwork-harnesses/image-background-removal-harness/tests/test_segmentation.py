from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

from ai_image_background_removal.canonical import fingerprint, write_json_atomic
from ai_image_background_removal.media.segmentation import infer_foreground_mask, inspect_segmenter


def runtime_double(prediction=None):
    if prediction is None:
        prediction = np.full((1,1,1024,1024),-4,dtype=np.float32)
        prediction[:,:,256:768,256:768] = 4
        prediction[:,:,256:768,200:256] = 0.4
    session = Mock()
    session.get_inputs.return_value = [SimpleNamespace(name="image",type="tensor(float)",shape=[1,3,1024,1024])]
    session.get_providers.return_value = ["CPUExecutionProvider"]
    session.run.return_value = [prediction]
    runtime = SimpleNamespace(SessionOptions=Mock(return_value=SimpleNamespace()),
                              InferenceSession=Mock(return_value=session),
                              disable_telemetry_events=Mock(), __version__="fixture")
    return runtime,session


class SegmentationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.model = self.root / "model.onnx"
        self.model.write_bytes(b"fixture-not-a-model")
        self.config = self.root / "config.json"
        self.settings = {"backend":"onnx_birefnet","model_path":"model.onnx","model_sha256":fingerprint(self.model)["sha256"]}
        write_json_atomic(self.config,self.settings)
        for name in ("socket.create_connection","socket.socket.connect"):
            guard = patch(name,side_effect=AssertionError("offline_fixture_only"))
            mock = guard.start()
            self.addCleanup(guard.stop)
            self.addCleanup(mock.assert_not_called)

    def test_verified_bytes_one_cpu_inference_no_fallback(self):
        runtime,session = runtime_double()
        with patch.dict("sys.modules",{"onnxruntime":runtime}):
            mask,evidence = infer_foreground_mask(Image.new("RGB",(96,64),"white"),self.config)
        self.assertEqual(mask.size,(96,64))
        self.assertEqual(runtime.InferenceSession.call_args.args[0],self.model.read_bytes())
        self.assertEqual(runtime.InferenceSession.call_args.kwargs["providers"],["CPUExecutionProvider"])
        runtime.disable_telemetry_events.assert_called_once()
        session.disable_fallback.assert_called_once()
        session.run.assert_called_once()
        tensor = session.run.call_args.args[1]["image"]
        self.assertEqual(tensor.shape,(1,3,1024,1024))
        self.assertEqual(tensor.dtype,np.float32)
        self.assertEqual(evidence["backend"],"onnx_birefnet")

    def test_rgb_normalization_black_input_and_sigmoid_floor_match_profile(self):
        for colour in ((120,60,30),(0,0,0)):
            runtime,session = runtime_double()
            source = Image.new("RGB",(1024,1024),colour)
            with patch.dict("sys.modules",{"onnxruntime":runtime}):
                mask,_ = infer_foreground_mask(source,self.config)
            pixel = np.array(colour) / max(max(colour),1e-6)
            expected = ((pixel-np.array([.485,.456,.406])) / np.array([.229,.224,.225])).astype(np.float32)
            np.testing.assert_array_equal(session.run.call_args.args[1]["image"][0,:,1,1],expected)
            logits = session.run.return_value[0][0,0]
            probability = 1/(1+np.exp(-logits))
            expected_mask = ((probability-probability.min())/(probability.max()-probability.min())*255).astype(np.uint8)
            np.testing.assert_array_equal(np.asarray(mask),expected_mask)

    def test_rejects_invalid_constant_and_nonfinite_outputs(self):
        for output in (np.zeros((1,1,1024,1024),dtype=np.float32),
                       np.full((1,1,1024,1024),np.nan,dtype=np.float32),
                       np.full((1,1,1024,1024),np.inf,dtype=np.float32),
                       np.zeros((1,1,320,320),dtype=np.float32),
                       np.zeros((1,1,1024,1024),dtype=np.float64)):
            runtime,session = runtime_double(output)
            with patch.dict("sys.modules",{"onnxruntime":runtime}), self.assertRaisesRegex(ValueError,"reference_segmentation_mask_"):
                infer_foreground_mask(Image.new("RGB",(64,64)),self.config)
            session.run.assert_called_once()

    def test_extreme_finite_logits_are_safe(self):
        logits = np.full((1,1,1024,1024),-1000,dtype=np.float32)
        logits[:,:,256:768,256:768] = 1000
        runtime,_ = runtime_double(logits)
        with patch.dict("sys.modules",{"onnxruntime":runtime}):
            mask,_ = infer_foreground_mask(Image.new("RGB",(1024,1024)),self.config)
        self.assertEqual(mask.getpixel((500,500)),255)
        self.assertEqual(mask.getpixel((0,0)),0)

    def test_wrong_profile_and_gpu_provider_stop_before_run(self):
        for kind in ("shape","type","multiple","provider"):
            runtime,session = runtime_double()
            if kind == "shape": session.get_inputs.return_value[0].shape = [1,3,320,320]
            if kind == "type": session.get_inputs.return_value[0].type = "tensor(float16)"
            if kind == "multiple": session.get_inputs.return_value *= 2
            if kind == "provider": session.get_providers.return_value = ["CUDAExecutionProvider","CPUExecutionProvider"]
            with self.subTest(kind=kind), patch.dict("sys.modules",{"onnxruntime":runtime}), self.assertRaisesRegex(ValueError,"reference_segmentation_(model_contract_invalid|cpu_required)"):
                infer_foreground_mask(Image.new("RGB",(64,64)),self.config)
            session.run.assert_not_called()

    def test_model_mutation_and_retired_backend_never_construct_runtime(self):
        runtime,_ = runtime_double()
        self.model.write_bytes(b"changed")
        with patch.dict("sys.modules",{"onnxruntime":runtime}), self.assertRaisesRegex(ValueError,"model_digest_mismatch"):
            infer_foreground_mask(Image.new("RGB",(64,64)),self.config)
        write_json_atomic(self.config,{**self.settings,"backend":"onnx_u2net"})
        with patch.dict("sys.modules",{"onnxruntime":runtime}), self.assertRaisesRegex(ValueError,"backend_retired"):
            infer_foreground_mask(Image.new("RGB",(64,64)),self.config)
        runtime.InferenceSession.assert_not_called()

    def test_changed_bytes_between_checks_and_session_are_rejected(self):
        runtime,_ = runtime_double()
        with patch("ai_image_background_removal.media.segmentation.sha256_file",return_value=self.settings["model_sha256"]), patch.dict("sys.modules",{"onnxruntime":runtime}):
            self.model.write_bytes(b"changed-after-check")
            with self.assertRaisesRegex(ValueError,"model_digest_mismatch"):
                infer_foreground_mask(Image.new("RGB",(64,64)),self.config)
        runtime.InferenceSession.assert_not_called()

    def test_inspection_checks_optional_packages_without_import_or_inference(self):
        with patch("importlib.util.find_spec",return_value=object()), patch("ai_image_background_removal.media.reference_matte.require_segmentation_runtime"), patch("ai_image_background_removal.media.segmentation.infer_foreground_mask") as infer:
            report = inspect_segmenter(self.config)
        infer.assert_not_called()
        self.assertEqual(report["backend"],"onnx_birefnet")
        self.assertNotIn("model_path",report)
        with patch("importlib.util.find_spec",side_effect=lambda name: None if name=="pymatting" else object()), self.assertRaisesRegex(ValueError,"reference_matting_runtime_missing"):
            inspect_segmenter(self.config)

    def test_runtime_failure_is_redacted_and_not_retried(self):
        runtime,session = runtime_double()
        session.run.side_effect = RuntimeError("private model path")
        with patch.dict("sys.modules",{"onnxruntime":runtime}), self.assertRaisesRegex(ValueError,"^reference_segmentation_inference_failed$"):
            infer_foreground_mask(Image.new("RGB",(64,64)),self.config)
        session.run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
