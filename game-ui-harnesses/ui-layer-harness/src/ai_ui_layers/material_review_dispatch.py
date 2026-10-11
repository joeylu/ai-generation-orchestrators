"""One ready-to-dispatch visual input; no model calls or response rewriting."""
from pathlib import Path

from .evaluate import read, save, digest


POLICY = 'inline-material-review-packet-v1'
LEGACY = 'separate-material-review-files-v1'
NAME = 'dispatch.json'
MAX_CONCURRENT = 4


def configure(config, *, fast=False):
    config.setdefault('maximumConcurrentMaterialReviews', 3 if fast else 1)
    limit = config['maximumConcurrentMaterialReviews']
    if type(limit) is not int or not 1 <= limit <= MAX_CONCURRENT:
        raise ValueError('FINITE_MATERIAL_REVIEW_CONCURRENCY_REQUIRED')
    config.setdefault('materialReviewDispatchPolicy', POLICY)
    if config['materialReviewDispatchPolicy'] not in (POLICY, LEGACY):
        raise ValueError('MATERIAL_REVIEW_DISPATCH_POLICY_UNSUPPORTED')
    validate_policy(config['materialReviewDispatchPolicy'])


def validate_policy(policy):
    if policy not in (None, POLICY, LEGACY):
        raise ValueError('MATERIAL_REVIEW_DISPATCH_POLICY_UNSUPPORTED')


def packet(folder, request_id, material_ids, inputs):
    """Inline the exact frozen instructions/schema; never summarize visual rules."""
    folder = Path(folder)
    names = ['reference.png', 'generated.png', 'detail-compare.png']
    names += sorted(name for name in inputs if name.endswith('.png') and name not in names)
    if any(name not in inputs for name in names):
        raise ValueError('MATERIAL_REVIEW_IMAGES_REQUIRED')
    # Producer input names are local attachments, not arbitrary paths.
    if any(Path(name).name != name or '\\' in name or ':' in name for name in inputs):
        raise ValueError('MATERIAL_REVIEW_PACKET_PATH_INVALID')
    for name, sha in inputs.items():
        if name != NAME and digest(folder/name) != sha:
            raise ValueError('MATERIAL_REVIEW_PACKET_INPUT_CHANGED')
    return dict(kind='ui_material_review_dispatch_v1', requestId=request_id,
        assignedMaterialIds=material_ids,
        hostInstruction=('Supply this packet and every listed image to one independent visual call. '
            'Return the original JSON answer only, using responseSchema. Each observation needs '
            'concise concrete visual evidence; do not add a prose report or repeat the catalog. '
            'All visual rules and object coverage remain mandatory. Do not discover runtimes, '
            'read repository files, run shell commands or validate JSON locally. The receiving '
            'program owns schema, identity, checksum and provenance validation. Do not repair '
            'an invalid answer or retry a dispatched call.'),
        prompt=(folder/'prompt.md').read_text(encoding='utf-8'),
        responseSchema=read(folder/'schema.json'),
        images=[dict(imageNumber=index+1, file=name, sha256=inputs[name])
                for index, name in enumerate(names)],
        imageMetadata={name:read(folder/name) for name in
            ('observation-mapping.json', 'detail-compare.json', 'sheet-partition.json') if name in inputs},
        sourceInputs={name:sha for name,sha in inputs.items() if name != NAME},
        maximumCalls=1, automaticRetries=0, visualAcceptanceAsserted=False)


def prepare(folder, request_id, material_ids, inputs):
    path = Path(folder)/NAME
    save(path, packet(folder, request_id, material_ids, inputs))
    return digest(path)


def verify(folder, request_id, material_ids, inputs):
    if NAME not in inputs or digest(Path(folder)/NAME) != inputs[NAME]:
        raise ValueError('MATERIAL_REVIEW_PACKET_CHANGED')
    if read(Path(folder)/NAME) != packet(folder, request_id, material_ids, inputs):
        raise ValueError('MATERIAL_REVIEW_PACKET_BINDING_CHANGED')


def availability(scope, rows, received, reserved):
    """Missing fields preserve historical serial reservations."""
    limit = scope.get('maximumConcurrentCalls', 1)
    if type(limit) is not int or not 1 <= limit <= MAX_CONCURRENT:
        raise ValueError('FINITE_MATERIAL_REVIEW_CONCURRENCY_REQUIRED')
    pending = [row for row in rows if row.get('requestId', 'planning') not in received]
    outstanding = [row for row in pending if row.get('requestId', 'planning') in reserved]
    ready = [row for row in pending if row.get('requestId', 'planning') not in reserved]
    return pending, outstanding, ready, max(0, limit-len(outstanding))
