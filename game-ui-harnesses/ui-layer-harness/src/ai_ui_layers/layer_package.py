"""Portable UI artwork package only: no component semantics, model calls or UI drawing."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import zipfile
from PIL import Image,ImageChops
from jsonschema import Draft202012Validator
from .compile_visual import HARNESS
from .evaluate import read,save,digest
from .freeze_visual import inspect, body_digest
from .body_registration import POLICY_SUPPORT

SCHEMA=HARNESS/'planning-harness/schemas/layer-composition.schema.json'


def support_canvas_region(report, placement, snapshot_digest, material_id, reference_sha, reference_size):
    """Read support geometry only from a scoped body result, never a source override."""
    fitting=report.get('fitting',{})
    if fitting.get('mode')!=POLICY_SUPPORT:
        raise ValueError('SUPPORT_POLICY_REQUIRED')
    if (report.get('snapshotDigest')!=snapshot_digest or report.get('materialId')!=material_id
            or report.get('referenceSha256')!=reference_sha):
        raise ValueError('SUPPORT_REPORT_SCOPE_MISMATCH')
    owner=placement['sourceRegion'];region=fitting.get('layerCanvasRegion')
    if fitting.get('ownershipRegion')!=owner or placement['xy']!=owner[:2]:
        raise ValueError('SUPPORT_OWNERSHIP_MISMATCH')
    if (not isinstance(region,list) or len(region)!=4 or any(type(v) is not int for v in region)):
        raise ValueError('SUPPORT_CANVAS_REGION_INVALID')
    l,t,r,b=region
    if (not 0<=l<=owner[0]<owner[2]<=r<=reference_size[0]
            or not 0<=t<=owner[1]<owner[3]<=b<=reference_size[1]):
        raise ValueError('SUPPORT_CANVAS_OUTSIDE_REFERENCE')
    if report.get('targetSize')!=[r-l,b-t]:
        raise ValueError('SUPPORT_CANVAS_SIZE_MISMATCH')
    body=fitting.get('targetBodyBox')
    if (not isinstance(body,list) or len(body)!=4 or any(type(v) is not int for v in body)
            or not owner[0]<=body[0]<body[2]<=owner[2]
            or not owner[1]<=body[1]<body[3]<=owner[3]):
        raise ValueError('SUPPORT_TARGET_BODY_OUTSIDE_OWNER')
    contract=report.get('bodyContract',{})
    if (contract.get('snapshotDigest')!=snapshot_digest or contract.get('materialId')!=material_id
            or contract.get('referenceSha256')!=reference_sha
            or contract.get('sourceSha256')!=report.get('sourceSha256')
            or contract.get('targetBodyBox')!=body
            or body_digest(contract)!=report.get('bodyContractCanonicalDigest')):
        raise ValueError('SUPPORT_CONTRACT_SCOPE_MISMATCH')
    source_body=fitting.get('sourceBodyBox')
    full_alpha=fitting.get('sourceFullAlphaBox')
    alpha_box=fitting.get('transformedAlphaBox')
    if (contract.get('sourceBodyBox')!=source_body or
            any(not isinstance(box,list) or len(box)!=4 or any(type(v) is not int for v in box)
                for box in (source_body,full_alpha,alpha_box))):
        raise ValueError('SUPPORT_GEOMETRY_INVALID')
    scale=fitting.get('uniformScale')
    if type(scale) not in (int,float) or not math.isfinite(scale) or scale<=0:
        raise ValueError('SUPPORT_GEOMETRY_INVALID')
    bw,bh=source_body[2]-source_body[0],source_body[3]-source_body[1]
    if bw<=0 or bh<=0 or scale!=min((body[2]-body[0])/bw,(body[3]-body[1])/bh):
        raise ValueError('SUPPORT_GEOMETRY_INVALID')
    shift=[(body[i]+body[i+2])/2-((source_body[i]+source_body[i+2])/2)*scale
           for i in (0,1)]
    relative=[shift[i]-owner[i] for i in (0,1)]
    theoretical=[full_alpha[i]*scale+relative[i%2]+owner[i%2] for i in range(4)]
    absolute_alpha=[alpha_box[i]+region[i%2] for i in range(4)]
    expected=[min(owner[0],math.floor(theoretical[0]),absolute_alpha[0]),
              min(owner[1],math.floor(theoretical[1]),absolute_alpha[1]),
              max(owner[2],math.ceil(theoretical[2]),absolute_alpha[2]),
              max(owner[3],math.ceil(theoretical[3]),absolute_alpha[3])]
    if region!=expected or any(not 0<=alpha_box[i]<alpha_box[i+2]<=report['targetSize'][i]
                               for i in (0,1)):
        raise ValueError('SUPPORT_GEOMETRY_MISMATCH')
    return region


def portable_text(value):
    if not isinstance(value,str) or re.search(r'[A-Za-z]:[\\/]|/(?:Users|home)/|https?://',value):
        raise ValueError('PRIVATE_OR_NONPORTABLE_TEXT')
    return value


def check_composition(value):
    Draft202012Validator(read(SCHEMA)).validate(value)
    w,h=value['canvas']['width'],value['canvas']['height']
    if w*h>16_777_216:raise ValueError('CANVAS_PIXEL_LIMIT')
    ids=[l['id'] for l in value['layers']];paths=[l['path'] for l in value['layers']]
    if len(ids)!=len(set(ids)) or len(paths)!=len(set(paths)):raise ValueError('DUPLICATE_LAYER')
    if sum(l['width']*l['height'] for l in value['layers'])>134_217_728:raise ValueError('LAYER_PIXEL_LIMIT')
    for layer in value['layers']:
        portable_text(layer['id']);portable_text(layer['name'])
        if layer['x']+layer['width']>w or layer['y']+layer['height']>h:raise ValueError('LAYER_OUTSIDE_CANVAS')


def composite(folder, composition):
    check_composition(composition)
    size=(composition['canvas']['width'],composition['canvas']['height'])
    canvas=Image.new('RGBA',size)
    for layer in composition['layers']:
        with Image.open(Path(folder)/layer['path']) as im:
            if im.format!='PNG' or im.mode!='RGBA' or im.size!=(layer['width'],layer['height']):
                raise ValueError('LAYER_PNG_GEOMETRY')
            if not im.getchannel('A').getbbox():raise ValueError('EMPTY_LAYER')
            if layer['role']=='background' and im.getchannel('A').getextrema()!=(255,255):raise ValueError('BACKGROUND_ALPHA')
            canvas.alpha_composite(im,(layer['x'],layer['y']))
    return canvas


def validate_archive(archive):
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:raise ValueError('ZIP_CRC')
        names=z.namelist()
        if len(names)!=len(set(names)) or len(names)>262 or names!=sorted(names):raise ValueError('ZIP_MEMBERS')
        if any(i.compress_type!=zipfile.ZIP_STORED for i in z.infolist()):raise ValueError('ZIP_METHOD')
        manifest=json.loads(z.read('manifest.json'))
        if manifest['kind']!='ui_layers_package_v1':raise ValueError('PACKAGE_KIND')
        if set(names)!=set(manifest['files'])|{'manifest.json'}:raise ValueError('PACKAGE_INVENTORY')
        for name,entry in manifest['files'].items():
            if not re.fullmatch(r'(?:layers/layer-[0-9]{3}\.png|composition\.json|reference\.png|preview\.png|review\.json|README\.txt|viewer\.html|viewer\.js)',name):
                raise ValueError('PACKAGE_PATH')
            data=z.read(name)
            if len(data)!=entry['bytes'] or hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('PACKAGE_HASH')
        check_composition(json.loads(z.read('composition.json')))
    return dict(status='package_integrity_passed',sha256=digest(Path(archive)),bytes=Path(archive).stat().st_size,
                humanVisualAcceptance=False,generationCalls=0)


def sources_from_preview(snapshot, preview, warnings=()):
    snapshot=Path(snapshot).resolve();preview=Path(preview).resolve()
    frozen=inspect(snapshot);report=read(preview/'report.json')
    if report['snapshotDigest']!=frozen['digest']:raise ValueError('PREVIEW_SNAPSHOT_MISMATCH')
    placements={p['id']:p for p in read(snapshot/'placements.json')['materials']}
    known=set(placements);sources={}
    reference_sha=digest(snapshot/'reference.png')
    with Image.open(snapshot/'reference.png') as im:reference_size=im.size
    for row in report['records']:
        key=row['id']
        if key not in known or key in sources:raise ValueError('PREVIEW_LAYER_SET')
        path=(preview/key/'material.png').resolve()
        if not path.is_relative_to(preview):raise ValueError('PREVIEW_PATH')
        if row['report']['status']!='processed_pending_visual_review':raise ValueError('PREVIEW_BLOCKED')
        if digest(path)!=row['report']['materialSha256']:raise ValueError('PREVIEW_MATERIAL_CHANGED')
        value=dict(path=str(path),sha256=digest(path))
        if row['report'].get('fitting',{}).get('mode')==POLICY_SUPPORT:
            if report.get('registrationPolicy')!=POLICY_SUPPORT:
                raise ValueError('SUPPORT_PREVIEW_POLICY_MISMATCH')
            if read(preview/key/'report.json')!=row['report']:
                raise ValueError('SUPPORT_PREVIEW_REPORT_MISMATCH')
            if row['xy']!=placements[key]['xy'] or digest(Path(row['source']))!=row['sourceSha256']:
                raise ValueError('SUPPORT_PREVIEW_SOURCE_CHANGED')
            if row['report'].get('sourceSha256')!=row['sourceSha256']:
                raise ValueError('SUPPORT_REPORT_SCOPE_MISMATCH')
            region=support_canvas_region(row['report'],placements[key],frozen['digest'],key,
                                         reference_sha,reference_size)
            with Image.open(row['source']) as raw:
                if list(raw.convert('RGBA').getchannel('A').getbbox())!=row['report']['fitting']['sourceFullAlphaBox']:
                    raise ValueError('SUPPORT_SOURCE_ALPHA_MISMATCH')
            with Image.open(path) as im:
                if (im.size!=(region[2]-region[0],region[3]-region[1])
                        or list(im.convert('RGBA').getchannel('A').getbbox())!=
                           row['report']['fitting']['transformedAlphaBox']):
                    raise ValueError('SUPPORT_PNG_GEOMETRY')
            value.update(reportPath=str((preview/key/'report.json').resolve()),
                         reportSha256=digest(preview/key/'report.json'),
                         previewReportPath=str((preview/'report.json').resolve()),
                         previewReportSha256=digest(preview/'report.json'))
        sources[key]=value
    if set(sources)!=known:raise ValueError('COMPLETE_LAYER_SET_REQUIRED')
    issues=['该回拼尚待视觉验收；自动处理成功不代表与参考图完全一致。']
    for warning in warnings:
        issues.append(portable_text('[visual warning: '+warning['category']+'] '+warning['materialId']+
            ': '+warning['evidence']+' Suggestion: '+warning['suggestion']+
            ' Review SHA-256: '+warning['reviewSha256']))
    return dict(sources=sources,issues=issues)


def build(snapshot, sources_path, output, viewer):
    snapshot=Path(snapshot).resolve();viewer=Path(viewer).resolve();output=Path(output).resolve()
    frozen=inspect(snapshot);evidence=sources_path if isinstance(sources_path,dict) else read(Path(sources_path))
    visual_path=snapshot/'evidence/revised-visual-plan.json'
    visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
    placements=sorted(read(snapshot/'placements.json')['materials'],key=lambda p:p['drawIndex'])
    materials={m['id']:m for m in visual['materials']};sources=evidence['sources']
    if set(sources)!=set(materials) or {p['id'] for p in placements}!=set(materials):raise ValueError('COMPLETE_LAYER_SET_REQUIRED')
    if len({p['drawIndex'] for p in placements})!=len(placements):raise ValueError('AMBIGUOUS_ORDER')
    if visual.get('textPolicy') not in ('remove-business-text','preserve-raster-text'):raise ValueError('TEXT_POLICY_REQUIRED')
    issues=evidence.get('issues',[])
    if (snapshot/'planning-warnings.json').exists():
        issues=list(issues)+['[planning warning] '+w['code']+': '+w['description']+' Suggestion: '+w['suggestedChange'] for w in read(snapshot/'planning-warnings.json')['warnings']]
    if not isinstance(issues,list) or len(issues)>128:raise ValueError('ISSUES_REQUIRED')
    for issue in issues:portable_text(issue)
    for name in ('viewer.html','viewer.js'):
        if not (viewer/name).is_file():raise ValueError('BUILT_VIEWER_REQUIRED')
    for value in sources.values():
        if digest(Path(value['path']))!=value['sha256']:raise ValueError('SOURCE_CHANGED')
    with Image.open(snapshot/'reference.png') as im:width,height=im.size
    layers=[]
    for i,p in enumerate(placements):
        m=materials[p['id']]
        source=sources[p['id']]
        region=p['sourceRegion']
        if any(k in source for k in ('reportPath','reportSha256','previewReportPath','previewReportSha256')):
            report_path=Path(source['reportPath']).resolve()
            if report_path!=Path(source['path']).resolve().parent/'report.json':
                raise ValueError('SUPPORT_REPORT_PATH')
            preview_report_path=Path(source['previewReportPath']).resolve()
            if preview_report_path!=report_path.parent.parent/'report.json':
                raise ValueError('SUPPORT_PREVIEW_REPORT_PATH')
            if digest(preview_report_path)!=source['previewReportSha256']:
                raise ValueError('SUPPORT_PREVIEW_REPORT_CHANGED')
            preview_report=read(preview_report_path)
            if (preview_report.get('snapshotDigest')!=frozen['digest']
                    or preview_report.get('registrationPolicy')!=POLICY_SUPPORT):
                raise ValueError('SUPPORT_PREVIEW_POLICY_MISMATCH')
            if digest(report_path)!=source['reportSha256']:
                raise ValueError('SUPPORT_REPORT_CHANGED')
            report=read(report_path)
            matching=[row for row in preview_report['records'] if row['id']==p['id']]
            if len(matching)!=1 or matching[0]['report']!=report or matching[0]['xy']!=p['xy']:
                raise ValueError('SUPPORT_PREVIEW_REPORT_MISMATCH')
            if (digest(Path(matching[0]['source']))!=matching[0]['sourceSha256']
                    or matching[0]['sourceSha256']!=report.get('sourceSha256')):
                raise ValueError('SUPPORT_PREVIEW_SOURCE_CHANGED')
            if report.get('materialSha256')!=source['sha256']:
                raise ValueError('SUPPORT_REPORT_MATERIAL_MISMATCH')
            region=support_canvas_region(report,p,frozen['digest'],p['id'],
                                         digest(snapshot/'reference.png'),(width,height))
            with Image.open(matching[0]['source']) as raw:
                if list(raw.convert('RGBA').getchannel('A').getbbox())!=report['fitting']['sourceFullAlphaBox']:
                    raise ValueError('SUPPORT_SOURCE_ALPHA_MISMATCH')
            with Image.open(source['path']) as im:
                if (im.size!=(region[2]-region[0],region[3]-region[1])
                        or list(im.convert('RGBA').getchannel('A').getbbox())!=
                           report['fitting']['transformedAlphaBox']):
                    raise ValueError('SUPPORT_PNG_GEOMETRY')
        layers.append(dict(id=m['id'],name=m['label'],role=m['role'],path=f'layers/layer-{i+1:03}.png',
                           x=region[0] if 'reportPath' in source else p['xy'][0],
                           y=region[1] if 'reportPath' in source else p['xy'][1],
                           width=region[2]-region[0] if 'reportPath' in source else p['outputSize'][0],
                           height=region[3]-region[1] if 'reportPath' in source else p['outputSize'][1],visible=True))
    composition=dict(kind='ui_layer_composition_v1',canvas=dict(width=width,height=height),coordinates='top-left-pixels',
                     order='array-back-to-front',textPolicy=visual['textPolicy'],backgroundMode=visual['backgroundMode'],
                     reference='reference.png',preview='preview.png',layers=layers)
    result=write_package(snapshot/'reference.png',composition,sources,output,viewer,issues)
    result.update(sourceSnapshotDigest=frozen['digest'])
    save(output/'package-result.json',result)
    return result


def write_package(reference, composition, sources, output, viewer, issues):
    """Shared deterministic writer; callers own planning/acceptance provenance."""
    output=Path(output);viewer=Path(viewer);reference=Path(reference)
    layers=composition['layers']
    check_composition(composition)
    if set(sources)!={layer['id'] for layer in layers}:raise ValueError('COMPLETE_LAYER_SET_REQUIRED')
    for issue in issues:portable_text(issue)
    for name in ('viewer.html','viewer.js'):
        if not (viewer/name).is_file():raise ValueError('BUILT_VIEWER_REQUIRED')
    output.mkdir(parents=True,exist_ok=False);folder=output/'package';folder.mkdir();(folder/'layers').mkdir()
    for layer in layers:
        value=sources[layer['id']];data=Path(value['path']).read_bytes()
        if hashlib.sha256(data).hexdigest()!=value['sha256']:raise ValueError('SOURCE_CHANGED')
        (folder/layer['path']).write_bytes(data)
    (folder/'reference.png').write_bytes(reference.read_bytes())
    save(folder/'composition.json',composition)
    image=composite(folder,composition);image.save(folder/'preview.png')
    with Image.open(folder/'preview.png') as saved:
        if ImageChops.difference(image,saved.convert('RGBA')).getbbox():raise ValueError('COMPOSITE_MISMATCH')
    save(folder/'review.json',dict(status='review-required',humanVisualAcceptance=False,textPolicy=composition['textPolicy'],
         issues=issues,technicalChecks=['complete-layer-set','png-geometry','source-digests','pixel-composition'],
         scope='Static raster layer delivery only; not a component or interaction package.'))
    for name in ('viewer.html','viewer.js'):(folder/name).write_bytes((viewer/name).read_bytes())
    (folder/'README.txt').write_text('UI 拆分图层包 v1\n解压后打开 viewer.html，再选择本 ZIP 即可在本地查看。无需上传图片。\n'
        'composition.json 是唯一回拼合同：原图像素、左上角锚点、数组从后到前、PNG 原尺寸，不额外拉伸。\n'
        '本包待视觉验收；请查看 review.json。业务文字策略：'+composition['textPolicy']+'。\n'
        '不包含组件语义、业务行为、交互状态或字体还原；不宣称可以直接导入 ui-component。\n',encoding='utf-8')
    files={p.relative_to(folder).as_posix():dict(sha256=digest(p),bytes=p.stat().st_size)
           for p in sorted(folder.rglob('*'),key=lambda p:p.relative_to(folder).as_posix()) if p.is_file()}
    save(folder/'manifest.json',dict(kind='ui_layers_package_v1',version=1,files=files))
    archive=output/'ui-layers.zip'
    with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_STORED) as z:
        for p in sorted(folder.rglob('*'),key=lambda p:p.relative_to(folder).as_posix()):
            if p.is_file():
                info=zipfile.ZipInfo(p.relative_to(folder).as_posix(),(2020,1,1,0,0,0))
                info.external_attr=0o100644<<16;z.writestr(info,p.read_bytes())
    result=validate_archive(archive);result.update(layerCount=len(layers))
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--snapshot');p.add_argument('--sources');p.add_argument('--output');p.add_argument('--viewer')
    p.add_argument('--preview',help='Complete preview output directory; reads verified material outputs without a manual sources map')
    p.add_argument('--validate')
    a=p.parse_args()
    if a.validate:print(validate_archive(a.validate))
    else:
        if not all([a.snapshot,a.output,a.viewer]) or bool(a.sources)==bool(a.preview):p.error('snapshot, output, viewer and exactly one of sources/preview required')
        print(build(a.snapshot,sources_from_preview(a.snapshot,a.preview) if a.preview else a.sources,a.output,a.viewer))
