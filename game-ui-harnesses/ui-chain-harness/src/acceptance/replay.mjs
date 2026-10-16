import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {json,hash} from '../skins/package.mjs';
import {editorData} from '../panel/data.mjs';
import {settingsSkinGeometry} from '../panel/skin-geometry.mjs';
import {settingsFromIntent,validateSettingsResponse} from '../panel/settings-intent.mjs';
import {actionPresetFromIntent} from '../panel/action-intent.mjs';
import {inventoryPresetFromIntent} from '../panel/inventory-intent.mjs';
import {inventoryModelContext,actionPlanningFiles,verifyActionPlan} from '../panel/action-model.mjs';
import {codexPlanningClient} from '../panel/planning-client.mjs';
import {layeredConsumer,referenceConsumer,surfaceCompileContext} from '../panel/surface-presentation.mjs';
import {fail,verifyBatch,caseInputs,rawEvidence,sourceIdentity} from './evidence.mjs';
import {originalRun} from './batch.mjs';
export function surfaceVersion(consumer,report){
 const config=consumer.config;
 if(report?.status==='COMPILED'){const version=report.surfaceRecipesVersion??0;if(![0,1,2,3].includes(version))fail('ACCEPTANCE_SURFACE_VERSION');return version;}
 if(config&&referenceConsumer(config,consumer.presetId)||consumer.layout?.presentation?.version==='3.0')return 3;
 if(config&&layeredConsumer(config,consumer.presetId)||consumer.layout?.presentation?.version==='2.0')return 2;
 return 1;
}
export async function compileEvidence({root,entry,inputs,evidence,conversionReport}){
 const {bundle,verified,contracts,aliases}=inputs,{plan,consumer}=bundle,settings=entry.kind==='sdk-settings';
 if(settings){const api=await codexPlanningClient();if(!isDeepStrictEqual(await api.prepareCodexPlanning(plan.session,plan.instructions),plan)||!plan.instructions.endsWith('\n\nConsumer constraints:\n'+json(consumer)))fail('ACCEPTANCE_PLAN_CHANGED');}
 else{const instructions=await readFile(join(root,actionPlanningFiles(consumer.presetId,consumer.config).instructions),'utf8');await verifyActionPlan(bundle,consumer,instructions);}
 await validateSettingsResponse(plan.session,evidence.intent);
 if(evidence.intent.panel===null||evidence.intent.unresolved.length)fail('ACCEPTANCE_NEEDS_INPUT');
 const version=surfaceVersion(consumer,conversionReport),data=await editorData(contracts);
 let ctx=surfaceCompileContext({...data,orientation:entry.orientation,profile:verified.pack.theme,...settingsSkinGeometry(verified.pack),binding:{sourceKind:'imported',sha256:verified.manifestSha256}},version);
 if(entry.kind==='inventory')ctx=inventoryModelContext(ctx,verified);
 if(settings){const converted=await settingsFromIntent(plan.session,evidence.intent,consumer.policy,consumer.layout,ctx);return {...converted,version,settings:true};}
 const preset=await (entry.kind==='inventory'?inventoryPresetFromIntent:actionPresetFromIntent)(plan.session,evidence.intent,consumer.config,entry.kind,ctx);
 return {...preset,preset,version,settings:false};
}
export async function replayCase({root,directory,entry,outputRoot=join(root,'work/panel-acceptance-replays')}){
 await verifyBatch(directory);const inputs=await caseInputs(directory,entry),rawDirectory=await originalRun(root,directory,entry),evidence=await rawEvidence(rawDirectory,inputs.bundle.plan);
 let conversionReport;try{conversionReport=JSON.parse(await readFile(join(rawDirectory,'conversion.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
 const compiled=await compileEvidence({root,entry,inputs,evidence,conversionReport}),output=join(outputRoot,entry.id,randomUUID());await mkdir(output,{recursive:true});
 // Copy transport evidence byte-for-byte. This is a derived directory, never a second invocation.
 for(const file of evidence.files)await writeFile(join(output,file.file),file.bytes,{flag:'wx'});
 const {bundle}=inputs,objects=compiled.settings?{'session.json':bundle.plan.session,'policy.json':bundle.consumer.policy,'layout.json':bundle.consumer.layout,'content.json':compiled.content}:{'session.json':bundle.plan.session,'config.json':bundle.consumer.config,'preset.json':compiled.preset,'content.json':compiled.content,'behavior.json':compiled.behavior};
 for(const [name,doc]of Object.entries(compiled.documents))objects[name+'.panel.json']=doc;
 const files=[];for(const [file,value]of Object.entries(objects)){const bytes=Buffer.from(json(value));await writeFile(join(output,file),bytes,{flag:'wx'});files.push({file,sha256:hash(bytes)});}
 await writeFile(join(output,'conversion.json'),json({status:'COMPILED',...(compiled.version?{surfaceRecipesVersion:compiled.version}:{}),...compiled.provenance,files,productionReady:false,visualAcceptance:'unreviewed'}),{flag:'wx'});
 const origin={kind:'ui_panel_acceptance_replay',version:'1.0',caseId:entry.id,originalDirectory:rawDirectory,planSha256:entry.planSha256,responseSha256:evidence.receipt.responseSha256,receiptSha256:evidence.files.find(f=>f.file==='receipt.json').sha256,dispatchSha256:evidence.files.find(f=>f.file==='dispatch.json').sha256,sourceSha256:(await sourceIdentity(root)).sha256,modelCalls:0,automaticRetries:0};
 await writeFile(join(output,'replay.json'),json(origin),{flag:'wx'});
 return {status:'REPLAYED',directory:output,origin,compiled};
}
