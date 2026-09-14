"""Producer integration for the authoritative consumer valueTextBindings contract."""
import json
from pathlib import Path
import subprocess
import zipfile

from .common import read_json, require, sha256, write_json


def attach(source: Path, bindings: Path, component_root: Path, output: Path) -> dict:
    require(not output.exists(), 'VALUE_TEXT_OUTPUT_EXISTS')
    cli = component_root/'scripts/cli.mjs'
    require(cli.is_file(), 'VALUE_TEXT_OFFICIAL_CLI_REQUIRED')
    require(source.is_file() and bindings.is_file(), 'VALUE_TEXT_INPUT_REQUIRED')
    source_hash, bindings_hash = sha256(source), sha256(bindings)
    output.mkdir(parents=True)
    candidate = output/'candidate.zip'

    def invoke(args: list[str], log: str) -> None:
        result = subprocess.run(['node', str(cli), *args], capture_output=True, text=True,
                                encoding='utf8', errors='replace', timeout=120)
        write_json(output/log, dict(exit_code=result.returncode, stdout=result.stdout, stderr=result.stderr))
        require(result.returncode == 0, 'VALUE_TEXT_OFFICIAL_CLI_REJECTED:'+log)

    invoke(['bind-value-text', str(source), str(bindings), '--output', str(candidate)], 'attach-cli.json')
    invoke(['component-handoff', str(candidate), '--output', str(output/'consumed.json')], 'import-cli.json')
    consumed = read_json(output/'consumed.json', max_bytes=67_108_864)
    require(consumed['document'].get('valueTextBindings') == read_json(bindings), 'VALUE_TEXT_BINDINGS_CHANGED')
    require(sha256(source) == source_hash and sha256(bindings) == bindings_hash, 'VALUE_TEXT_SOURCE_CHANGED')
    with zipfile.ZipFile(source) as before, zipfile.ZipFile(candidate) as after:
        names = before.namelist()
        require(len(names)==len(set(names)) and set(names)==set(after.namelist()), 'VALUE_TEXT_MEMBERS_CHANGED')
        manifest = json.loads(before.read('handoff.json'))
        current = json.loads(after.read('handoff.json'))
        require(current.get('human_visual_acceptance') is False, 'VALUE_TEXT_HUMAN_FLAG_CHANGED')
        allowed = {'handoff.json', manifest['component_bundle']['path'], manifest['appearance_binding']['path']}
        # Consumer may refresh an already-present saved runtime document as well.
        if 'runtime_bundle' in manifest:
            allowed.add(manifest['runtime_bundle']['path'])
        preserved = []
        for name in names:
            if name not in allowed:
                require(before.read(name)==after.read(name), 'VALUE_TEXT_EVIDENCE_CHANGED:'+name)
                preserved.append(name)
        require(current.get('reference')==manifest.get('reference'), 'VALUE_TEXT_REFERENCE_MANIFEST_CHANGED')
    target = output/'ui.component-handoff.draft.zip'
    candidate.rename(target)
    result = dict(kind='ai_ui_value_text_handoff_v1', status='official_import_passed',
                  binding_version=consumed['document']['valueTextBindings']['version'],
                  source_sha256=source_hash, bindings_sha256=bindings_hash, sha256=sha256(target),
                  file=target.name, preserved_members=preserved, human_visual_acceptance=False,
                  reference_acceptance='not_established_by_attachment', generation_calls=0)
    write_json(output/'export.json', result)
    return result
