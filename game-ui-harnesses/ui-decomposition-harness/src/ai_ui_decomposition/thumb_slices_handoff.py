"""Offline binding-only thumb slicing; retain original reference and semantic bytes."""
import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path
from .common import require, read_json, write_json, sha256, safe_relative
from .stateful import archive_inputs, image_bytes
from .scrollbar_thumb_slices import validate_thumb_slices


def rebind(source, component_root, output, plan):
    require(set(plan)=={'kind','version','sourceSha256','componentId','thumbSha256','scrollbarThumbSlices','evidence'},'THUMB_SLICES_PLAN_FIELDS')
    require(plan['kind']=='ui-scrollbar-thumb-slices-plan' and plan['version']=='1.0','THUMB_SLICES_PLAN_VERSION')
    require(isinstance(plan['evidence'],str) and plan['evidence'].strip(),'THUMB_SLICES_EVIDENCE_REQUIRED')
    require(sha256(source)==plan['sourceSha256'],'THUMB_SLICES_SOURCE_CHANGED')
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    def consume(path,name):
        result=subprocess.run(['node',str(component_root/'scripts/cli.mjs'),'component-handoff',str(path),'--output',str(output/name)],capture_output=True,text=True,timeout=90)
        require(result.returncode==0,'THUMB_SLICES_OFFICIAL_IMPORT:'+result.stderr[-1000:])
    consume(source,'source-consumed.json')
    binding,assets=archive_inputs(source)
    rows=[b for b in binding['bindings'] if b['componentId']==plan['componentId'] and b['componentType']=='ScrollView']
    require(len(rows)==1,'THUMB_SLICES_COMPONENT')
    row=rows[0];parts=[p for p in row['parts'] if p['role']=='scrollbar-thumb']
    require(len(parts)==1 and parts[0]['layerId'] in assets,'THUMB_SLICES_LAYER')
    payload=assets[parts[0]['layerId']]
    require(hashlib.sha256(payload).hexdigest()==plan['thumbSha256'],'THUMB_SLICES_PNG_CHANGED')
    size=image_bytes(payload).size;state=row['states']['scrollView']
    value=validate_thumb_slices(plan['scrollbarThumbSlices'],size[1],'scrollbarInsets' in state)
    state['scrollbarThumbSlices']=value
    with zipfile.ZipFile(source) as z:
        require(len(z.namelist())==len(set(z.namelist())) and sum(i.file_size for i in z.infolist())<=256*1024*1024,'THUMB_SLICES_ARCHIVE')
        members={n:z.read(n) for n in z.namelist()}
    for name in members:safe_relative(output,name)
    original=dict(members);manifest=json.loads(members['handoff.json'])
    require(manifest['human_visual_acceptance'] is False,'THUMB_SLICES_DRAFT_REQUIRED')
    entry=manifest['appearance_binding'];name=entry['path']
    members[name]=(json.dumps(binding,ensure_ascii=False,indent=2)+'\n').encode()
    entry['sha256']=hashlib.sha256(members[name]).hexdigest()
    members['handoff.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
    candidate=output/'candidate.zip'
    with zipfile.ZipFile(candidate,'x',compression=zipfile.ZIP_STORED) as z:
        for key,data in sorted(members.items()):z.writestr(key,data)
    consume(candidate,'consumed.json')
    consumed=read_json(output/'consumed.json',max_bytes=64*1024*1024)
    def walk(n):
        yield n
        for c in n.get('children',[]):yield from walk(c)
    node=next(n for n in walk(consumed['document']['root']) if n['id']==plan['componentId'])
    require(node['props']['appearance'].get('scrollbarThumbSlices')==value,'THUMB_SLICES_CONSUMER_DROPPED')
    preserved=[n for n in original if n not in ('handoff.json',name)]
    with zipfile.ZipFile(candidate) as z:
        require(z.testzip() is None and all(z.read(n)==original[n] for n in preserved),'THUMB_SLICES_PRESERVATION')
    target=output/'ui.component-handoff.draft.zip';candidate.rename(target)
    report={'kind':'ui_scrollbar_thumb_slices_export_v1','status':'official_import_passed','sourceSha256':plan['sourceSha256'],
            'sha256':sha256(target),'componentId':plan['componentId'],'thumbSha256':plan['thumbSha256'],'thumbSize':list(size),
            'scrollbarThumbSlices':value,'preservedMembers':preserved,'evidence':plan['evidence'],'human_visual_acceptance':False}
    write_json(output/'plan.json',plan);write_json(output/'export.json',report)
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('source','component-root','output','plan'):p.add_argument('--'+key,type=Path,required=True)
    a=p.parse_args();print(json.dumps(rebind(a.source.resolve(),a.component_root.resolve(),a.output.resolve(),read_json(a.plan)),indent=2))


if __name__=='__main__':main()
