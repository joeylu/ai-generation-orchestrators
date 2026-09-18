"""Hash-bound, measured frame adaptation; no semantic inference."""
import hashlib
import re
from PIL import Image
from .common import require
from .media import nine_slice,normalize
from .protected_grid_fit import fit_protected_grid,validate_protected_grid


def validate_frames(frames,board):
    require(board.get('extraction_policy',{}).get('version') in {'1.1','1.2','1.3','1.4','1.5'},'FRAME_FIT_CONTENT_POLICY_REQUIRED')
    require(isinstance(frames,dict) and bool(frames),'FRAME_FIT_FIELDS')
    ids={s['asset_id'] for s in board['slots']}
    require(set(frames)<=ids,'FRAME_FIT_UNKNOWN_PART')
    for f in frames.values():
        require(isinstance(f,dict) and set(f)=={'version','role','supportSha256','supportSize','resize','evidence'},'FRAME_FIT_FIELDS')
        require((f['version']=='1.0' and f['role']=='empty-frame') or
                (f['version']=='1.1' and f['role'] in {'row-frame','empty-frame'}) or
                (f['version']=='1.2' and f['role']=='row-frame'),'FRAME_FIT_VERSION_ROLE')
        require(isinstance(f['evidence'],str) and bool(f['evidence'].strip()),'FRAME_FIT_EVIDENCE')
        require(isinstance(f['supportSha256'],str) and re.fullmatch('[0-9a-f]{64}',f['supportSha256']),'FRAME_FIT_HASH')
        require(isinstance(f['supportSize'],list) and len(f['supportSize'])==2 and all(type(v)is int and v>0 for v in f['supportSize']),'FRAME_FIT_SIZE')
        if f['version']=='1.2':
            validate_protected_grid(f)
            continue
        r=f['resize'];require(isinstance(r,dict) and set(r)=={'mode','insets'} and
            r['mode']==('height_then_nine_slice' if f['version']=='1.1' else 'nine_slice'),'FRAME_FIT_RESIZE')
        require(isinstance(r['insets'],list) and len(r['insets'])==4 and all(type(v)is int and v>0 for v in r['insets']),'RESIZE_INSETS')


def fit_frame(source,target,padding,spec):
    if isinstance(spec,dict) and spec.get('version')=='1.2':
        return fit_protected_grid(source,target,padding,spec)
    require(list(source.size)==spec['supportSize'] and hashlib.sha256(source.tobytes()).hexdigest()==spec['supportSha256'],'FRAME_FIT_SUPPORT_CHANGED')
    inner=[target[0]-2*padding,target[1]-2*padding]
    insets=spec['resize']['insets']
    if spec['version']=='1.1':
        # Preserve the row's full-height end regions, including state marks.
        # Only the central width changes after one proportional height fit.
        scale=inner[1]/source.height
        source=source.resize((max(1,round(source.width*scale)),inner[1]),Image.Resampling.LANCZOS)
        insets=[max(1,round(v*scale)) for v in insets]
    fitted=nine_slice(source,inner,insets)
    result=Image.new('RGBA',tuple(target));result.paste(fitted,(padding,padding));result=normalize(result)
    return result,dict(transform=('proportional row height; fixed full-height end bands; central width fit; source-hash-bound' if spec['version']=='1.1' else 'explicit measured nine_slice; fixed corner pixels; source-hash-bound'),
                       measuredFrame=spec,target_padding=padding,alpha_bbox=list(result.getchannel('A').getbbox()),
                       human_visual_acceptance=False)
