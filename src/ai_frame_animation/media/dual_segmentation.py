"""Configured, serial BiRefNet + IS-Net CPU execution; no fallback or downloads."""
import hashlib,importlib.util
from pathlib import Path
import numpy as np
from PIL import Image
from ..canonical import SHA256_RE,load_json,sha256_file
from .reference_matte import inspect_matting_runtime
from .reference_fusion import fuse_masks,inspect_fusion_runtime

BACKEND = 'onnx_birefnet_isnet_enclosed'
ISNET = 'onnx_isnet_anime'

def is_dual_config(path):
    return path is not None and load_json(path).get('backend') == BACKEND

def _model(value, expected, config):
    if not isinstance(value, dict) or set(value) != {'backend','model_path','model_sha256'} or value['backend'] != expected:
        raise ValueError('reference_dual_config_invalid')
    digest = value['model_sha256']
    if not isinstance(digest,str) or not SHA256_RE.fullmatch(digest):
        raise ValueError('reference_segmentation_digest_invalid')
    raw = value['model_path']
    if not isinstance(raw,str) or not raw:
        raise ValueError('reference_segmentation_model_missing')
    model = Path(raw)
    if not model.is_absolute():model = config.resolve(strict=True).parent / model
    if not model.is_file() or model.is_symlink():raise ValueError('reference_segmentation_model_missing')
    if sha256_file(model) != digest:raise ValueError('reference_segmentation_model_digest_mismatch')
    return model,digest

def dual_config(path):
    if path is None:raise ValueError('reference_segmentation_setup_required')
    value = load_json(path)
    if set(value) != {'backend','primary','auxiliary'} or value['backend'] != BACKEND:
        raise ValueError('reference_dual_config_invalid')
    # Resolve and verify BOTH profiles before constructing either session.
    primary = _model(value['primary'],'onnx_birefnet',path)
    auxiliary = _model(value['auxiliary'],ISNET,path)
    if primary[1] == auxiliary[1]:raise ValueError('reference_dual_models_must_differ')
    return primary,auxiliary

def _runtime():
    if importlib.util.find_spec('onnxruntime') is None:
        raise ValueError('reference_segmentation_runtime_missing')
    inspect_matting_runtime();inspect_fusion_runtime()

def inspect_dual_segmenter(path):
    primary,auxiliary = dual_config(path);_runtime()
    return {'backend':BACKEND,'execution':'local_cpu','primary':{'backend':'onnx_birefnet','model_sha256':primary[1]},
            'auxiliary':{'backend':ISNET,'model_sha256':auxiliary[1]},'inference':'not_performed'}

def infer_isnet_mask(image, model, digest):
    try:
        import onnxruntime as ort
    except ImportError as exc:
        raise ValueError('reference_segmentation_runtime_missing') from exc
    data = model.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('reference_segmentation_model_digest_mismatch')
    try:
        options = ort.SessionOptions();options.intra_op_num_threads = 4;options.inter_op_num_threads = 1
        ort.disable_telemetry_events()
        session = ort.InferenceSession(data,sess_options=options,providers=['CPUExecutionProvider'])
        session.disable_fallback()
        if session.get_providers() != ['CPUExecutionProvider']:raise ValueError('reference_segmentation_cpu_required')
        inputs = session.get_inputs()
        if len(inputs) != 1 or inputs[0].type != 'tensor(float)' or inputs[0].shape != [1,3,1024,1024]:
            raise ValueError('reference_segmentation_model_contract_invalid')
        # IS-Net Anime profile, matching the accepted cached-mask experiment:
        # image-max normalization, ImageNet mean, UNIT std; no sigmoid.
        pixels = np.asarray(image.convert('RGB').resize((1024,1024),Image.Resampling.LANCZOS))
        pixels = pixels / max(float(pixels.max()),1e-6)
        pixels = pixels - np.array([.485,.456,.406])
        tensor = pixels.transpose(2,0,1)[None].astype(np.float32)
        outputs = session.run(None,{inputs[0].name:tensor})
    except ValueError as exc:
        if str(exc) in {'reference_segmentation_cpu_required','reference_segmentation_model_contract_invalid'}:raise
        raise ValueError('reference_isnet_inference_failed') from exc
    except Exception as exc:
        raise ValueError('reference_isnet_inference_failed') from exc
    if not outputs:raise ValueError('reference_segmentation_mask_invalid')
    prediction = np.asarray(outputs[0])
    if prediction.shape != (1,1,1024,1024) or prediction.dtype != np.float32 or not np.isfinite(prediction).all():
        raise ValueError('reference_segmentation_mask_invalid')
    values = prediction[0,0];low,high = float(values.min()),float(values.max())
    if not np.isfinite(high-low) or high-low < 1e-6:raise ValueError('reference_segmentation_mask_ambiguous')
    coverage = (values-low)/(high-low)
    if not np.isfinite(coverage).all():raise ValueError('reference_segmentation_mask_invalid')
    mask = Image.fromarray((np.clip(coverage,0,1)*255).astype(np.uint8)).resize(image.size,Image.Resampling.LANCZOS)
    return mask,{'backend':ISNET,'model_sha256':digest,'execution':'local_cpu','runtime_version':str(ort.__version__)}

def infer_dual_masks(image,path):
    primary,auxiliary = dual_config(path);_runtime()
    from .segmentation import infer_birefnet_mask
    base,base_evidence = infer_birefnet_mask(image,*primary)
    other,other_evidence = infer_isnet_mask(image,*auxiliary)
    for mask in (base,other):
        if mask.mode != 'L' or mask.size != image.size:raise ValueError('reference_segmentation_mask_invalid')
    alpha,fusion = fuse_masks(np.asarray(base),np.asarray(other),np.asarray(image.convert('RGBA').getchannel('A')))
    masks = {'primary':base,'auxiliary':other,'fused':Image.fromarray(alpha)}
    evidence = {'backend':BACKEND,'execution':'local_cpu','primary':base_evidence,'auxiliary':other_evidence}
    return masks['fused'],evidence,masks,fusion
