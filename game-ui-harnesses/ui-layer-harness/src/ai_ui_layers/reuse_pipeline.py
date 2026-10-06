"""Bound opt-in reuse for new host runs; historical requests remain unchanged."""
from pathlib import Path
from .evaluate import read, digest
from . import material_reuse as reuse

INPUT_NAME = 'material-reuse.json'
POLICY = 'identity-byte-copy-v1'


def planning_input(root, visual=None):
    root=Path(root);config=read(root/'.dag/config.json')
    if INPUT_NAME not in config['inputs']:
        return None
    if config.get('planningDriver')!='host-model-exchange-v1':
        raise ValueError('REUSE_HOST_DRIVER_REQUIRED')
    path=root/'.dag/inputs'/INPUT_NAME
    if digest(path)!=config['inputs'][INPUT_NAME]:raise ValueError('REUSE_INPUT_CHANGED')
    visual=visual or read(root/'m1/draft.json')
    return reuse.validate(read(path),visual,digest(root/'m1/reference.png'),digest(root/'m1/draft.json'))


def snapshot_input(folder, manifest, visual=None):
    folder=Path(folder)
    if 'materialReusePolicy' not in manifest:
        if INPUT_NAME in manifest['files'] or 'materialReuseSha256' in manifest:
            raise ValueError('REUSE_METADATA_REQUIRED')
        return None
    if (manifest['materialReusePolicy']!=POLICY or INPUT_NAME not in manifest['files']
            or digest(folder/INPUT_NAME)!=manifest['materialReuseSha256']):
        raise ValueError('REUSE_SNAPSHOT_CHANGED')
    config=read(folder/'evidence/host-review-config.json')
    if config['inputs'].get(INPUT_NAME)!=manifest['materialReuseSha256']:
        raise ValueError('REUSE_REVIEW_INPUT_REQUIRED')
    if visual is None:
        path=folder/'evidence/revised-visual-plan.json'
        visual=read(path if path.exists() else folder/'evidence/m1-draft.json')
    doc=reuse.validate(read(folder/INPUT_NAME),visual,digest(folder/'reference.png'),manifest['sourcePlanSha256'])
    reuse.validate_review(read(folder/'evidence/m2-draft.json'),doc)
    return doc


def scoped(doc, mids):
    if doc is None:return None
    groups=[g for g in doc['groups'] if g['prototypeMaterialId'] in mids]
    return dict(doc,groups=groups) if groups else None


def guidance(doc):
    if doc is None:return ''
    import json
    return ('\nExplicit byte-copy prototype declarations follow. Independently compare every declared instance '
        'in the original source: full contour, surface, internal parts, observed state, text permissions and '
        'ownership must permit the SAME source PNG. Different states, attached parts, motifs or missing details '
        'are not reusable. Source regions remain independent and will receive their own body observations. '
        'Return reuseAudit for each complete group; equivalent=false blocks new generation. '
        'A declaration or similar box is not proof of visual equivalence.\n'+json.dumps(doc,ensure_ascii=False))


def source_focus(reference, visual, doc, output):
    """Original pixels enlarged only for observation, never prototype generation."""
    if doc is None:return
    from PIL import Image,ImageDraw,ImageOps
    from .evaluate import pixel_box,save
    owners={m['id']:m for m in visual['materials']}
    ids=[mid for g in doc['groups'] for mid in [g['prototypeMaterialId'],*g['instanceMaterialIds']]]
    output=Path(output);columns=4;cellw=264;cellh=256
    board=Image.new('RGB',(columns*cellw,((len(ids)+columns-1)//columns)*cellh),'white')
    records=[]
    with Image.open(reference) as original:
        original.load()
        for i,mid in enumerate(ids):
            box=pixel_box(owners[mid]['bboxNorm'],*original.size)
            crop=original.crop(box).convert('RGB');tile=ImageOps.contain(crop,(cellw-16,cellh-36),Image.Resampling.NEAREST)
            x=(i%columns)*cellw;y=(i//columns)*cellh
            board.paste(tile,(x+(cellw-tile.width)//2,y+30+(cellh-36-tile.height)//2))
            ImageDraw.Draw(board).text((x+8,y+8),mid,fill='black')
            records.append(dict(materialId=mid,sourceBox=box,boardCell=[x,y,x+cellw,y+cellh]))
    board.save(output/'reuse-source-focus.png')
    save(output/'reuse-source-focus.json',dict(referenceSha256=digest(Path(reference)),contract=doc,
        observationOnly=True,sourcePixelsEdited=False,records=records))
