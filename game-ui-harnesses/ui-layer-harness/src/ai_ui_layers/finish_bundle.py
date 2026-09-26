"""Finish an exact, fully received singleton request bundle from multiple jobs."""
from pathlib import Path
import time

from .evaluate import read, save, digest
from .freeze_visual import inspect
from .received_bundle import inspect_sources, materialize
from .extract_sheets import extract
from .adapt_strip import adapt_materials
from .automatic_registration import run as register
from .layer_package import build, sources_from_preview


def finish(snapshot, expected_digest, selection, output, viewer, registration_model=None,
           allowed_variants=None):
    snapshot, output, viewer = map(lambda value: Path(value).resolve(),
                                   (snapshot, output, viewer))
    if output.exists() or output == snapshot or output.is_relative_to(snapshot):
        raise ValueError('FRESH_SEPARATE_OUTPUT_REQUIRED')
    inspect(snapshot, expected_digest)
    rows = read(snapshot/'requests.json')['requests']
    if any(row.get('kind') == 'sheet' or 'materialIds' in row for row in rows):
        raise ValueError('SINGLETON_REQUESTS_REQUIRED')
    selected = {row['asset']: selection[row['asset']] for row in rows if row['asset'] in selection}
    if set(selected) != set(selection):
        raise ValueError('UNKNOWN_BUNDLE_REQUEST')
    verified = inspect_sources(snapshot, expected_digest, selected, require_all=True,
                               allowed_variants=allowed_variants)
    viewer_bytes = {name: (viewer/name).read_bytes() for name in ('viewer.html', 'viewer.js')}

    output.mkdir(parents=True, exist_ok=False)
    inputs = output/'inputs'; inputs.mkdir()
    for name, data in viewer_bytes.items():
        (inputs/name).write_bytes(data)
    from .delivery_dag import runtime_files
    save(output/'execution.json', dict(snapshotDigest=expected_digest,
         sourceJobDigests=sorted({record['sourceJobDigest'] for record in verified['records']}),
         runtime=runtime_files(), inputs={name: digest(inputs/name) for name in viewer_bytes},
         originalDagPromoted=False, generationCalls=0))
    save(output/'verified-sources.json', verified)

    started = time.time(); stage = 'bundle'; t = started; times = {}
    try:
        bundle = materialize(snapshot, expected_digest, selected, output/'bundle',
                             allowed_variants=allowed_variants)
        times[stage] = time.time()-t
        sources = {record['asset']: str(output/'bundle'/record['file'])
                   for record in bundle['records']}
        stage = 'extract'; t = time.time()
        extracted = extract(snapshot, expected_digest, sources, output/'extraction')
        if extracted['modelCalls'] != 0:
            raise ValueError('SINGLETON_EXTRACT_MODEL_CALL')
        times[stage] = time.time()-t
        stage = 'adapt'; t = time.time()
        adapted = adapt_materials(snapshot, extracted['materials'], output/'adaptation',
                                  extracted.get('adaptations', {}))
        times[stage] = time.time()-t
        config = output/'registration-input.json'
        save(config, dict(snapshot=str(snapshot), snapshotDigest=expected_digest,
                          materials=adapted))
        stage = 'registration'; t = time.time()
        registration = register(config, output/'registration', model_call=registration_model)
        times[stage] = time.time()-t
        stage = 'package'; t = time.time()
        if inspect_sources(snapshot, expected_digest, selected, require_all=True,
                           allowed_variants=allowed_variants) != verified:
            raise ValueError('SOURCE_RECEIPTS_CHANGED')
        package = build(snapshot, sources_from_preview(snapshot, output/'registration/preview',
                        extracted.get('warnings', [])), output/'delivery', inputs)
        times[stage] = time.time()-t
        result = dict(status='delivered_pending_visual_review', package=package,
                      sourceJobsCount=len({record['sourceJobDigest'] for record in verified['records']}),
                      reusedReceivedRequests=len(verified['records']),
                      modelCalls=registration['modelCalls'], warnings=extracted.get('warnings', []))
    except Exception as exc:
        times[stage] = time.time()-t
        save(output/'result.json', dict(status='blocked_no_retry', stage=stage,
             reason=str(exc), stageSeconds=times, wallSeconds=time.time()-started,
             originalDagPromoted=False, generationCalls=0, humanVisualAcceptance=False))
        raise
    result.update(stageSeconds=times, wallSeconds=time.time()-started,
                  originalDagPromoted=False, generationCalls=0,
                  humanVisualAcceptance=False)
    save(output/'result.json', result)
    return result
