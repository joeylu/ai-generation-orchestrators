"""Revise a verified candidate package using receipt-replayed support layers."""
from copy import deepcopy
from pathlib import Path
import shutil
import tempfile
import zipfile

import numpy as np
from PIL import Image

from .accepted_materials import replay
from .body_registration import POLICY_SUPPORT
from .evaluate import digest, read, save
from .experimental_executor import verified
from .freeze_visual import inspect
from .layer_package import (composite, portable_text, support_canvas_region,
                            validate_archive, write_package)


KIND = 'ui_package_layer_revision_v1'


def _png(path, layer):
    with Image.open(path) as opened:
        if opened.format != 'PNG' or opened.mode != 'RGBA' or opened.size != (layer['width'], layer['height']):
            raise ValueError('REVISION_PNG_GEOMETRY')
        image = opened.copy()
    pixels = np.asarray(image)
    alpha = pixels[:, :, 3]
    if np.any((alpha == 0) & np.any(pixels[:, :, :3] != 0, axis=2)):
        raise ValueError('REVISION_HIDDEN_RGB')
    if not np.any(alpha):
        raise ValueError('REVISION_EMPTY_LAYER')
    if layer['role'] == 'background':
        if not np.all(alpha == 255):
            raise ValueError('REVISION_BACKGROUND_ALPHA')
    elif not np.any(alpha == 0):
        raise ValueError('REVISION_FOREGROUND_ALPHA')
    return image


def _bind_tree(folder, bound, inventories):
    folder = Path(folder).resolve()
    files = {str(path.resolve()) for path in folder.rglob('*') if path.is_file()}
    inventories[str(folder)] = files
    for name in files:
        path = Path(name)
        if path.is_file():
            bound[str(path.resolve())] = digest(path)


def _unchanged(bound, inventories):
    if any(digest(Path(path)) != expected for path, expected in bound.items()):
        raise ValueError('REVISION_INPUT_CHANGED')
    for folder, expected in inventories.items():
        actual = {str(path.resolve()) for path in Path(folder).rglob('*') if path.is_file()}
        if actual != expected:
            raise ValueError('REVISION_INPUT_INVENTORY_CHANGED')


def revise(selection_path, output, viewer):
    selection_path, output, viewer = map(lambda p: Path(p).resolve(), (selection_path, output, viewer))
    if output.exists():
        raise FileExistsError('OUTPUT_EXISTS')
    spec = read(selection_path)
    required = {'kind', 'sourceArchive', 'sourceArchiveSha256', 'replacements', 'knownDifferences'}
    if spec.get('kind') != KIND or not required <= set(spec) or not set(spec) <= required | {'evidence'}:
        raise ValueError('REVISION_SELECTION_KIND')
    archive = Path(spec['sourceArchive']).resolve()
    if digest(archive) != spec['sourceArchiveSha256']:
        raise ValueError('REVISION_SOURCE_ARCHIVE_CHANGED')
    replacements = spec['replacements']
    if not isinstance(replacements, list) or not 1 <= len(replacements) <= 128:
        raise ValueError('REVISION_REPLACEMENTS_REQUIRED')
    entry_fields = {'materialId', 'snapshot', 'snapshotDigest', 'preview', 'previewReportSha256',
                    'job', 'requestId', 'sourceMaterialId'}
    if any(not isinstance(entry, dict) or not entry_fields <= set(entry)
           or not set(entry) <= entry_fields | {'adaptationPolicy'} for entry in replacements):
        raise ValueError('REVISION_REPLACEMENT_FIELDS')
    ids = [entry['materialId'] for entry in replacements]
    if len(ids) != len(set(ids)):
        raise ValueError('REVISION_DUPLICATE_MATERIAL')
    if not isinstance(spec.get('knownDifferences'), list):
        raise ValueError('REVISION_ISSUES_REQUIRED')
    for issue in spec['knownDifferences']:
        portable_text(issue)
    readonly_roots = {archive.parent}
    readonly_files = {selection_path, archive}
    (readonly_roots if viewer.is_dir() else readonly_files).add(viewer)
    for entry in replacements:
        readonly_roots.update(Path(entry[key]).resolve() for key in ('snapshot', 'job', 'preview'))
        report = read(Path(entry['preview']) / 'report.json')
        for row in report.get('records', []):
            if row.get('id') == entry['materialId']:
                readonly_files.add(Path(row['source']).resolve())
                observation = row.get('report', {}).get('bodyContract', {}).get('evidence', {}).get('path')
                if observation:
                    readonly_files.add(Path(observation).resolve())
    bound = {str(selection_path): digest(selection_path), str(archive): digest(archive)}
    inventories = {}
    if viewer.is_dir():
        _bind_tree(viewer, bound, inventories)
    else:
        bound[str(viewer)] = digest(viewer)
    for evidence in spec.get('evidence', []):
        if not isinstance(evidence, dict) or set(evidence) != {'path', 'sha256'}:
            raise ValueError('REVISION_EVIDENCE_FIELDS')
        path = Path(evidence['path']).resolve()
        if digest(path) != evidence['sha256']:
            raise ValueError('REVISION_EVIDENCE_CHANGED')
        bound[str(path)] = evidence['sha256']
        readonly_files.add(path)
    if any(output.is_relative_to(path) or path.is_relative_to(output)
           for path in readonly_roots | readonly_files):
        raise ValueError('REVISION_OUTPUT_INPUT_OVERLAP')
    output.mkdir(parents=True, exist_ok=False)
    try:
        validate_archive(archive)
        with tempfile.TemporaryDirectory(prefix='ui-layer-revision-') as temp:
            temp = Path(temp)
            original = temp / 'source-package'
            original.mkdir()
            with zipfile.ZipFile(archive) as zipped:
                # validate_archive restricts the complete inventory to portable files.
                for name in zipped.namelist():
                    path = original / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(zipped.read(name))
            composition = read(original / 'composition.json')
            previous_review = read(original / 'review.json')
            issues = previous_review['issues']
            if not isinstance(issues, list) or len(issues) > 128:
                raise ValueError('REVISION_SOURCE_ISSUES')
            for issue in issues:
                portable_text(issue)
            previous_layers = {layer['id']: layer for layer in composition['layers']}
            if not set(ids) <= set(previous_layers):
                raise ValueError('REVISION_UNKNOWN_MATERIAL')
            for layer in composition['layers']:
                _png(original / layer['path'], layer)
            before = composite(original, composition)
            with Image.open(original / 'preview.png') as image:
                if image.mode != 'RGBA' or image.size != before.size or image.tobytes() != before.tobytes():
                    raise ValueError('REVISION_SOURCE_PREVIEW_MISMATCH')
            reference = original / 'reference.png'
            reference_sha = digest(reference)
            with Image.open(reference) as image:
                if image.size != before.size:
                    raise ValueError('REVISION_REFERENCE_GEOMETRY')
            revised = deepcopy(composition)
            layers = {layer['id']: layer for layer in revised['layers']}
            sources = {key: dict(path=str(original / layer['path']), sha256=digest(original / layer['path']))
                       for key, layer in previous_layers.items()}
            lineage = []
            allowed = np.zeros((before.height, before.width), dtype=bool)
            expected_ids = [layer['id'] for layer in composition['layers']]
            for index, entry in enumerate(replacements):
                mid = entry['materialId']
                if layers[mid]['role'] != 'foreground' or entry.get('adaptationPolicy', 'preserve') != 'preserve':
                    raise ValueError('REVISION_FOREGROUND_SUPPORT_ONLY')
                snapshot = Path(entry['snapshot']).resolve()
                _bind_tree(snapshot, bound, inventories)
                frozen = inspect(snapshot, entry['snapshotDigest'])
                if digest(snapshot / 'reference.png') != reference_sha:
                    raise ValueError('REVISION_REFERENCE_MISMATCH')
                placements = sorted(read(snapshot / 'placements.json')['materials'], key=lambda row: row['drawIndex'])
                if [row['id'] for row in placements] != expected_ids:
                    raise ValueError('REVISION_FROZEN_LAYER_ORDER_MISMATCH')
                placement = next(row for row in placements if row['id'] == mid)
                visual_path = snapshot / 'evidence/revised-visual-plan.json'
                visual = read(visual_path if visual_path.exists() else snapshot / 'evidence/m1-draft.json')
                material = next(row for row in visual['materials'] if row['id'] == mid)
                if (material['role'] != layers[mid]['role'] or visual['textPolicy'] != composition['textPolicy']
                        or visual['backgroundMode'] != composition['backgroundMode']):
                    raise ValueError('REVISION_MATERIAL_POLICY_MISMATCH')
                preview = Path(entry['preview']).resolve()
                _bind_tree(preview, bound, inventories)
                report_path = preview / 'report.json'
                if digest(report_path) != entry['previewReportSha256']:
                    raise ValueError('REVISION_PREVIEW_REPORT_CHANGED')
                report = read(report_path)
                rows = [row for row in report['records'] if row['id'] == mid]
                if (report.get('snapshotDigest') != frozen['digest'] or report.get('registrationPolicy') != POLICY_SUPPORT
                        or len(rows) != 1 or rows[0]['xy'] != placement['xy']):
                    raise ValueError('REVISION_SUPPORT_PREVIEW_SCOPE')
                row = rows[0]
                material_path = preview / mid / 'material.png'
                if (read(preview / mid / 'report.json') != row['report']
                        or row['report']['status'] != 'processed_pending_visual_review'
                        or digest(material_path) != row['report']['materialSha256']
                        or digest(Path(row['source'])) != row['sourceSha256']):
                    raise ValueError('REVISION_SUPPORT_MATERIAL_CHANGED')
                job = Path(entry['job']).resolve()
                _bind_tree(job, bound, inventories)
                job_config = verified(job / 'job.json')
                authorization = verified(job / 'authorization.json')
                submission = verified(job / 'attempts' / entry['requestId'] / 'submission.json')
                if (job_config.get('snapshotDigest') != frozen['digest'] or entry['sourceMaterialId'] != mid
                        or authorization.get('jobDigest') != job_config['digest']
                        or submission['authorizationDigest'] != authorization['digest']):
                    raise ValueError('REVISION_SOURCE_AUTHORIZATION_MISMATCH')
                observation = Path(row['report']['bodyContract']['evidence']['path']).resolve()
                bound[str(observation)] = digest(observation)
                replayed, proof = replay(entry, row, placement, 'foreground', reference_sha, temp / ('replay-' + str(index)))
                region = support_canvas_region(row['report'], placement, frozen['digest'], mid, reference_sha, before.size)
                old = previous_layers[mid]
                allowed[old['y']:old['y'] + old['height'], old['x']:old['x'] + old['width']] = True
                allowed[region[1]:region[3], region[0]:region[2]] = True
                layers[mid].update(x=region[0], y=region[1], width=region[2] - region[0], height=region[3] - region[1])
                _png(replayed, layers[mid])
                sources[mid] = dict(path=str(replayed), sha256=digest(replayed))
                lineage.append(dict(materialId=mid, targetSnapshotDigest=frozen['digest'], **proof))
            after = Image.new('RGBA', before.size)
            for layer in revised['layers']:
                with Image.open(sources[layer['id']]['path']) as image:
                    after.alpha_composite(image, (layer['x'], layer['y']))
            if np.any(np.asarray(before)[~allowed] != np.asarray(after)[~allowed]):
                raise ValueError('REVISION_UNRELATED_PIXELS_CHANGED')
            _unchanged(bound, inventories)
            review_issues = list(issues) + list(spec['knownDifferences']) + [
                '已有候选包的离线图层修订；未替换层沿用包内原始字节和坐标，其完整生成来源未重新回放。',
                '替换前景通过真实回执及主体支持画布重放；不提升任何旧自动任务或推定整图视觉验收。']
            if len(review_issues) > 128:
                raise ValueError('REVISION_ISSUES_LIMIT')
            package = write_package(reference, revised, sources, output / 'delivery', viewer, review_issues)
            saved_package = output / 'delivery/package'
            for key, old in previous_layers.items():
                if key not in ids and (layers[key] != old or (saved_package / old['path']).read_bytes() != (original / old['path']).read_bytes()):
                    raise ValueError('REVISION_UNREPLACED_LAYER_CHANGED')
            if (saved_package / 'reference.png').read_bytes() != reference.read_bytes():
                raise ValueError('REVISION_REFERENCE_CHANGED')
            if composite(saved_package, revised).tobytes() != after.tobytes():
                raise ValueError('REVISION_OUTPUT_PREVIEW_MISMATCH')
            _unchanged(bound, inventories)
            provenance = dict(kind='ui_package_derived_revision_result_v1', sourceArchiveSha256=spec['sourceArchiveSha256'],
                selectionSha256=digest(selection_path), verifiedInputs=bound, replacements=lineage,
                retainedPackageLayerIds=[key for key in expected_ids if key not in ids],
                retainedLayerProviderLineage='not verified by this operation; inherited candidate limitations remain',
                inheritedIssues=issues, unchangedOutsideReplacementCanvasUnion=True,
                sourceReceiptReplayPassed=False, replacementReceiptReplayPassed=True,
                originalDagPromoted=False, fullAutomaticDagPassed=False, humanVisualAcceptance=False,
                generationCalls=0, modelCalls=0, packageSha256=package['sha256'])
            save(output / 'revision-provenance.json', provenance)
            result = dict(package, status='candidate_revision_pending_visual_review', layerCount=len(expected_ids),
                replacements=len(ids), sourceReceiptReplayPassed=False, replacementReceiptReplayPassed=True,
                keptLayerBytesExact=True, unchangedOutsideReplacementCanvasUnion=True,
                originalDagPromoted=False, fullAutomaticDagPassed=False, modelCalls=0,
                provenanceSha256=digest(output / 'revision-provenance.json'))
            save(output / 'result.json', result)
            return result
    except Exception as error:
        delivery = output / 'delivery'
        if delivery.exists():
            if not delivery.resolve().is_relative_to(output):
                raise ValueError('REVISION_OUTPUT_PATH_CHANGED') from error
            shutil.rmtree(delivery)
        save(output / 'result.json', dict(status='candidate_revision_blocked_no_retry', reason=str(error),
             originalDagPromoted=False, sourceReceiptReplayPassed=False, humanVisualAcceptance=False,
             generationCalls=0, modelCalls=0))
        raise
