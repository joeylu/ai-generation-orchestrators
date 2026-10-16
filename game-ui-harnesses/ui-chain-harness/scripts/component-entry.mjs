import {componentPipelineContract} from '../src/components-api.mjs';
if(process.argv.length!==3||process.argv[2]!=='contract'){
 console.error(JSON.stringify({status:'failed',code:'component-entry.usage',message:'Use: node scripts/component-entry.mjs contract',modelCalls:0}));
 process.exitCode=1;
}else console.log(JSON.stringify(await componentPipelineContract(),null,2));
