"""Read-only structural comparison against a hash-bound delivery baseline."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tempfile
import zipfile

from PIL import Image, ImageDraw

from .evaluate import save
from .viewport_geometry_revision import validate_viewport_archive


def _bound(archive, expected):
    if not isinstance(expected, str) or re.fullmatch(r'[0-9a-f]{64}', expected) is None:
        raise ValueError('BASELINE_ARCHIVE_DIGEST_REQUIRED')
    raw = Path(archive).read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError('BASELINE_ARCHIVE_IDENTITY_CHANGED')
    # Validate the exact bytes already bound, not a subsequently reopened input.
    with tempfile.TemporaryDirectory(prefix='ui-baseline-audit-') as temporary:
        copy = Path(temporary) / 'bound.zip'
        copy.write_bytes(raw)
        validate_viewport_archive(copy)
    with zipfile.ZipFile(io.BytesIO(raw)) as wrapper:
        viewport = json.loads(wrapper.read('viewport.json'))
        reference = wrapper.read('original-reference.png')
        preview = wrapper.read('viewport-preview.png')
        with zipfile.ZipFile(io.BytesIO(wrapper.read('world-ui-layers.zip'))) as inner:
            composition = json.loads(inner.read('composition.json'))
            pixels = {layer['id']: hashlib.sha256(inner.read(layer['path'])).hexdigest()
                      for layer in composition['layers']}
    if len(pixels) != len(composition['layers']):
        raise ValueError('BASELINE_DUPLICATE_LAYER_ID')
    return dict(archiveSha256=expected, viewport=viewport, composition=composition,
                layerSha256=pixels, reference=reference, preview=preview)


def _region(layer, shift):
    return [layer['x'] - shift[0], layer['y'] - shift[1], layer['width'], layer['height']]


def compare(baseline, baseline_sha, candidate, candidate_sha, output):
    """Report differences; never accept a candidate or mutate either package."""
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('FRESH_BASELINE_AUDIT_OUTPUT_REQUIRED')
    old = _bound(baseline, baseline_sha)
    new = _bound(candidate, candidate_sha)
    for key in ('originalReferenceSha256', 'originalSize'):
        if old['viewport'][key] != new['viewport'][key]:
            raise ValueError('BASELINE_REFERENCE_IDENTITY_MISMATCH')
    old_layers = {layer['id']: layer for layer in old['composition']['layers']}
    new_layers = {layer['id']: layer for layer in new['composition']['layers']}
    common = set(old_layers) & set(new_layers)
    old_order = [mid for mid in old_layers if mid in common]
    new_order = [mid for mid in new_layers if mid in common]
    fields = []
    geometry = []
    for mid in old_order:
        a, b = old_layers[mid], new_layers[mid]
        changed = {key: dict(baseline=a[key], candidate=b[key])
                   for key in ('role', 'visible') if a[key] != b[key]}
        if changed:
            fields.append(dict(materialId=mid, changedFields=changed))
        old_box = _region(a, old['viewport']['worldShift'])
        new_box = _region(b, new['viewport']['worldShift'])
        if old_box != new_box:
            geometry.append(dict(materialId=mid, baselineRegion=old_box, candidateRegion=new_box,
                                 delta=[b - a for a, b in zip(old_box, new_box)],
                                 basis='stored-layer-support-in-original-coordinates',
                                 semanticBodyObserved=False))
    missing = [mid for mid in old_layers if mid not in new_layers]
    added = [mid for mid in new_layers if mid not in old_layers]
    structural = bool(missing or added or fields or old_order != new_order)
    result = dict(kind='ui_package_baseline_audit_v1',
        status='baseline-structure-differences' if structural else 'baseline-structure-preserved-pending-visual-review',
        baselineArchiveSha256=baseline_sha, candidateArchiveSha256=candidate_sha,
        originalReferenceSha256=old['viewport']['originalReferenceSha256'],
        originalSize=old['viewport']['originalSize'],
        baselineLayerCount=len(old_layers), candidateLayerCount=len(new_layers),
        missingBaselineLayerIds=missing, addedCandidateLayerIds=added,
        changedFields=fields, commonLayerOrderChanged=old_order != new_order,
        textPolicyChanged=old['composition']['textPolicy'] != new['composition']['textPolicy'],
        geometryDifferences=geometry,
        changedLayerArtifactIds=[mid for mid in old_order if old['layerSha256'][mid] != new['layerSha256'][mid]],
        geometryIsStorageSupportOnly=True, geometricToleranceApplied=False,
        baselineHumanAcceptanceClaimed=False, candidateHumanAcceptance=False,
        candidatePromotionAuthorized=False, fullAutomaticDagPassed=False,
        originalDagPromoted=False, generationCalls=0, modelCalls=0)
    # Views are derived comparisons. Authoritative input PNGs and archives stay intact.
    width, height = result['originalSize']
    comparison = Image.new('RGB', (width * 3, height + 32), 'white')
    draw = ImageDraw.Draw(comparison)
    for index, (label, raw) in enumerate((('Reference', old['reference']),
                                        ('Selected baseline', old['preview']),
                                        ('Candidate - pending review', new['preview']))):
        with Image.open(io.BytesIO(raw)) as image:
            rgba = image.convert('RGBA')
            comparison.paste(rgba.convert('RGB'), (index * width, 32), rgba.getchannel('A'))
        draw.text((index * width + 8, 8), label, fill='black')
    output.mkdir(parents=True)
    comparison.save(output / 'baseline-comparison.png')
    save(output / 'report.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['compare-package-baseline'])
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--baseline-sha', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--candidate-sha', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = compare(args.baseline, args.baseline_sha, args.candidate, args.candidate_sha, args.output)
    print(json.dumps(result, ensure_ascii=False))
