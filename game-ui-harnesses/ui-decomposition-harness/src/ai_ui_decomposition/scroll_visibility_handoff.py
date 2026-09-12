"""Offline visibility-only rebind using the consumer's existing ScrollView contract."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile
from .common import require, write_json, sha256, safe_relative


def rebind(source, component_root, output, component_id, visibility):
    require(visibility in ('auto', 'always'), 'SCROLL_VISIBILITY_INVALID')
    require(not output.exists(), 'SCROLL_HANDOFF_OUTPUT_EXISTS')
    output.mkdir(parents=True)
    def consume(path, name):
        run = subprocess.run(['node', str(component_root/'scripts/cli.mjs'), 'component-handoff', str(path), '--output', str(output/name)], capture_output=True, text=True)
        require(run.returncode == 0, 'SCROLL_HANDOFF_IMPORT:' + run.stderr[-2000:])
    consume(source, 'source-consumed.json')
    with zipfile.ZipFile(source) as z:
        require(len(z.namelist()) == len(set(z.namelist())) and sum(i.file_size for i in z.infolist()) <= 256*1024*1024, 'SCROLL_HANDOFF_ARCHIVE')
        members = {n:z.read(n) for n in z.namelist()}
    for name in members: safe_relative(output, name)
    original = dict(members)
    manifest = json.loads(members['handoff.json'])
    require(manifest.get('human_visual_acceptance') is False, 'SCROLL_HANDOFF_DRAFT_REQUIRED')
    for field in ('component_bundle', 'appearance_binding', 'decomposition'):
        entry = manifest[field]
        require(hashlib.sha256(members[entry['path']]).hexdigest() == entry['sha256'], 'SCROLL_HANDOFF_DIGEST')
    bundle_path = manifest['component_bundle']['path']
    binding_path = manifest['appearance_binding']['path']
    bundle = json.loads(members[bundle_path]); binding = json.loads(members[binding_path])
    def walk(node):
        yield node
        for child in node.get('children', []): yield from walk(child)
    nodes = [n for n in walk(bundle['document']['root']) if n['id'] == component_id]
    require(len(nodes) == 1 and nodes[0]['type'] == 'ScrollView', 'SCROLL_HANDOFF_COMPONENT')
    before = nodes[0]['props'].get('scrollbarVisibility')
    nodes[0]['props']['scrollbarVisibility'] = visibility
    write_json(output/'semantic-candidate.json', bundle)
    script = "import fs from 'node:fs'; import {validateBundle} from './lib/bundle.js'; import {appearanceDocumentSha256} from './lib/appearance-binding.js'; const b=await validateBundle(JSON.parse(fs.readFileSync(process.argv[1],'utf8'))); console.log(await appearanceDocumentSha256(b.document));"
    run = subprocess.run(['node', '--input-type=module', '-e', script, str(output/'semantic-candidate.json')], cwd=component_root, capture_output=True, text=True)
    require(run.returncode == 0, 'SCROLL_HANDOFF_DOCUMENT:' + run.stderr)
    binding['documentSha256'] = run.stdout.strip()
    for field, value in (('component_bundle', bundle), ('appearance_binding', binding)):
        entry = manifest[field]
        members[entry['path']] = (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode('utf8')
        entry['sha256'] = hashlib.sha256(members[entry['path']]).hexdigest()
    members['handoff.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode('utf8')
    candidate = output/'candidate.zip'
    with zipfile.ZipFile(candidate, 'x', compression=zipfile.ZIP_STORED) as z:
        for name, data in sorted(members.items()): z.writestr(name, data)
    consume(candidate, 'consumed.json')
    preserved = [n for n in members if n not in ('handoff.json', bundle_path, binding_path)]
    with zipfile.ZipFile(candidate) as z:
        require(z.testzip() is None and all(z.read(n) == original[n] for n in preserved), 'SCROLL_HANDOFF_PRESERVATION')
    target = output/'ui.component-handoff.draft.zip'; candidate.rename(target)
    report = dict(kind='ui_scroll_visibility_rebind_v1', sourceSha256=sha256(source), sha256=sha256(target), componentId=component_id, before=before, after=visibility, preservedMembers=preserved, officialImport='passed', human_visual_acceptance=False)
    write_json(output/'export.json', report)
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for key in ('source', 'component-root', 'output'): p.add_argument('--'+key, type=Path, required=True)
    p.add_argument('--component-id', required=True); p.add_argument('--visibility', choices=['auto','always'], required=True)
    a = p.parse_args()
    print(json.dumps(rebind(a.source.resolve(), a.component_root.resolve(), a.output.resolve(), a.component_id, a.visibility), indent=2))
