"""Export the packaged tool-host entry; never authorizes or generates media."""
from pathlib import Path
import json
import sys
from .common import read_json, require, sha256, write_json, digest


def export_loop(job, output, output_root, python=None, node='node'):
    from .workflow import inspect_job
    job=Path(job).resolve();output=Path(output).resolve()
    status=inspect_job(job)
    require(status['status']=='ready' and status['nextNode']=='generate','LOOP_EXPORT_NOT_AUTHORIZED_FRESH')
    spec=read_json(job/'job.json');auth=read_json(job/'authorization.json')
    require(spec['options'].get('generationMode')=='file','LOOP_EXPORT_FILE_MODE_REQUIRED')
    require(not (job/'nodes/generate').exists(),'LOOP_EXPORT_ALREADY_STARTED')
    require(auth['jobDigest']==status['jobDigest'],'LOOP_EXPORT_AUTHORIZATION_MISMATCH')
    root=Path(__file__).resolve().parent
    config=dict(job=str(job),jobDigest=status['jobDigest'],maximumCalls=auth['maximumCalls'],
        python=str(python or sys.executable),node=str(node),packageRoot=str(root.parent),
        bridge=str(root/'generation-loop-bridge.mjs'),outputRoot=str(Path(output_root).resolve()),
        journal=str(output.parent/'journal'),transport=str(output.parent/'transport'))
    return write_loop(config, output, auth['planDigest'])


def write_loop(config, output, plan_digest):
    """Shared host-script packaging; callers own product-specific authorization."""
    output=Path(output).resolve()
    handoff_path=output.parent/'execution-handoff.json'
    require(not handoff_path.exists(),'LOOP_EXPORT_OUTPUT_EXISTS')
    root=Path(__file__).resolve().parent
    require(Path(config['outputRoot']).is_dir(), 'LOOP_EXPORT_SOURCE_ROOT_MISSING')
    require(not Path(config['journal']).exists() and not Path(config['transport']).exists(),'LOOP_EXPORT_OUTPUT_EXISTS')
    # Paths enter JS literals, then single-quoted PowerShell arguments; never shell interpolation.
    require(all('\n' not in x and '\r' not in x for x in config.values() if isinstance(x,str)), 'LOOP_EXPORT_PATH')
    core=(root/'generation-loop.mjs').read_text(encoding='utf-8')
    host=(root/'generation-loop-host.mjs').read_text(encoding='utf-8')
    host='\n'.join(line for line in host.splitlines() if not line.startswith('import '))
    source='\n'.join(line.removeprefix('export ') for line in (core+'\n'+host).splitlines())
    source+='\nreturn await runToolGeneration({tools,config:'+json.dumps(config,ensure_ascii=True)+',progress:async e=>notify(e),onImage:r=>generatedImage(r),schedule:setTimeout,unschedule:clearTimeout});\n'
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as stream:stream.write(source)
    handoff=dict(kind='ui_generation_execution_handoff_v1',script=str(output),scriptSha256=sha256(output),
        planDigest=plan_digest,jobDigest=config['jobDigest'],runDirectory=config['job'],
        maximumCalls=config['maximumCalls'],assignedCalls=config.get('assignedCalls',0),
        automaticRetries=0,outputRoot=config['outputRoot'],outputRootMode=config.get('outputRootMode','direct'),
        journal=config['journal'],completion=str(output.parent/'completion.json'),
        scope='Local execution only; not authorization or portable delivery evidence.',
        executorSteps=['Verify script hash and fresh official status; inspect required reference inputs.',
            'Execute this exact entry once using the approved image tool host. Do not replan or reauthorize.',
            'Persist returned responses before receive. Never resubmit uncertain calls.',
            'Stop at completion; the coordinator owns quality review, processing and packaging.'],
        coordinatorSteps=['Verify completion journal hash and official status immediately; do not wait for narrative.',
            'Record setup, tool time, loop overhead and handoff delay separately.'])
    handoff['digest']=digest(handoff)
    write_json(handoff_path,handoff)
    return dict(script=str(output),sha256=sha256(output),maximumCalls=config['maximumCalls'],
                executionHandoff=str(handoff_path),executionHandoffDigest=handoff['digest'],
                planDigest=plan_digest,generationCalls=0,host='windows-powershell-tool-cell')
