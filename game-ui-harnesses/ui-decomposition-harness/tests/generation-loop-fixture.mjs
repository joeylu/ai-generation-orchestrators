/** Offline integration driver. The injected generator returns fixture bytes only. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {runGenerationLoop} from '../src/ai_ui_decomposition/generation-loop.mjs';
import {createLoopJournal,verifyBuiltinResult} from '../src/ai_ui_decomposition/generation-loop-node.mjs';
const [python,job,raw,output]=process.argv.slice(2);
const persist=createLoopJournal(output);
const result=await runGenerationLoop({
  maxCalls:3,
  exchange:async previous=>{
    const args=['-X','utf8','-B','-m','ai_ui_decomposition.cli','workflow-exchange-generation','--job',job];
    if(previous)args.push('--request-digest',previous.requestDigest,'--source',previous.source);
    return JSON.parse(execFileSync(python,args,{encoding:'utf8',maxBuffer:8*1024*1024}));
  },
  generate:async()=>({image_url:'data:image/png;base64,'+readFileSync(raw).toString('base64'),
    output_hint:`Offline fixture saved as ${raw} by default.`}),
  resolveResult:async response=>verifyBuiltinResult(response,dirname(raw)),
  persist,
});
writeFileSync(join(output,'result.json'),JSON.stringify({...result,fixtureOnly:true,providerCalls:0}),{flag:'wx'});
