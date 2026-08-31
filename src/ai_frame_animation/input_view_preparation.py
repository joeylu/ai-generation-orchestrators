"""v7 input-view integrity: deterministic replay only, never model/RGB inference."""
import numpy as np
from PIL import Image
from .canonical import canonical_json_bytes,canonical_sha256,verify_document
from .fusion_preparation import _artifact,_model,load_fused_preparation
from .preparation import _source_image,_fit_foreground,_validate_current_matting
from .media.reference_input_view import PROFILE,WARNING,jpeg_view_applies,primary_input_view


def validate_input_view(root,source_path,source,value):
    if (not isinstance(value,dict) or set(value) != {'profile','profile_sha256','pillow_version','artifact'}
            or canonical_json_bytes(value['profile']) != canonical_json_bytes(PROFILE)
            or value['profile_sha256'] != canonical_sha256(PROFILE)
            or not isinstance(value['pillow_version'],str) or not value['pillow_version']):
        raise ValueError('reference_preparation_input_view_invalid')
    with Image.open(source_path) as raw:source_format=raw.format
    if not jpeg_view_applies(source,source_format):
        raise ValueError('reference_preparation_input_view_source_invalid')
    expected=primary_input_view(source,source_format)
    with Image.open(_artifact(root,value['artifact'])) as actual:
        if (actual.format != 'PNG' or actual.mode != 'RGB' or getattr(actual,'n_frames',1) != 1
                or actual.size != source.size or not np.array_equal(np.asarray(actual),np.asarray(expected))):
            raise ValueError('reference_preparation_input_view_mismatch')


def load_view_preparation(root,report):
    verify_document(report,'preparation_sha256')
    if report.get('method') == 'local_segmentation_fusion':
        return load_fused_preparation(root,report)
    fields={'schema_version','source','cutout','foreground','method','tool_version','segmentation','quality','matting','mask','input_view','preparation_sha256'}
    if (set(report) != fields or report['schema_version'] != 'ai_frame_animation_reference_preparation_v7'
            or report['method'] != 'local_segmentation' or not isinstance(report['tool_version'],str) or not report['tool_version']):
        raise ValueError('reference_preparation_contract_invalid')
    source_path=_artifact(root,report['source']);source=_source_image(source_path)
    validate_input_view(root,source_path,source,report['input_view'])
    _model(report['segmentation'],'onnx_birefnet')
    cutout=_source_image(_artifact(root,report['cutout']))
    with Image.open(_artifact(root,report['mask'])) as mask:
        if mask.mode != 'L' or mask.size != source.size or getattr(mask,'n_frames',1) != 1:
            raise ValueError('reference_preparation_mask_invalid')
        expected=((np.asarray(source.getchannel('A')).astype(np.uint16)*np.asarray(mask)+127)//255).astype(np.uint8)
    rgba=np.asarray(cutout)
    if cutout.size != source.size or not np.array_equal(rgba[:,:,3],expected) or np.any(rgba[rgba[:,:,3]==0,:3]):
        raise ValueError('reference_preparation_alpha_mismatch')
    fitted,quality=_fit_foreground(cutout);quality['warnings']=sorted(set(quality['warnings']+[WARNING]))
    with Image.open(_artifact(root,report['foreground'])) as actual:
        if actual.mode != 'RGBA' or getattr(actual,'n_frames',1) != 1 or not np.array_equal(np.asarray(actual),np.asarray(fitted)):
            raise ValueError('reference_preparation_fit_mismatch')
    if canonical_json_bytes(quality) != canonical_json_bytes(report['quality']):
        raise ValueError('reference_preparation_quality_invalid')
    _validate_current_matting(report['matting'],'local_segmentation',source.size)
    return report
