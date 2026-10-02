"""Explicit, receipt-bound set normalization for new planning jobs only."""
import copy
from pathlib import Path
from jsonschema import Draft202012Validator
from .evaluate import digest, read, save

POLICY = 'preserve-text-set-v1'
PLAN_NAME = 'normalized-plan.json'
REPORT_NAME = 'normalization-report.json'


def validate_policy(policy):
    if policy not in (None, POLICY):
        raise ValueError('PLANNING_NORMALIZATION_POLICY_UNKNOWN')


def provider_schema(storage_schema, policy=None):
    """Copy strict storage schema; relax only exact license-array uniqueness."""
    validate_policy(policy)
    result = copy.deepcopy(storage_schema)
    if policy is None:
        return result
    properties = result['properties']
    nodes = [properties['materials']['items']['properties']['preserveText']]
    if 'scene' in properties and 'preserveText' in properties['scene'].get('properties', {}):
        nodes.append(properties['scene']['properties']['preserveText'])
    for node in nodes:
        if node.get('type') != 'array' or node.get('uniqueItems') is not True:
            raise ValueError('PLANNING_NORMALIZATION_SCHEMA_UNSUPPORTED')
        node.pop('uniqueItems')
    return result


def normalize(plan, policy):
    """Keep first occurrences of identical strings; leave every other value intact."""
    validate_policy(policy)
    result = copy.deepcopy(plan)
    changes = []
    if policy is None:
        return result, changes
    owners = [(f'/materials/{index}/preserveText', row)
              for index, row in enumerate(result['materials'])]
    if isinstance(result.get('scene'), dict):
        owners.append(('/scene/preserveText', result['scene']))
    for path, owner in owners:
        if 'preserveText' not in owner:
            continue
        values = owner['preserveText']
        if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
            raise ValueError('PLANNING_NORMALIZATION_LICENSE_TYPE')
        seen = set()
        kept, removed = [], []
        for index, value in enumerate(values):
            if value in seen:
                removed.append(index)
            else:
                seen.add(value)
                kept.append(value)
        owner['preserveText'] = kept
        if removed:
            changes.append(dict(path=path, originalCount=len(values),
                                normalizedCount=len(kept), removedIndices=removed))
    return result, changes


def _verified(folder, storage_schema_path, policy):
    validate_policy(policy)
    folder, storage_schema_path = Path(folder), Path(storage_schema_path)
    raw = folder/'draft.json'
    receipt = read(folder/'transport.json')
    if (receipt.get('failure') or receipt.get('exitCode') != 0 or
            receipt.get('turnCompleted') is not True or receipt.get('unexpectedEvents')):
        raise ValueError('MODEL_CALL_FAILED')
    if receipt.get('responseSha256') != digest(raw):
        raise ValueError('MODEL_OUTPUT_CHANGED')
    storage = read(storage_schema_path)
    plan = read(raw)
    Draft202012Validator(provider_schema(storage, policy)).validate(plan)
    normalized, changes = normalize(plan, policy)
    Draft202012Validator(storage).validate(normalized)
    binding = dict(kind='ui_planning_normalization_v1', normalizationPolicy=policy,
                   rawResponseSha256=digest(raw), transportSha256=digest(folder/'transport.json'),
                   storageSchemaSha256=digest(storage_schema_path), changes=changes)
    return normalized, binding


def derive(folder, storage_schema_path, policy):
    """Publish fresh derived artifacts; never replace raw model output or receipts."""
    folder = Path(folder)
    normalized, binding = _verified(folder, storage_schema_path, policy)
    if policy is None:
        return folder/'draft.json'
    destination, report = folder/PLAN_NAME, folder/REPORT_NAME
    if destination.exists() or report.exists():
        raise ValueError('PLANNING_NORMALIZATION_ARTIFACT_EXISTS')
    save(destination, normalized)
    save(report, dict(binding, normalizedPlanSha256=digest(destination)))
    return destination


def verified_plan_path(folder, storage_schema_path, policy=None):
    """Recompute derivation and verify provenance before returning the source path."""
    folder = Path(folder)
    normalized, binding = _verified(folder, storage_schema_path, policy)
    if policy is None:
        return folder/'draft.json'
    destination = folder/PLAN_NAME
    expected = dict(binding, normalizedPlanSha256=digest(destination))
    if read(folder/REPORT_NAME) != expected or read(destination) != normalized:
        raise ValueError('PLANNING_NORMALIZATION_ARTIFACT_CHANGED')
    return destination


def m1_plan_path(root):
    """Resolve the receipt-bound M1 source selected by immutable job configuration."""
    root = Path(root)
    config = root/'.dag/config.json'
    # Archived freeze/compile fixtures predate DAG config and its explicit policy.
    # Their own validators retain responsibility for receipt and schema checks.
    if not config.is_file():
        return root/'m1/draft.json'
    policy = read(config).get('normalizationPolicy')
    if policy is None:
        return root/'m1/draft.json'
    return verified_plan_path(root/'m1', root/'.dag/inputs/storage-schema.json', policy)
