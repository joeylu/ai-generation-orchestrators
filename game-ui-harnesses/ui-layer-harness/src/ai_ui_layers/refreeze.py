"""Offline fresh snapshot from immutable, completed planning evidence."""
from pathlib import Path

from .evaluate import read, digest
from .freeze_visual import freeze
from .planning_dag import locked


def freeze_reviewed(source, output, max_calls, generation_mode=None):
    source=Path(source).resolve();output=Path(output).resolve()
    if not 1 <= max_calls <= 128:raise ValueError('CALL_LIMIT')
    if output.exists() or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('FRESH_SEPARATE_OUTPUT_REQUIRED')
    with locked(source):
        config=read(source/'.dag/config.json')
        original_mode=config.get('generationMode','single')
        if generation_mode is not None and generation_mode not in ('single','sheets'):
            raise ValueError('GENERATION_MODE')
        effective_mode=generation_mode or original_mode
        if digest(source/'.dag/config.json')!=read(source/'.dag/config-digest.json')['sha256']:
            raise ValueError('CONFIG_CHANGED')
        for name,expected in config['inputs'].items():
            if digest(source/'.dag/inputs'/name)!=expected:raise ValueError('INPUT_CHANGED')
        required=['m1','check','m2']
        if (source/'repair').exists():required+=['repair','repair_check','rereview']
        for node in required:
            if not (source/'.dag'/node/'done.json').is_file():
                raise ValueError('REVIEWED_PLANNING_REQUIRED:'+node)
        for done in (source/'.dag').glob('*/done.json'):
            for name,expected in read(done)['outputs'].items():
                target=(source/name).resolve()
                if not target.is_relative_to(source):raise ValueError('EVIDENCE_PATH_ESCAPE')
                if digest(target)!=expected:raise ValueError('COMPLETED_OUTPUT_CHANGED:'+name)
        # This is a new offline artifact, not resume under a changed runtime.
        # freeze verifies model receipts, candidate/patch lineage and empty review.
        snapshot=freeze(source,output,max_calls,effective_mode)
    return {**{k:snapshot[k] for k in ('status','digest','materialCount','plannedCalls','maximumCalls','elapsedSeconds')},
            'modelCalls':0,'generationCalls':0,'originalDagPromoted':False,
            'sourceGenerationMode':original_mode,'generationMode':effective_mode}
