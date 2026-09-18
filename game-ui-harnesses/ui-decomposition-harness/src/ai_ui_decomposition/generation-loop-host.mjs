/** Windows tool-host entry. Generation exists only through the injected tool. */
import {runGenerationLoop,batchedLoopPersistence} from './generation-loop.mjs';

export async function runToolGeneration({tools,config,progress=async()=>{},onImage=()=>{},schedule,unschedule}) {
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const run=async command=>{
    const result=await tools.exec_command({cmd:command,shell:'powershell',max_output_tokens:10000});
    if(result.exit_code!==0) throw new Error('LOOP_HOST_COMMAND_FAILED');
    return JSON.parse(result.output);
  };
  const assets=config.product==='assets';
  const module=assets?'ai_ui_decomposition.assets_cli':'ai_ui_decomposition.cli';
  const statusArgs=assets?`generation-status --run-dir ${quote(config.job)}`:`workflow-status --job ${quote(config.job)}`;
  const exchangeArgs=assets?`exchange-generation --run-dir ${quote(config.job)}`:`workflow-exchange-generation --job ${quote(config.job)}`;
  const cli=args=>`$env:PYTHONPATH=${quote(config.packageRoot)}; & ${quote(config.python)} -X utf8 -B -m ${module} ${args}`;
  // Validate fresh official state before making a journal or reserving a request.
  const status=await run(cli(statusArgs));
  if(status.status!=='ready'||status.nextNode!=='generate'||status.jobDigest!==config.jobDigest)
    throw new Error('LOOP_HOST_NOT_FRESH');
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
  const result=await runGenerationLoop({maxCalls:config.maximumCalls,persist,schedule,unschedule,progress,
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
      const at=Date.now();const resolved=await run(`& ${quote(config.node)} ${quote(config.bridge)} resolve ${quote(config.outputRoot)} ${quote(lastResponse)}`);
      timings.push({phase:'resolve',ms:Date.now()-at});await onImage(response);return resolved.source;
    }
  });
  const report={kind:'ui_generation_loop_execution_v1',result,automaticRetries:0,
    startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,timings};
  await persist({event:'execution-summary',report});
  return report;
}
