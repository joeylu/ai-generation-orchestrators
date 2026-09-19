/** Windows tool-host entry. Generation exists only through the injected tool. */
import {runGenerationLoop,batchedLoopPersistence} from './generation-loop.mjs';

export async function runToolGeneration({tools,config,progress=async()=>{},onImage=()=>{},schedule,unschedule}) {
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const run=async command=>{
    let result=await tools.exec_command({cmd:command,shell:'powershell',max_output_tokens:10000});
    let output=result.output||'';
    while(result.session_id!=null && result.exit_code==null){
      result=await tools.write_stdin({session_id:result.session_id,chars:'',yield_time_ms:1000,max_output_tokens:10000});
      output+=result.output||'';
    }
    if(result.exit_code!==0) throw new Error('LOOP_HOST_COMMAND_FAILED');
    return JSON.parse(output);
  };
  const assets=config.product==='assets';
  const module=assets?'ai_ui_decomposition.assets_cli':'ai_ui_decomposition.cli';
  const statusArgs=assets?`generation-status --run-dir ${quote(config.job)}`:`workflow-status --job ${quote(config.job)}`;
  const exchangeArgs=assets?`exchange-generation --run-dir ${quote(config.job)}`:`workflow-exchange-generation --job ${quote(config.job)}`;
  const cli=args=>`$env:PYTHONPATH=${quote(config.packageRoot)}; & ${quote(config.python)} -X utf8 -B -m ${module} ${args}`;
  // Validate fresh official state before making a journal or reserving a request.
  const status=await run(cli(statusArgs));
  const recovery=assets&&config.returnedResponse;
  if(status.status!==(recovery?'awaiting_external':'ready')||status.nextNode!=='generate'||status.jobDigest!==config.jobDigest ||
      (recovery&&status.assignedCalls!==config.assignedCalls))
    throw new Error('LOOP_HOST_NOT_FRESH');
  let initialPrevious=null;
  if(recovery){
    const resolved=await run(`& ${quote(config.node)} ${quote(config.bridge)} resolve ${quote(config.outputRoot)} ${quote(config.returnedResponse)} ${quote(config.outputRootMode||'direct')}`);
    if(resolved.responseSha256!==config.returnedResponseSha256||resolved.requestDigest!==config.returnedRequestDigest)
      throw new Error('LOOP_RECOVERY_RESPONSE_CHANGED');
    initialPrevious={requestDigest:resolved.requestDigest,source:resolved.source};
  }
  await run(`& ${quote(config.node)} ${quote(config.bridge)} init ${quote(config.journal)}`);
  let sequence=0,lastResponse;
  const timings=[],started=Date.now();
  const persist=batchedLoopPersistence(async batch=>{
    const at=Date.now(),name=String(++sequence).padStart(4,'0')+'.json';
    const input=config.transport+'/'+name;
    const patch=await tools.apply_patch('*** Begin Patch\n*** Add File: '+input+'\n+'+JSON.stringify(batch)+'\n*** End Patch');
    if(patch?.isError)throw new Error('LOOP_HOST_TRANSPORT_FAILED');
    await run(`& ${quote(config.node)} ${quote(config.bridge)} persist ${quote(config.journal)} ${quote(input)}`);
    if(batch.events.at(-1).event==='tool-returned')lastResponse=config.journal+'/'+name;
    timings.push({phase:'persist',events:batch.events.map(e=>e.event),ms:Date.now()-at});
  });
  if(recovery)await persist({event:'returned-response-recovery',responseSha256:config.returnedResponseSha256,
    requestDigest:config.returnedRequestDigest,previouslyAssignedCalls:config.assignedCalls,automaticResubmit:false});
  const result=await runGenerationLoop({maxCalls:config.maximumCalls-(recovery?config.assignedCalls:0),initialPrevious,persist,schedule,unschedule,progress,
    exchange:async previous=>{
      const at=Date.now();
      const response=await run(cli(exchangeArgs+
        (previous?` --request-digest ${quote(previous.requestDigest)} --source ${quote(previous.source)}`:'')));
      timings.push({phase:'exchange',ms:Date.now()-at,api:response.timings});return response;
    },
    generate:async args=>{
      const at=Date.now();const response=await tools.image_gen__imagegen(args);
      timings.push({phase:'generation',ms:Date.now()-at});
      // Rendering must not precede durable response preservation.
      return response;
    },
    resolveResult:async response=>{
      const at=Date.now();const resolved=await run(`& ${quote(config.node)} ${quote(config.bridge)} resolve ${quote(config.outputRoot)} ${quote(lastResponse)} ${quote(config.outputRootMode||'direct')}`);
      timings.push({phase:'resolve',ms:Date.now()-at});await onImage(response);return resolved.source;
    }
  });
  const report={kind:'ui_generation_loop_execution_v1',result,automaticRetries:0,
    startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,timings};
  await persist({event:'execution-summary',report});
  await progress({event:'completion-ready',completion:config.journal.replace(/[\\/][^\\/]+$/,'')+'/completion.json',
    status:result.status.status,nextNode:result.status.nextNode,requiresOfficialStatusCheck:true});
  return report;
}
