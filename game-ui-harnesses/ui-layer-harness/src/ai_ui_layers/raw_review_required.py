"""Deterministically finish a complete raw job as a review-required package.

This does not change a failed strict DAG or perform visual acceptance.
"""
from pathlib import Path
import time

from PIL import Image

from . import experimental_executor as exchange
from .adapt_strip import adapt_materials
from .discover_variants import discover_jobs
from .evaluate import digest, read, save
from .extract_sheets import cells
from .freeze_visual import inspect
from .preview_partial import preview
from .received_bundle import inspect_sources
from .review_required_variants import build
from .sheet_pixels import prepare


def finish(job, expected_digest, output, viewer, known_differences=()):
    """Package verified raw requests while keeping visual review pending."""
    job, output, viewer = map(lambda value: Path(value).resolve(), (job, output, viewer))
    if output == job or output.is_relative_to(job):
        raise ValueError('SEPARATE_OUTPUT_REQUIRED')
    sources_dir = output.with_name(output.name + '-sources')
    preview_dir = output.with_name(output.name + '-preview')
    selection = output.with_name(output.name + '-selection.json')
    if any(path.exists() for path in (output, sources_dir, preview_dir, selection)):
        raise FileExistsError('OUTPUT_EXISTS')
    for name in ('viewer.html', 'viewer.js'):
        if not (viewer/name).is_file():
            raise ValueError('VIEWER_REQUIRED:' + name)
    started = time.monotonic()
    with exchange.lock(job):
        current = exchange.status(job)
        if current['jobDigest'] != expected_digest:
            raise ValueError('JOB_DIGEST_MISMATCH')
        if current['status'] != 'raw_complete':
            raise ValueError('RAW_INCOMPLETE')
        snapshot = job/'snapshot'
        frozen = inspect(snapshot)
        requests = read(snapshot/'requests.json')['requests']
        if set(current['requests']) != {row['asset'] for row in requests}:
            raise ValueError('COMPLETE_JOB_REQUIRED')
        verified = inspect_sources(snapshot, frozen['digest'],
                                   {key: str(job) for key in current['requests']},
                                   require_all=True)
        placements = read(snapshot/'placements.json')['materials']
        material_ids = [row['id'] for row in placements]
        if len(material_ids) != len(set(material_ids)):
            raise ValueError('FROZEN_LAYER_ORDER')
        sources_dir.mkdir(parents=True, exist_ok=False)
        save(sources_dir/'verified-receipts.json', verified)
        raw_hashes = {record['asset']: record['rawSha256'] for record in verified['records']}
        sources = {}
        for row in requests:
            key = row['asset']
            raw = job/'attempts'/key/'raw.png'
            if row.get('kind') != 'sheet':
                if key in sources:
                    raise ValueError('DUPLICATE_MATERIAL')
                sources[key] = str(raw)
                continue
            prepared = sources_dir/(key + '-prepared.png')
            prepare(raw, prepared)
            with Image.open(prepared) as image:
                boxes = cells(image, row, actual_gaps=True)
                for mid, box in zip(row['materialIds'], boxes):
                    if mid in sources:
                        raise ValueError('DUPLICATE_MATERIAL')
                    target = sources_dir/(mid + '.png')
                    image.crop(tuple(box)).save(target)
                    sources[mid] = str(target)
        if set(sources) != set(material_ids):
            raise ValueError('COMPLETE_MATERIAL_SET_REQUIRED')
        sources = adapt_materials(snapshot, sources, sources_dir/'adaptation')
        config = sources_dir/'preview-input.json'
        save(config, dict(snapshot=str(snapshot), snapshotDigest=frozen['digest'], materials=sources))
        report = preview(config, preview_dir)
        if any(row['report']['status'] != 'processed_pending_visual_review' for row in report['records']):
            raise ValueError('MATERIAL_GATE_FAILED')
        if any(digest(job/'attempts'/key/'raw.png') != sha for key, sha in raw_hashes.items()):
            raise ValueError('RAW_RECEIPT_CHANGED')
        issues = list(known_differences) + [
            '此包的生成素材尚未通过完整视觉审查；供用户检查，不代表原严格 DAG 成功。'
        ]
        discovery = discover_jobs(snapshot, preview_dir, [job], selection, issues)
        result = build(selection, output, viewer)
        save(output/'discovery.json', discovery)
        result.update(status='review_required', automaticVariantDiscovery=True,
                      originalDagPromoted=False, humanVisualAcceptance=False,
                      generationCalls=0, modelCalls=0,
                      wallSeconds=round(time.monotonic() - started, 3))
        save(output/'raw-review-required-result.json', result)
        return result
