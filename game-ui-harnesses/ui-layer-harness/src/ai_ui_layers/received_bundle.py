"""Verify and consolidate received raw requests from immutable image jobs.

This does not invent a receipt, dispatch media, or bypass later extraction and
material gates. A source request must have identical frozen inputs to its target.
"""
import json
from pathlib import Path
import shutil

from .evaluate import read, save, digest
from .execution_preflight import preflight
from .experimental_executor import load_job, status, verified


def inspect_sources(snapshot, expected_digest, selection, require_all=False, allowed_variants=None):
    """Selection maps target request IDs to existing received-job directories."""
    snapshot = Path(snapshot).resolve()
    allowed_variants = allowed_variants or {}
    if not set(allowed_variants) <= set(selection):
        raise ValueError('UNSELECTED_PROMPT_VARIANT')
    preflight(snapshot, expected_digest)
    targets = {row['asset']: row for row in read(snapshot/'requests.json')['requests']}
    if not selection or not set(selection) <= set(targets):
        raise ValueError('INVALID_BUNDLE_SELECTION')
    missing = sorted(set(targets)-set(selection))
    if require_all and missing:
        raise ValueError('INCOMPLETE_RECEIVED_BUNDLE')
    records = []
    for asset, job_path in selection.items():
        job = Path(job_path).resolve()
        config, rows = load_job(job)
        states = status(job)['requests']
        if asset not in config['assets'] or states[asset] != 'raw_received':
            raise ValueError('SOURCE_NOT_RECEIVED:'+asset)
        reference_mode = config.get('referenceMode')
        if reference_mode not in ('full-only', 'crop-only'):
            raise ValueError('REFERENCE_MODE_MISMATCH:'+asset)
        source_row, target_row = rows[asset], targets[asset]
        if source_row != target_row:
            raise ValueError('REQUEST_MISMATCH:'+asset)
        source_snapshot = job/'snapshot'
        for field in ('reference', 'crop'):
            if field in target_row and digest(source_snapshot/source_row[field]) != digest(snapshot/target_row[field]):
                raise ValueError(field.upper()+'_MISMATCH:'+asset)
        source_prompt = (job/'prompt-variant.txt' if 'promptVariant' in config
                         else source_snapshot/source_row['prompt'])
        default_prompt = snapshot/target_row['prompt']
        prompt_changed = source_prompt.read_text(encoding='utf-8').rstrip('\n') != default_prompt.read_text(encoding='utf-8').rstrip('\n')
        variant_sha = config.get('promptVariant', {}).get('sha256')
        if prompt_changed:
            if (not variant_sha or allowed_variants.get(asset) != variant_sha or
                    config['snapshotDigest'] != expected_digest):
                raise ValueError('PROMPT_MISMATCH:'+asset)
        elif asset in allowed_variants:
            raise ValueError('UNUSED_PROMPT_VARIANT:'+asset)
        if reference_mode == 'crop-only' and (
                len(config['assets']) != 1 or not prompt_changed or
                allowed_variants.get(asset) != variant_sha or
                config['snapshotDigest'] != expected_digest):
            raise ValueError('REFERENCE_MODE_MISMATCH:'+asset)
        folder = job/'attempts'/asset
        receipt = verified(folder/'received.json')
        submission = verified(folder/'submission.json')
        if receipt['submissionDigest'] != submission['digest'] or digest(folder/'raw.png') != receipt['rawSha256']:
            raise ValueError('RECEIPT_MISMATCH:'+asset)
        if prompt_changed:
            session = job/'generation-sessions'/submission['digest']
            audit_file = session/'image-call-audit.json'
            if not audit_file.is_file():
                raise ValueError('VARIANT_CALL_AUDIT_MISSING:'+asset)
            audit = read(audit_file)
            if (audit.get('observedImageCalls') != 1 or
                    audit.get('exactPromptMatch') is not True or
                    audit.get('sourceSha256') != receipt['rawSha256']):
                raise ValueError('VARIANT_CALL_AUDIT_MISMATCH:'+asset)
            if reference_mode == 'crop-only':
                request_file = session/'tool-request.json'
                if not request_file.is_file():
                    raise ValueError('CROP_REFERENCE_AUDIT_MISSING:'+asset)
                request = read(request_file)
                arguments = request.get('arguments', {})
                references = arguments.get('referenced_image_paths')
                if (request.get('asset') != asset or
                        request.get('submissionDigest') != submission['digest'] or
                        arguments.get('prompt', '').rstrip('\n') != source_prompt.read_text(encoding='utf-8').rstrip('\n') or
                        request.get('automaticRetries') != 0 or
                        not isinstance(references, list) or len(references) != 1 or
                        not isinstance(references[0], str) or
                        Path(references[0]).resolve() != (source_snapshot/source_row['crop']).resolve()):
                    raise ValueError('CROP_REFERENCE_AUDIT_MISMATCH:'+asset)
        records.append(dict(asset=asset, sourceJobDigest=config['digest'],
                            sourceSnapshotDigest=config['snapshotDigest'],
                            receiptDigest=receipt['digest'], rawSha256=receipt['rawSha256'],
                            promptSha256=digest(source_prompt),
                            frozenPromptSha256=digest(default_prompt),
                            promptMode='approved_variant' if prompt_changed else 'frozen',
                            promptVariantSha256=variant_sha if prompt_changed else None,
                            referenceMode=reference_mode,
                            referenceSha256=digest(source_snapshot/source_row['reference']),
                            **({'cropSha256':digest(source_snapshot/source_row['crop'])}
                               if 'crop' in source_row else {}),
                            source=str(folder/'raw.png')))
    return dict(kind='ui_received_request_bundle_check_v1', targetSnapshotDigest=expected_digest,
                status='complete' if not missing else 'incomplete', missing=missing,
                records=records, generationCalls=0, humanVisualAcceptance=False)


def materialize(snapshot, expected_digest, selection, output, allowed_variants=None):
    """Copy only verified raw PNGs into a fresh directory for later official gates."""
    checked = inspect_sources(snapshot, expected_digest, selection, require_all=True,
                              allowed_variants=allowed_variants)
    for record in checked['records']:
        asset = record['asset']
        if Path(asset).name != asset or asset in ('.', '..'):
            raise ValueError('UNSAFE_ASSET_ID')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    raw = output/'raw';raw.mkdir()
    records = []
    for record in checked['records']:
        asset = record['asset']
        target = raw/(asset+'.png')
        shutil.copyfile(record['source'], target)
        if digest(target) != record['rawSha256']:
            raise ValueError('COPIED_RAW_CHANGED:'+asset)
        records.append({k:v for k,v in record.items() if k!='source'} | {'file':target.relative_to(output).as_posix()})
    report = {**checked, 'records':records, 'status':'verified_raw_complete',
              'postprocessing':'not_run', 'materialCount':len(records)}
    save(output/'manifest.json', report)
    return report


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',required=True)
    parser.add_argument('--expected-digest',required=True)
    parser.add_argument('--source',action='append',required=True,help='ASSET=RECEIVED_JOB_DIRECTORY')
    parser.add_argument('--output',help='Materialize complete verified bundle here; omit for read-only check')
    args=parser.parse_args()
    selection={}
    for item in args.source:
        asset,sep,path=item.partition('=')
        if not sep or not asset or not path or asset in selection:
            parser.error('each --source must be a unique ASSET=JOB')
        selection[asset]=path
    result=(materialize(args.snapshot,args.expected_digest,selection,args.output) if args.output
            else inspect_sources(args.snapshot,args.expected_digest,selection))
    print(json.dumps(result,ensure_ascii=False,indent=2))
