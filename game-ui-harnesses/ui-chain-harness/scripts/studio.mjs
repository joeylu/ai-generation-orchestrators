import {fileURLToPath} from 'node:url';
import {readSafe} from '../src/skins/package.mjs';
import {studioSnapshot} from '../src/studio/catalog.mjs';
import {studioServer,inspectStudioTasks,validateTasks} from '../src/studio/tasks.mjs';
import {recoveryController,cliRecovery} from '../src/studio/recovery.mjs';
import {studioPlanner} from '../src/studio/planning.mjs';
import {localGeneration} from '../src/studio/generation.mjs';
import {discoverPlans} from '../src/studio/history.mjs';
import {pipelineController} from '../src/studio/pipeline.mjs';
import {studioLibrary} from '../src/studio/library.mjs';
import {studioStyles} from '../src/studio/styles.mjs';
import {automaticProcessing} from '../src/studio/auto-process.mjs';
import {studioPanelPresets} from '../src/studio/panel-presets.mjs';
import {panelEditController} from '../src/studio/panel-edit.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const project=process.argv[2],port=Number(process.argv[3]||4310);
if(!project||!Number.isInteger(port)||port<1024||port>65535)throw Error('Usage: node scripts/studio.mjs work/project.json [port]');
const config=JSON.parse(await readSafe(root,project)),tasks=validateTasks(config.tasks);
const snapshot=await studioSnapshot(root,config);
const recovery=recoveryController(tasks,()=>inspectStudioTasks(root,tasks),cliRecovery(root));
await studioStyles(root,snapshot);
studioPanelPresets(snapshot);
const generation=localGeneration(root,snapshot),planner=studioPlanner(root);
const pipeline=pipelineController(root,generation,snapshot);
const auto=automaticProcessing(root,generation,pipeline);generation.onSettled(auto);
const server=studioServer(snapshot,port,recovery.list,recovery.start,async data=>{const plan=await planner(data);return {...plan,generationId:generation.register(plan)};},generation,()=>discoverPlans(root,generation),pipeline,studioLibrary(root,generation,pipeline,snapshot),panelEditController(root,snapshot));
server.on('close',()=>auto.close());
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. If Studio is running, open http://127.0.0.1:${port}/; otherwise choose another port.`:'Studio could not start. Check the local project configuration.');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
 console.log(`Studio: http://127.0.0.1:${port}/ (${snapshot.items.length} artifacts)`);
 // Restore only after binding the port: a failed second launch must not process work.
 (async()=>{
  for(const plan of (await discoverPlans(root,generation)).plans){if(plan.status!=='readable')continue;try{await pipeline.action('status',{id:plan.generationId});await auto(plan.generationId);}catch{console.error('A saved workspace needs review; its original files were retained.');}}
 })().catch(()=>console.error('Saved workspace discovery needs review.'));
});
