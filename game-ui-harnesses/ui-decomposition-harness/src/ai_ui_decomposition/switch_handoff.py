"""Offline, authenticated Switch stateImages rebind; preserve all other package bytes."""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile
from .common import require, read_json, write_json, sha256, safe_relative
from .component_handoff import _validate_state_text_colors
from .switch_state_images import validate_state_images
from .stateful import image_bytes, require_part_alpha


def rebind(source, binding_path, component_root, output):
    require(not output.exists(), 'SWITCH_HANDOFF_OUTPUT_EXISTS')
    output.mkdir(parents=True)
    cli=component_root/'scripts/cli.mjs'
    def consume(path, name):
        result=subprocess.run(['node',str(cli),'component-handoff',str(path),'--output',str(output/name)],capture_output=True,text=True)
        require(result.returncode==0,'SWITCH_HANDOFF_OFFICIAL_IMPORT:'+result.stderr[-2000:])
    consume(source,'source-consumed.json')
    with zipfile.ZipFile(source) as z:
        require(len(z.namelist())==len(set(z.namelist())) and sum(i.file_size for i in z.infolist())<=256*1024*1024,'SWITCH_HANDOFF_ARCHIVE')
        members={n:z.read(n) for n in z.namelist()}
    manifest=json.loads(members['handoff.json'])
    require(manifest.get('human_visual_acceptance') is False and manifest.get('delivery_policy')=='unreviewed_draft','SWITCH_HANDOFF_DRAFT_REQUIRED')
    for field in ('decomposition','component_bundle','appearance_binding'):
        entry=manifest[field]; safe_relative(output,entry['path'])
        require(hashlib.sha256(members[entry['path']]).hexdigest()==entry['sha256'],'SWITCH_HANDOFF_DIGEST')
    old=json.loads(members[manifest['appearance_binding']['path']]); new=read_json(binding_path)
    _validate_state_text_colors(new)
    stripped=copy.deepcopy(new); baseline=copy.deepcopy(old)
    for binding in (stripped,baseline):
        for row in binding['bindings']:
            if row.get('componentType')=='Switch': row.get('states',{}).get('switch',{}).pop('stateImages',None)
    require(stripped==baseline,'SWITCH_HANDOFF_UNRELATED_CHANGE')
    with zipfile.ZipFile(io.BytesIO(members[manifest['decomposition']['path']])) as z:
        scene=json.loads(z.read('scene.json'))
        layers={l['id']:l for g in scene['tree'] for l in g['children']}
        sizes={key:l['size'] for key,l in layers.items()}
        for row in new['bindings']:
            images=validate_state_images(row,sizes)
            if images:
                for side in ('off','on'):
                    for role in ('track','thumb'):
                        ident=images[side][role+'LayerId']; layer=layers[ident]; payload=z.read(layer['png'])
                        require(hashlib.sha256(payload).hexdigest()==layer['sha256'],'LAYER_CHANGED')
                        image=image_bytes(payload);require(list(image.size)==layer['size'],'SWITCH_STATE_IMAGE_SIZE_MISMATCH')
                        require_part_alpha(image.getchannel('A').getextrema(),'Switch',role,ident)
    require(any(validate_state_images(r) for r in new['bindings']),'SWITCH_STATE_IMAGES_REQUIRED')
    path=manifest['appearance_binding']['path']; members[path]=(json.dumps(new,ensure_ascii=False,indent=2)+'\n').encode('utf8')
    manifest['appearance_binding']['sha256']=hashlib.sha256(members[path]).hexdigest()
    members['handoff.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode('utf8')
    candidate=output/'candidate.zip'
    with zipfile.ZipFile(candidate,'x',compression=zipfile.ZIP_STORED) as z:
        for name,data in sorted(members.items()):
            info=zipfile.ZipInfo(name);info.external_attr=0o100644<<16;z.writestr(info,data)
    consume(candidate,'consumed.json')
    with zipfile.ZipFile(candidate) as z:
        require(z.testzip() is None and all(z.read(n)==v for n,v in members.items()),'SWITCH_HANDOFF_READBACK')
    target=output/'ui.component-handoff.draft.zip';candidate.rename(target)
    report={'kind':'ui_switch_state_handoff_v1','status':'official_import_passed','sourceSha256':sha256(source),'sha256':sha256(target),'file':target.name,'preservedMembers':[n for n in members if n not in ('handoff.json',path)],'human_visual_acceptance':False}
    write_json(output/'export.json',report)
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('source','binding','component-root','output'):p.add_argument('--'+name,required=True,type=Path)
    a=p.parse_args();print(json.dumps(rebind(a.source.resolve(),a.binding.resolve(),a.component_root.resolve(),a.output.resolve()),indent=2))

if __name__=='__main__':main()
