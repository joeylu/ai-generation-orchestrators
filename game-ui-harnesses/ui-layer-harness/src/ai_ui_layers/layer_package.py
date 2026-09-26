"""Portable UI artwork package only: no component semantics, model calls or UI drawing."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile
from PIL import Image,ImageChops
from jsonschema import Draft202012Validator
from .compile_visual import HARNESS
from .evaluate import read,save,digest
from .freeze_visual import inspect

SCHEMA=HARNESS/'planning-harness/schemas/layer-composition.schema.json'


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
    known={p['id'] for p in read(snapshot/'placements.json')['materials']};sources={}
    for row in report['records']:
        key=row['id']
        if key not in known or key in sources:raise ValueError('PREVIEW_LAYER_SET')
        path=(preview/key/'material.png').resolve()
        if not path.is_relative_to(preview):raise ValueError('PREVIEW_PATH')
        if row['report']['status']!='processed_pending_visual_review':raise ValueError('PREVIEW_BLOCKED')
        if digest(path)!=row['report']['materialSha256']:raise ValueError('PREVIEW_MATERIAL_CHANGED')
        sources[key]=dict(path=str(path),sha256=digest(path))
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
        layers.append(dict(id=m['id'],name=m['label'],role=m['role'],path=f'layers/layer-{i+1:03}.png',
                           x=p['xy'][0],y=p['xy'][1],width=p['outputSize'][0],height=p['outputSize'][1],visible=True))
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
