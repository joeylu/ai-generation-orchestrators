"""Revise authored semantic/layout documents while preserving verified v2 artwork/evidence."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile
from .common import require,read_json,write_json,sha256,safe_relative

def revise(source,bundle_path,binding_path,component_root,output):
    require(not output.exists(),'APPEARANCE_REVISION_OUTPUT_EXISTS');output.mkdir(parents=True)
    def consume(path,name):
        r=subprocess.run(['node',str(component_root/'scripts/cli.mjs'),'component-handoff',str(path),'--output',str(output/name)],capture_output=True,text=True)
        require(r.returncode==0,'APPEARANCE_REVISION_IMPORT:'+r.stderr[-2000:])
    consume(source,'source-consumed.json')
    with zipfile.ZipFile(source) as z:
        require(len(z.namelist())==len(set(z.namelist())) and sum(i.file_size for i in z.infolist())<=256*1024*1024,'APPEARANCE_REVISION_ARCHIVE')
        members={n:z.read(n) for n in z.namelist()}
    for name in members:safe_relative(output,name)
    original=dict(members);manifest=json.loads(members['handoff.json'])
    require(manifest.get('kind')=='ai_ui_component_handoff_v2' and manifest.get('human_visual_acceptance') is False,'APPEARANCE_REVISION_V2_DRAFT_REQUIRED')
    bundle=read_json(bundle_path,max_bytes=64*1024*1024);binding=read_json(binding_path)
    old=json.loads(members[manifest['component_bundle']['path']]);old_binding=json.loads(members[manifest['appearance_binding']['path']])
    require(bundle.get('resources')==old.get('resources'),'APPEARANCE_REVISION_ART_CHANGED')
    def topology(n):return [n['id'],n['type'],[topology(c) for c in n.get('children',[])]]
    require(topology(bundle['document']['root'])==topology(old['document']['root']),'APPEARANCE_REVISION_TOPOLOGY_CHANGED')
    for key in ('deliveryDigest','sceneSha256','archiveSha256','registration'):
        require(binding[key]==old_binding[key],'APPEARANCE_REVISION_SOURCE_CHANGED')
    script="import fs from 'node:fs';import {validateBundle} from './lib/bundle.js';import {appearanceDocumentSha256} from './lib/appearance-binding.js';const b=await validateBundle(JSON.parse(fs.readFileSync(process.argv[1],'utf8')));console.log(await appearanceDocumentSha256(b.document));"
    r=subprocess.run(['node','--input-type=module','-e',script,str(bundle_path)],cwd=component_root,capture_output=True,text=True)
    require(r.returncode==0,'APPEARANCE_REVISION_DOCUMENT:'+r.stderr);binding['documentSha256']=r.stdout.strip()
    for field,value in [('component_bundle',bundle),('appearance_binding',binding)]:
        entry=manifest[field];members[entry['path']]=(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf8');entry['sha256']=hashlib.sha256(members[entry['path']]).hexdigest()
    members['handoff.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode('utf8')
    candidate=output/'candidate.zip'
    with zipfile.ZipFile(candidate,'x',compression=zipfile.ZIP_STORED) as z:
        for name,data in sorted(members.items()):z.writestr(name,data)
    consume(candidate,'consumed.json')
    preserved=[n for n in members if n not in ('handoff.json',manifest['component_bundle']['path'],manifest['appearance_binding']['path'])]
    with zipfile.ZipFile(candidate) as z:require(z.testzip() is None and all(z.read(n)==original[n] for n in preserved),'APPEARANCE_REVISION_PRESERVATION')
    target=output/'ui.component-handoff.draft.zip';candidate.rename(target)
    report=dict(kind='ui_appearance_revision_v1',sourceSha256=sha256(source),sha256=sha256(target),preservedMembers=preserved,status='official_import_passed',human_visual_acceptance=False)
    write_json(output/'revision.json',report);return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('source','bundle','binding','component-root','output'):p.add_argument('--'+name,required=True,type=Path)
    a=p.parse_args();print(json.dumps(revise(a.source.resolve(),a.bundle.resolve(),a.binding.resolve(),a.component_root.resolve(),a.output.resolve()),indent=2))
