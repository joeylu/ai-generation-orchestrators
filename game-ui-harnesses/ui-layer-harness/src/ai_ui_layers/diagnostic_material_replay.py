"""Revalidate genuine partial reviews; never certify the missing request set."""
from pathlib import Path

from PIL import Image

from .evaluate import read, digest
from .host_material_review import verify_run, verify_unresolved_run, IDENTITY_UNRESOLVED_STATUS, files
from .diagnostic_sheet_partition import partition
from . import material_reuse


def checked_reviews(checked, runs):
    from .received_source_batch import received_sources
    with received_sources(checked[0]) as source_batch:
        return _checked_reviews(checked,runs,source_batch)


def _checked_reviews(checked, runs, source_batch):
    job, config, snapshot, manifest, rows, visual, reuse, background, bindings = checked
    if not isinstance(runs, list) or not runs:
        raise ValueError('DIAGNOSTIC_REVIEW_RUNS_REQUIRED')
    requests = {r['asset']: r for r in rows}
    originals = {b['requestId']: b for b in bindings}
    materials = {}; hashes = {}; records = []; warnings = []; seen = set(); reviewed = set()
    for path in runs:
        root = Path(path).resolve()
        unresolved = read(root/'result.json')['status']==IDENTITY_UNRESOLVED_STATUS
        request, result = (verify_unresolved_run if unresolved else verify_run)(root,source_batch=source_batch)
        key = request['requestId']
        if (key in seen or key not in requests or request['jobDigest'] != config['digest']
                or request['snapshotDigest'] != manifest['digest']
                or Path(request['job']).resolve() != job
                or request['rawSha256'] != originals[key]['rawSha256']
                or request['materialIds'] != material_reuse.expanded_ids(reuse, requests[key].get('materialIds', [key]))):
            raise ValueError('DIAGNOSTIC_REVIEW_SOURCE_MISMATCH')
        seen.add(key)
        records.append(dict(path=str(root), files=files(root), requestId=key,
            requestSha256=digest(root/'request.json'), resultSha256=digest(root/'result.json')))
        warnings.extend(dict(w, requestId=key) for w in result['warnings'])
        if unresolved:
            continue
        reviewed.add(key)
        candidate = read(root/'extraction-candidate.json')
        if list(candidate['materials']) != request['materialIds']:
            raise ValueError('OUTPUT_MATERIAL_ORDER_CHANGED')
        for mid, source in candidate['materials'].items():
            row = next(r for r in candidate['records'] if r['materialId'] == mid)
            if mid in materials or digest(Path(source)) != row['outputSha256']:
                raise ValueError('REVIEWED_MATERIAL_CHANGED')
            materials[mid] = source; hashes[mid] = row['outputSha256']
    return dict(reviewRuns=records, materials=materials, sourceHashes=hashes,
        reviewedRequestIds=sorted(reviewed), unreviewedRequestIds=sorted(set(requests)-reviewed),
        warnings=warnings, fullMaterialReviewPassed=False, originalDagPromoted=False)


def candidate_sources(checked, output, replay=None):
    """Keep raw capacity crops as evidence, then prefer each reviewed source."""
    job, config, snapshot, manifest, rows, visual, reuse, background, bindings = checked
    output = Path(output); output.mkdir(parents=True, exist_ok=False)
    sources = {}; provenance = {}
    by_key = {b['requestId']: b for b in bindings}
    for row in rows:
        key = row['asset']; raw = job/'attempts'/key/'raw.png'
        if row.get('kind') == 'sheet':
            with Image.open(raw) as opened:
                image = opened.convert('RGBA')
            boxes, evidence = partition(image, row)
            for i, box in enumerate(evidence['partitionBoxes']):
                image.crop(box).save(output/(key+'-cell-'+str(i)+'.png'))
            for i, (mid, box) in enumerate(zip(row['materialIds'], boxes)):
                sources[mid] = str(output/(key+'-cell-'+str(i)+'.png'))
                provenance[mid] = dict(by_key[key], sourceBox=box)
        else:
            sources[key] = str(raw); provenance[key] = dict(by_key[key])
    sources = material_reuse.derive(reuse, sources, output/'reused', provenance)['materials']
    if replay is not None:
        sources.update(replay['materials'])
    if set(sources) != {m['id'] for m in visual['materials']}:
        raise ValueError('COMPLETE_LAYER_SET_REQUIRED')
    return sources


def portable(replay):
    return dict(reviewedRequestIds=replay['reviewedRequestIds'],
        unreviewedRequestIds=replay['unreviewedRequestIds'],
        reviewedMaterialIds=sorted(replay['materials']), sourceHashes=replay['sourceHashes'],
        warnings=public_value(replay['warnings']), fullMaterialReviewPassed=False, originalDagPromoted=False)


def public_value(value):
    """Retain full answers locally; redact nonportable prose in public evidence."""
    from .layer_package import portable_text
    if isinstance(value,str):
        try:return portable_text(value)
        except ValueError:return '[Nonportable text retained in local review evidence]'
    if isinstance(value,list):return [public_value(v) for v in value]
    if isinstance(value,dict):
        private = {'bodyJob','bodyJobFiles','bodyJobDigest','jobDigest','submissionDigest',
            'authorizationDigest','originalSealSha256','originalSealStatus'}
        return {k:public_value(v) for k,v in value.items() if k not in private}
    return value
