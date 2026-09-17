"""Explicit deterministic refits of verified processed materials, never generation."""
from pathlib import Path
import numpy as np
from PIL import Image
from .common import require,sha256,write_json,read_json,digest
from .media import nine_slice,normalize


def apply_refit(source, spec, sources, *, reference=None):
    require(isinstance(spec,dict) and spec.get('version')=='1.0','REFIT_VERSION')
    require(isinstance(spec.get('evidence'),str) and spec['evidence'].strip(),'REFIT_EVIDENCE')
    require(sha256(source)==spec.get('sourceSha256'),'REFIT_SOURCE_CHANGED')
    im=Image.open(source).convert('RGBA')
    base={'version','operation','sourceSha256','evidence'}
    if spec['operation']=='reference-regions-overlay':
        require(set(spec)==base|{'referenceSha256','regions','staticContentOnly'},'REFIT_FIELDS')
        require(reference is not None and sha256(reference)==spec['referenceSha256'],'REFIT_REFERENCE_CHANGED')
        require(spec['staticContentOnly'] is True,'REFIT_STATIC_CONTENT_REQUIRED')
        require(isinstance(spec['regions'],list) and 0<len(spec['regions'])<=16,'REFIT_OVERLAY_REGIONS')
        original=Image.open(reference).convert('RGBA');out=im.copy();targets=[]
        for pair in spec['regions']:
            require(isinstance(pair,dict) and set(pair)=={'sourceRect','targetRect'},'REFIT_OVERLAY_REGIONS')
            for key,size in (('sourceRect',original.size),('targetRect',im.size)):
                r=pair[key]
                require(isinstance(r,list) and len(r)==4 and all(type(v)is int for v in r),'REFIT_COPY_RECT')
                x,y,w,h=r
                require(x>=0 and y>=0 and w>0 and h>0 and x+w<=size[0] and y+h<=size[1],'REFIT_COPY_RECT')
            sr,tr=pair['sourceRect'],pair['targetRect']
            require(sr[2:]==tr[2:],'REFIT_COPY_RESAMPLE_FORBIDDEN')
            require(all(min(tr[0]+tr[2],r[0]+r[2])<=max(tr[0],r[0]) or min(tr[1]+tr[3],r[1]+r[3])<=max(tr[1],r[1]) for r in targets),'REFIT_OVERLAY_OVERLAP')
            targets.append(tr);x,y,w,h=sr;patch=original.crop((x,y,x+w,y+h))
            require(patch.getchannel('A').getextrema()==(255,255),'REFIT_COPY_OPAQUE_REGION_REQUIRED')
            out.paste(patch,tuple(tr[:2]))
        evidence=dict(operation=spec['operation'],referenceSha256=spec['referenceSha256'],regions=spec['regions'],pixelCopyExact=True,alphaRecovery=False,
                      basis='Reviewed static owned decorations only; all pixels outside the explicit target rectangles remain unchanged.')
    elif spec['operation']=='reference-region-copy':
        require(set(spec)==base|{'referenceSha256','sourceRect','targetRect','staticContentOnly'},'REFIT_FIELDS')
        require(reference is not None and sha256(reference)==spec['referenceSha256'],'REFIT_REFERENCE_CHANGED')
        require(spec['staticContentOnly'] is True,'REFIT_STATIC_CONTENT_REQUIRED')
        original=Image.open(reference).convert('RGBA')
        rects=[]
        for key,size in (('sourceRect',original.size),('targetRect',im.size)):
            r=spec[key]
            require(isinstance(r,list) and len(r)==4 and all(type(v)is int for v in r),'REFIT_COPY_RECT')
            x,y,w,h=r
            require(x>=0 and y>=0 and w>0 and h>0 and x+w<=size[0] and y+h<=size[1],'REFIT_COPY_RECT')
            rects.append(r)
        sr,tr=rects
        require(sr[2:]==tr[2:],'REFIT_COPY_RESAMPLE_FORBIDDEN')
        x,y,w,h=sr;patch=original.crop((x,y,x+w,y+h))
        require(patch.getchannel('A').getextrema()==(255,255),'REFIT_COPY_OPAQUE_REGION_REQUIRED')
        out=Image.new('RGBA',im.size);out.paste(patch,tuple(tr[:2]))
        evidence=dict(operation=spec['operation'],referenceSha256=spec['referenceSha256'],sourceRect=sr,targetRect=tr,
                      pixelCopyExact=True,alphaRecovery=False,basis='Explicitly reviewed static opaque source interior; transparent output margin is authored, not recovered alpha.')
    elif spec['operation']=='visible-content-contain':
        require(set(spec)==base|{'alphaBounds','padding'},'REFIT_FIELDS')
        box=im.getchannel('A').getbbox()
        require(box is not None and list(box)==spec['alphaBounds'],'REFIT_ALPHA_BOUNDS_CHANGED')
        p=spec['padding'];require(type(p)is int and 1<=p<=16 and min(im.size)>2*p,'REFIT_PADDING')
        support=im.crop(box);factor=min((im.width-2*p)/support.width,(im.height-2*p)/support.height)
        require(factor<=2,'REFIT_EXCESSIVE_UPSCALE')
        fit=support.resize((max(1,round(support.width*factor)),max(1,round(support.height*factor))),Image.Resampling.LANCZOS)
        out=Image.new('RGBA',im.size);out.paste(fit,((im.width-fit.width)//2,(im.height-fit.height)//2));out=normalize(out)
        evidence=dict(operation=spec['operation'],sourceAlphaBounds=list(box),outputAlphaBounds=list(out.getchannel('A').getbbox()),padding=p,preserveAspectRatio=True)
    elif spec['operation']=='visible-frame-nine-slice':
        require(set(spec)==base|{'alphaBounds','insets','padding'},'REFIT_FIELDS')
        box=im.getchannel('A').getbbox()
        require(box is not None and list(box)==spec['alphaBounds'],'REFIT_ALPHA_BOUNDS_CHANGED')
        p=spec['padding'];require(type(p)is int and 1<=p<=16,'REFIT_PADDING')
        inset=spec['insets']
        require(isinstance(inset,list) and len(inset)==4 and all(type(x)is int and x>0 for x in inset),'REFIT_INSETS')
        fit=nine_slice(im.crop(box),[im.width-2*p,im.height-2*p],inset)
        out=Image.new('RGBA',im.size);out.paste(fit,(p,p));out=normalize(out)
        evidence=dict(operation=spec['operation'],sourceAlphaBounds=list(box),outputAlphaBounds=list(out.getchannel('A').getbbox()),insets=inset,padding=p)
    elif spec['operation']=='monochrome-state-from-canonical':
        require(set(spec)==base|{'canonicalLayerId','canonicalSha256','paletteLayerId','paletteSha256','paletteRect'},'REFIT_FIELDS')
        c,p=spec['canonicalLayerId'],spec['paletteLayerId']
        require(c in sources and p in sources,'REFIT_REFERENCE')
        require(sha256(sources[c])==spec['canonicalSha256'] and sha256(sources[p])==spec['paletteSha256'],'REFIT_REFERENCE_CHANGED')
        canonical=Image.open(sources[c]).convert('RGBA');palette=Image.open(sources[p]).convert('RGBA')
        require(canonical.size==im.size,'REFIT_CANONICAL_SIZE')
        a=np.asarray(canonical);opaque=a[a[:,:,3]==255,:3]
        require(len(opaque)>=9 and max(np.percentile(opaque,95,axis=0)-np.percentile(opaque,5,axis=0))<=48,'REFIT_NOT_MONOCHROME')
        rect=spec['paletteRect'];require(isinstance(rect,list) and len(rect)==4 and all(type(x)is int for x in rect),'REFIT_PALETTE_RECT')
        x,y,w,h=rect;require(x>=0 and y>=0 and w>=2 and h>=2 and x+w<=palette.width and y+h<=palette.height,'REFIT_PALETTE_RECT')
        patch=np.asarray(palette)[y:y+h,x:x+w]
        require(patch[:,:,3].min()==255 and np.ptp(patch[:,:,:3].reshape(-1,3),axis=0).max()<=12,'REFIT_PALETTE_NOT_SOLID')
        color=np.rint(np.median(patch[:,:,:3].reshape(-1,3),axis=0)).astype(np.uint8)
        pixels=np.zeros_like(a);pixels[:,:,:3]=color;pixels[:,:,3]=a[:,:,3]
        out=normalize(Image.fromarray(pixels,'RGBA'))
        require(out.tobytes()!=canonical.tobytes(),'REFIT_STATE_NOT_DISTINCT')
        evidence=dict(operation=spec['operation'],paletteRgb=color.tolist(),paletteRect=rect,
                      alphaExactCanonical=True,basis='contract-derived solid-color state; not restoration of observed state pixels')
    else:raise ValueError('REFIT_OPERATION')
    require(out.getchannel('A').getextrema()==(0,255),'REFIT_ALPHA')
    return out,evidence


def prepare_refit(compiled,source_run,recipes,output,component_root):
    from .process import read_materials
    from .common import safe_relative
    from .delivery_adapter import _materialized_handoff
    compiled,source_run,output=map(Path,(compiled,source_run,output))
    require(not output.exists(),'OUTPUT_EXISTS')
    materials=read_materials(source_run)
    sources={r['asset']:safe_relative(source_run,r['path']) for r in materials['assets']}
    catalog=read_json(compiled/'material-catalog.json')
    require(set(sources)=={r['layerId'] for r in catalog['parts']},'REFIT_LAYER_COVERAGE')
    require(isinstance(recipes,dict) and set(recipes)<=set(sources),'REFIT_UNKNOWN_LAYER')
    from .shared_materials import generated_rows
    independent={row['layerId'] for row in generated_rows(catalog['parts'])}
    require(set(recipes)<=independent,'REFIT_DERIVED_OR_SHARED_TARGET')
    # Validate all sources/recipes before publishing any transformed output.
    reference=safe_relative(compiled,catalog['original'])
    changed={key:apply_refit(sources[key],spec,sources,reference=reference) for key,spec in recipes.items()}
    output.mkdir();target=output/'refitted';target.mkdir();paths={key:sources[key] for key in independent};records=[]
    for key,(im,evidence) in changed.items():
        path=target/(key+'.png');im.save(path);paths[key]=path
        records.append(dict(layerId=key,recipe=recipes[key],sourceSha256=sha256(sources[key]),outputSha256=sha256(path),measurement=evidence))
    report=dict(kind='ui_material_refit_v1',sourceMaterialsSha256=sha256(source_run/'materials/materials.json'),
                records=records,mediaCalls=0,human_visual_acceptance=False)
    report['digest']=digest(report);write_json(output/'material-refit.json',report)
    return _materialized_handoff(compiled,paths,output,component_root,read_json(compiled/'plan.json'))
