"""Explicit postprocessing of a complete received job, without promoting its parent DAG."""
from pathlib import Path
import time
from . import experimental_executor as exchange
from .evaluate import save, digest
from .freeze_visual import inspect
from .received_bundle import inspect_sources
from .extract_sheets import extract
from .adapt_strip import adapt_materials
from .automatic_registration import run as register
from .layer_package import build, sources_from_preview


def finish(job, expected_digest, output, viewer):
    job, output, viewer = map(lambda p: Path(p).resolve(), (job, output, viewer))
    if output == job or output.is_relative_to(job):
        raise ValueError('SEPARATE_OUTPUT_REQUIRED')
    with exchange.lock(job):
        current = exchange.status(job)
        if current['jobDigest'] != expected_digest:
            raise ValueError('JOB_DIGEST_MISMATCH')
        if current['status'] != 'raw_complete':
            raise ValueError('RAW_INCOMPLETE')
        snapshot = job/'snapshot'
        sha = inspect(snapshot)['digest']
        verified = inspect_sources(snapshot, sha, {k: str(job) for k in current['requests']}, require_all=True)
        viewer_bytes = {n: (viewer/n).read_bytes() for n in ('viewer.html', 'viewer.js')}
        receipts = {p.relative_to(job).as_posix(): digest(p) for p in job.rglob('*')
                    if p.is_file() and p.name != 'exchange.lock'}
        output.mkdir(parents=True, exist_ok=False)
        inputs = output/'inputs'; inputs.mkdir()
        for name, data in viewer_bytes.items():
            (inputs/name).write_bytes(data)
        save(output/'verified-receipts.json', verified)
        from .delivery_dag import runtime_files
        save(output/'execution.json', dict(jobDigest=expected_digest, snapshotDigest=sha,
             runtime=runtime_files(), inputs={n: digest(inputs/n) for n in viewer_bytes},
             originalDagPromoted=False, generationCalls=0))
        started = time.time(); stage = 'extract'; times = {}; t = started
        try:
            sources = {k: str(job/'attempts'/k/'raw.png') for k in current['requests']}
            result = extract(snapshot, sha, sources, output/'extraction')
            times[stage] = time.time()-t
            stage = 'adapt'; t = time.time()
            sources = adapt_materials(snapshot, result['materials'], output/'adaptation', result.get('adaptations', {}))
            times[stage] = time.time()-t
            config = output/'registration-input.json'
            save(config, dict(snapshot=str(snapshot), snapshotDigest=sha, materials=sources))
            stage = 'registration'; t = time.time()
            register(config, output/'registration')
            times[stage] = time.time()-t
            stage = 'package'; t = time.time()
            if any(digest(job/n) != h for n,h in receipts.items()):
                raise ValueError('RAW_RECEIPT_CHANGED')
            package = build(snapshot, sources_from_preview(snapshot, output/'registration/preview', result.get('warnings',[])), output/'delivery', inputs)
            times[stage] = time.time()-t
            result = dict(status='delivered_pending_visual_review', package=package, warnings=result.get('warnings',[]))
        except Exception as exc:
            times[stage] = time.time()-t
            save(output/'result.json', dict(status='blocked_no_retry', stage=stage, reason=str(exc),
                 stageSeconds=times, wallSeconds=time.time()-started, originalDagPromoted=False,
                 generationCalls=0, humanVisualAcceptance=False))
            raise
        result.update(stageSeconds=times, wallSeconds=time.time()-started, originalDagPromoted=False,
                      generationCalls=0, humanVisualAcceptance=False)
        save(output/'result.json', result)
        return result
