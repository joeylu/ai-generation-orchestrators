"""Offline keyed-material checks and fitting; never pads over clipped edges."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image
from .compile_visual import HARNESS
from ai_ui_decomposition.media import KEY_RGB, matte_key, normalize
from .key_evidence import key_background_evidence
from .evaluate import digest, save


def assess(image, target):
    rgba=np.asarray(image.convert('RGBA'));rgb=rgba[:,:,:3].astype(np.float32)
    native=bool(rgba[:,:,3].min()==0 and rgba[:,:,3].max()>0)
    support=(rgba[:,:,3]>=8) if native else (np.linalg.norm(rgb-KEY_RGB,axis=2)>=145)&(rgba[:,:,3]>0)
    y,x=np.nonzero(support)
    if not len(x):raise ValueError('EMPTY_MATERIAL')
    box=[int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)]
    w,h=image.size;l,t,r,b=box
    margins=[l,t,w-r,h-b]
    minimum=max(8,int(np.ceil(min(r-l,b-t)*.1)))
    aspect=abs(((r-l)/(b-t))/(target[0]/target[1])-1)
    key={'passed':True,'route':'native-alpha-preserved'} if native else key_background_evidence(image)
    issues=[]
    if not key['passed']:issues.append('KEY_BACKGROUND_REQUIRED')
    if native:
        if min(margins)==0:issues.append('POSSIBLY_CLIPPED_SOURCE')
    elif min(margins)<minimum:issues.append('INSUFFICIENT_SOURCE_PADDING')
    return {'rawSize':[w,h],'estimatedSupportBox':box,'marginsLTRB':margins,
            'minimumMarginPixels':minimum,'visibleAspectError':aspect,'keyEvidence':key,'issues':issues,
            'policy':'native-alpha-crop-placement-v2',
            'warnings':['CROP_RATIO_IS_NOT_SILHOUETTE_RATIO'] if aspect>.05 else [],
            'basis':'Alpha support' if native else 'Declared-key distance estimate'}


def fit_native(image, target, mode='contain'):
    # Region fitting is a placement hypothesis, not measured reference registration.
    source=normalize(image)
    # Ignore nearly invisible alpha only when measuring bounds; retain pixel alpha.
    box=source.getchannel('A').point(lambda a: 255 if a>=8 else 0).getbbox()
    if box is None:raise ValueError('EMPTY_MATERIAL')
    crop=source.crop(box)
    if mode not in ('contain','frame-bounds'):raise ValueError('UNKNOWN_FIT_MODE')
    if mode=='frame-bounds':
        # Explicit carrier-frame registration, not a general sprite fitting rule.
        # Both axes follow the declared reference bounds; only existing pixels are resampled.
        scales=[target[0]/crop.width,target[1]/crop.height]
        result=normalize(crop.resize(tuple(target),Image.Resampling.LANCZOS))
        return result,{'mode':'frame-bounds','sourceAlphaBox':list(box),
            'scaleXY':scales,'offsetInRegion':[0,0],
            'relativeAxisStretch':scales[1]/scales[0],
            'referenceRegistration':'declared frame bounds; reference silhouette not measured',
            'warnings':['NONUNIFORM_FRAME_RESAMPLING_REVIEW_DECORATIONS'] if abs(scales[1]/scales[0]-1)>.01 else [],
            'alphaPolicy':'preserve continuous alpha; resampling only, no threshold or key removal'}
    scale=min(target[0]/crop.width,target[1]/crop.height)
    size=(max(1,round(crop.width*scale)),max(1,round(crop.height*scale)))
    resized=crop.resize(size,Image.Resampling.LANCZOS)
    offset=((target[0]-size[0])//2,(target[1]-size[1])//2)
    canvas=Image.new('RGBA',tuple(target),(0,0,0,0))
    canvas.alpha_composite(resized,offset)
    return normalize(canvas),{'mode':'aspect-preserving-centered-region-fit',
        'sourceAlphaBox':list(box),'scale':scale,'offsetInRegion':list(offset),
        'referenceRegistration':'approximate; no reference silhouette or anchor measured',
        'alphaPolicy':'preserve continuous alpha; resampling only, no threshold or key removal'}


def process(source, target, output, background=False, fit_mode='contain'):
    if fit_mode not in ('contain','frame-bounds'):raise ValueError('UNKNOWN_FIT_MODE')
    if background and fit_mode!='contain':raise ValueError('FRAME_FIT_ON_BACKGROUND')
    source=Path(source);output=Path(output);output.mkdir(parents=True,exist_ok=False)
    source_sha=digest(source)
    with Image.open(source) as im:
        im.load()
        if background:
            issues=[]
            if im.convert('RGBA').getchannel('A').getextrema()!=(255,255):issues.append('BACKGROUND_NOT_OPAQUE')
            if abs((im.width/im.height)/(target[0]/target[1])-1)>.05:issues.append('BACKGROUND_ASPECT_MISMATCH')
            report={'issues':issues,'keyEvidence':{'route':'opaque-background'},'rawSize':list(im.size)}
        else:report=assess(im,target)
        if not background and fit_mode=='frame-bounds' and report['keyEvidence']['route']!='native-alpha-preserved':
            report['issues'].append('FRAME_BOUNDS_REQUIRES_NATIVE_ALPHA')
        if not report['issues']:
            if background:
                result=im.convert('RGBA').resize(tuple(target),Image.Resampling.LANCZOS);fitting={'mode':'full-background-canvas'}
            else:result, fitting = fit_native(im,target,fit_mode) if report['keyEvidence']['route']=='native-alpha-preserved' else (matte_key(im,target), {'mode':'legacy-keyed-contain'})
            report['fitting']=fitting
            if fitting.get('warnings'):
                report['warnings']=report.get('warnings',[])+fitting['warnings']
            result.save(output/'material.png')
            report['materialSha256']=digest(output/'material.png')
    report.update(sourceSha256=source_sha,targetSize=target,generationCalls=0,
                  status='blocked' if report['issues'] else 'processed_pending_visual_review',
                  humanVisualAcceptance=False)
    save(output/'report.json',report)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',required=True)
    p.add_argument('--size',nargs=2,type=int,required=True);p.add_argument('--output',required=True)
    a=p.parse_args();print(json.dumps(process(a.source,a.size,a.output),ensure_ascii=False))
