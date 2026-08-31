"""Provider-neutral v6 reader; verifies saved mask/alpha/fit derivations offline."""
from pathlib import PurePosixPath,PureWindowsPath
import numpy as np
from PIL import Image
from .canonical import SHA256_RE,fingerprint,verify_document,canonical_json_bytes
from .preparation import _file,_source_image,_fit_foreground
from .media.dual_segmentation import BACKEND,ISNET
from .media.reference_fusion import fuse_masks

def _artifact(root,value):
    if not isinstance(value,dict) or set(value) != {'path','bytes','sha256','media_type'} or value['media_type'] != 'image':
        raise ValueError('reference_preparation_artifact_invalid')
    path = value['path']
    if not isinstance(path,str) or not path or '\\' in path or PureWindowsPath(path).drive or PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts:
        raise ValueError('reference_preparation_path_unsafe')
    resolved = _file(root,path)
    if type(value['bytes']) is not int or fingerprint(resolved,media_type='image') != {k:value[k] for k in ('bytes','sha256','media_type')}:
        raise ValueError('reference_preparation_artifact_changed')
    return resolved

def _model(value,backend):
    if (not isinstance(value,dict) or set(value) != {'backend','model_sha256','execution','runtime_version'}
            or value['backend'] != backend or value['execution'] != 'local_cpu'
            or not isinstance(value['model_sha256'],str) or not SHA256_RE.fullmatch(value['model_sha256'])
            or not isinstance(value['runtime_version'],str) or not value['runtime_version']):
        raise ValueError('reference_preparation_segmentation_invalid')

def load_fused_preparation(root,report):
    verify_document(report,'preparation_sha256')
    if set(report) != {'schema_version','source','cutout','foreground','method','tool_version','segmentation','quality','matting','masks','fusion','preparation_sha256'} or report['schema_version'] != 'ai_frame_animation_reference_preparation_v6' or report['method'] != 'local_segmentation_fusion':
        raise ValueError('reference_preparation_contract_invalid')
    if not isinstance(report['tool_version'],str) or not report['tool_version']:
        raise ValueError('reference_preparation_contract_invalid')
    source = _source_image(_artifact(root,report['source']))
    cutout = _source_image(_artifact(root,report['cutout']))
    fg_path = _artifact(root,report['foreground'])
    segmentation = report['segmentation']
    if not isinstance(segmentation,dict) or set(segmentation) != {'backend','execution','primary','auxiliary'} or segmentation['backend'] != BACKEND or segmentation['execution'] != 'local_cpu':
        raise ValueError('reference_preparation_segmentation_invalid')
    _model(segmentation['primary'],'onnx_birefnet');_model(segmentation['auxiliary'],ISNET)
    if segmentation['primary']['model_sha256'] == segmentation['auxiliary']['model_sha256']:
        raise ValueError('reference_dual_models_must_differ')
    if not isinstance(report['masks'],dict) or set(report['masks']) != {'primary','auxiliary','fused'}:
        raise ValueError('reference_preparation_masks_invalid')
    masks = {}
    for name,artifact in report['masks'].items():
        with Image.open(_artifact(root,artifact)) as im:
            if im.mode != 'L' or im.size != source.size or getattr(im,'n_frames',1) != 1:
                raise ValueError('reference_preparation_mask_invalid')
            masks[name] = np.array(im)
    expected,fusion = fuse_masks(masks['primary'],masks['auxiliary'],np.asarray(source.getchannel('A')))
    if not np.array_equal(expected,masks['fused']) or canonical_json_bytes(report['fusion']) != canonical_json_bytes(fusion):
        raise ValueError('reference_preparation_fusion_mismatch')
    expected_alpha = ((np.asarray(source.getchannel('A')).astype(np.uint16)*expected + 127)//255).astype(np.uint8)
    rgba = np.asarray(cutout)
    if cutout.size != source.size or not np.array_equal(rgba[:,:,3],expected_alpha) or np.any(rgba[rgba[:,:,3]==0,:3]):
        raise ValueError('reference_preparation_alpha_mismatch')
    fitted,quality = _fit_foreground(cutout)
    with Image.open(fg_path) as im:
        if im.mode != 'RGBA' or getattr(im,'n_frames',1) != 1 or not np.array_equal(np.asarray(im),np.asarray(fitted)):
            raise ValueError('reference_preparation_fit_mismatch')
    if canonical_json_bytes(quality) != canonical_json_bytes(report['quality']):
        raise ValueError('reference_preparation_quality_invalid')
    matting = report['matting']
    if (not isinstance(matting,dict) or set(matting) != {'method','runtime_version','alpha_policy','decontaminated_pixels'}
            or matting['method'] != 'foreground_ml_v1' or matting['alpha_policy'] != 'preserve_source_times_fused_mask'
            or not isinstance(matting['runtime_version'],str) or not matting['runtime_version']
            or type(matting['decontaminated_pixels']) is not int or not 0 <= matting['decontaminated_pixels'] <= source.width*source.height):
        raise ValueError('reference_preparation_matting_invalid')
    return report
