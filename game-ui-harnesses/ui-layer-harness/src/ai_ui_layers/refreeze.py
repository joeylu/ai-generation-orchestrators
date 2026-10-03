"""Offline fresh snapshot from immutable, completed planning evidence."""
from pathlib import Path

from .evaluate import read, digest
from .visual_textures import planning_input
from .freeze_visual import freeze
from .planning_dag import locked


def freeze_reviewed(source, output, max_calls, generation_mode=None, generation_reference=None,
                    context_prompt_version=None):
    source=Path(source).resolve();output=Path(output).resolve()
    host_exchange=read(source/'.dag/config.json').get('planningDriver')=='host-model-exchange-v1'
    if not host_exchange and planning_input(source) is not None:raise ValueError('VISUAL_TEXTURE_REFREEZE_UNSUPPORTED')
    if not 1 <= max_calls <= 128:raise ValueError('CALL_LIMIT')
    if output.exists() or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('FRESH_SEPARATE_OUTPUT_REQUIRED')
    with locked(source):
        config=read(source/'.dag/config.json')
        original_mode=config.get('generationMode','single')
        original_reference=config.get('generationReference','full')
        from .context_references import validate_mode
        effective_reference=validate_mode(generation_reference or original_reference)
        if generation_mode is not None and generation_mode not in ('single','sheets'):
            raise ValueError('GENERATION_MODE')
        effective_mode=generation_mode or original_mode
        if digest(source/'.dag/config.json')!=read(source/'.dag/config-digest.json')['sha256']:
            raise ValueError('CONFIG_CHANGED')
        for name,expected in config['inputs'].items():
            if digest(source/'.dag/inputs'/name)!=expected:raise ValueError('INPUT_CHANGED')
        if host_exchange:
            from .host_review import verify_run
            verify_run(source)
        required=[] if host_exchange else ['m1','check','m2']
        if (source/'repair').exists():required+=['repair','repair_check','rereview']
        for node in required:
            if not (source/'.dag'/node/'done.json').is_file():
                raise ValueError('REVIEWED_PLANNING_REQUIRED:'+node)
        for done in (source/'.dag').glob('*/done.json'):
            for name,expected in read(done)['outputs'].items():
                target=(source/name).resolve()
                if not target.is_relative_to(source):raise ValueError('EVIDENCE_PATH_ESCAPE')
                if digest(target)!=expected:raise ValueError('COMPLETED_OUTPUT_CHANGED:'+name)
        if context_prompt_version is None:
            if 'contextPromptVersion' in config:
                context_prompt_version=config['contextPromptVersion']
            elif (source/'frozen/snapshot.json').is_file():
                from .freeze_visual import inspect
                parent=inspect(source/'frozen')
                context_prompt_version=(parent.get('contextPromptVersion','v1') if
                                        parent.get('generationReference')=='context-crops' else 'v3')
            else:
                context_prompt_version='v3'
        if context_prompt_version not in ('v1','v2','v3','v4','v5','v6','v7'):
            raise ValueError('CONTEXT_PROMPT_VERSION')
        # This is a new offline artifact, not resume under a changed runtime.
        # freeze verifies model receipts, candidate/patch lineage and empty review.
        snapshot=freeze(source,output,max_calls,effective_mode,effective_reference,
                        context_prompt_version)
    return {**{k:snapshot[k] for k in ('status','digest','materialCount','plannedCalls','maximumCalls','elapsedSeconds')},
            'modelCalls':0,'generationCalls':0,'originalDagPromoted':False,
            'sourceGenerationMode':original_mode,'generationMode':effective_mode,
            'sourceGenerationReference':original_reference,'generationReference':effective_reference}
