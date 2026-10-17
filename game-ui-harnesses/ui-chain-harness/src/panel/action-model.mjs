import {panelOrientations,orientationInstructions} from './orientation.mjs';
import {planningClient,codexPlanningClient} from './planning-client.mjs';
import {json,hash,readSafe} from '../skins/package.mjs';
import {actionPresetFromIntent} from './action-intent.mjs';
import {isDeepStrictEqual} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateSettingsResponse} from './settings-intent.mjs';
import {deriveTextReadability} from '../skins/text-readability.mjs';
import {decodePng} from '../skins/png.mjs';
import {inventoryPresetContext} from './inventory-preset.mjs';
import {compilationSurfaceVersion,surfaceCompileContext} from './surface-presentation.mjs';
import {validateFormActionPolicy} from './form-actions.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const instructionsFor=(instructions,consumer)=>orientationInstructions(instructions,consumer.orientation,{allowPanelDimensions:consumer.presetId==='custom'});
export function actionPlanningFiles(presetId,frozenConfig){
  let instructions=presetId==='inventory'?'prompts/inventory-planner.md':presetId==='custom'?'prompts/custom-panel-planner.md':'prompts/action-planner.md';
  if(presetId==='inventory'&&frozenConfig!==undefined){
    const version=frozenConfig.inventoryPlanning?.version;
    if(!['1.0','1.1','1.2','1.3','1.4','1.5'].includes(version))fail('CONSUMER_CHANGED_REPLAN');
    if(version==='1.0')instructions='prompts/inventory-planner-v1.md';
    if(version==='1.1')instructions='prompts/inventory-planner-v2.md';
  }
  if(presetId==='custom'&&frozenConfig!==undefined){
    const preset=frozenConfig.presets?.custom,version=preset?.layout?.version;
    if(!['1.0','2.0','3.0','4.0'].includes(version))fail('CONSUMER_CHANGED_REPLAN');
    validateFormActionPolicy(preset.formActions);
    if(!['3.0','4.0'].includes(version))instructions='prompts/custom-panel-planner-v2.md';
    else if(!preset.formActions)instructions='prompts/custom-panel-planner-v3.md';
  }
  return {instructions,catalog:presetId==='inventory'?'examples/modern-readable-game-grid-layout.catalog.json':'examples/modern-all-components.catalog.json'};
}
export function inventoryModelContext(ctx,{pack,resources}){
  const images=new Map(pack.assets.map(asset=>[asset.assetId,decodePng(resources.get(asset.file))]));
  const readability=deriveTextReadability(pack,images,{preserve:false});
  return inventoryPresetContext({...ctx,inventoryHeadingColor:readability.inks['skin.surface.panel']});
}
export function actionPlanConsumer(plan){
  const suffix='\n\nConsumer constraints:\n',offset=typeof plan?.instructions==='string'?plan.instructions.lastIndexOf(suffix):-1;
  if(offset<0)fail('CONSUMER_CHANGED_REPLAN');
  try{
    const consumer=JSON.parse(plan.instructions.slice(offset+suffix.length));
    if(!consumer||typeof consumer!=='object'||Array.isArray(consumer)||typeof consumer.presetId!=='string'||!consumer.config)fail('CONSUMER_CHANGED_REPLAN');
    return consumer;
  }catch{fail('CONSUMER_CHANGED_REPLAN');}
}
async function compileIntent(session,intent,config,presetId,ctx){
  if(presetId==='inventory'){
    const {inventoryPresetFromIntent}=await import('./inventory-intent.mjs');
    return inventoryPresetFromIntent(session,intent,config,presetId,ctx);
  }
  return actionPresetFromIntent(session,intent,config,presetId,ctx);
}
export function actionConsumer(config,presetId,pack,manifestSha256,aliases,orientation){
  panelOrientations(orientation);
  if(!Object.hasOwn(config.presets,presetId))fail('ACTION_PRESET_UNKNOWN');
  const names=aliases.skins[pack.id];
  if(aliases.version!=='1.0'||!Array.isArray(names)||!names.length||!names.every(s=>typeof s==='string'&&s.trim()))fail('SKIN_ALIASES_REQUIRED');
  return {...(orientation?{orientation}:{}),config:structuredClone(config),presetId,skinSha256:manifestSha256,selectedSkin:{id:pack.id,aliases:[...names],manifestSha256}};
}
export async function prepareActionPlan({request,catalog,instructions,consumer}){
  if(consumer.presetId==='inventory'){
    const {inventoryPlanningCatalog,validateInventoryActionConfig}=await import('./inventory-intent.mjs');
    validateInventoryActionConfig(consumer.config);
    const expected=inventoryPlanningCatalog(consumer.config);
    if(catalog!==undefined&&!isDeepStrictEqual(catalog,expected))fail('CONSUMER_CHANGED_REPLAN');
    catalog=expected;
  }
  const session=await planningClient().prepare({request,catalog});
  const api=await codexPlanningClient();
  const plan=await api.prepareCodexPlanning(session,instructionsFor(instructions,consumer)+'\n\nConsumer constraints:\n'+json(consumer));
  return {plan,consumer};
}
export async function verifyActionPlan(bundle,consumer,instructions){
  if(!isDeepStrictEqual(bundle.consumer,consumer)||bundle.plan.instructions!==instructionsFor(instructions,consumer)+'\n\nConsumer constraints:\n'+json(consumer))fail('CONSUMER_CHANGED_REPLAN');
  if(consumer.presetId==='inventory'){
    const {inventoryPlanningCatalog,validateInventoryActionConfig}=await import('./inventory-intent.mjs');
    validateInventoryActionConfig(consumer.config);
    if(!isDeepStrictEqual(bundle.plan.session.context.catalog,inventoryPlanningCatalog(consumer.config)))fail('CONSUMER_CHANGED_REPLAN');
  }
  await planningClient().verify(bundle.plan.session);
  const api=await codexPlanningClient(),expected=await api.prepareCodexPlanning(bundle.plan.session,bundle.plan.instructions);
  if(!isDeepStrictEqual(expected,bundle.plan))fail('PLANNING_PLAN_CHANGED');
  return bundle;
}
async function actionResponse(directory,plan,expectedIntent){
  const [savedPlan,receipt,raw,intent]=await Promise.all([
    readSafe(directory,'plan.json').then(bytes=>JSON.parse(bytes)),
    readSafe(directory,'receipt.json').then(bytes=>JSON.parse(bytes)),
    readSafe(directory,'response.txt'),
    readSafe(directory,'intent.json').then(bytes=>JSON.parse(bytes)),
  ]);
  if(!isDeepStrictEqual(savedPlan,plan)||receipt?.status!=='RESPONSE_RECEIVED'||receipt.planSha256!==plan.sha256||receipt.contextSha256!==plan.session.context.sha256||receipt.responseSha256!==hash(raw)||receipt.invocationCount!==1||receipt.automaticRetries!==0)fail('ACTION_RECEIPT_INVALID');
  let parsed;try{parsed=JSON.parse(raw);}catch{fail('ACTION_RECEIPT_INVALID');}
  if(!isDeepStrictEqual(parsed,intent)||expectedIntent!==undefined&&!isDeepStrictEqual(expectedIntent,intent))fail('ACTION_RECEIPT_INVALID');
  return {intent,receipt};
}
// Receipt/raw output already exists here. One deterministic producer owns both
// CLI and offline-test conversion files; no caller authors a success receipt.
export async function materializeActionRun(result,{plan,consumer,config=consumer.config,ctx}){
  try{
    if(!isDeepStrictEqual(config,consumer.config)||!isDeepStrictEqual(actionPlanConsumer(plan),consumer))fail('CONSUMER_CHANGED_REPLAN');
    const response=await actionResponse(result.directory,plan,result.intent);
    const {intent}=await validateSettingsResponse(plan.session,response.intent);
    if(intent.panel===null&&intent.unresolved.length){
      await writeFile(join(result.directory,'conversion.json'),json({status:'NEEDS_INPUT',questions:intent.unresolved,automaticRetries:0}),{flag:'wx'});
      return {status:'NEEDS_INPUT',directory:result.directory,questions:intent.unresolved,receipt:response.receipt};
    }
    const surfaceVersion=compilationSurfaceVersion(config,consumer.presetId,ctx),converted=await compileIntent(plan.session,intent,config,consumer.presetId,surfaceCompileContext({...ctx,orientation:consumer.orientation},surfaceVersion));
    const files=[];
    for(const[name,value]of Object.entries({'session.json':plan.session,'config.json':config,'preset.json':converted,'content.json':converted.content,'behavior.json':converted.behavior,
      ...Object.fromEntries(Object.entries(converted.documents).map(([name,document])=>[name+'.panel.json',document]))})){
      const bytes=Buffer.from(json(value));await writeFile(join(result.directory,name),bytes,{flag:'wx'});files.push({file:name,sha256:hash(bytes)});
    }
    await writeFile(join(result.directory,'conversion.json'),json({status:'COMPILED',...(surfaceVersion?{surfaceRecipesVersion:surfaceVersion}:{}),...converted.provenance,files,productionReady:false,visualAcceptance:'unreviewed'}),{flag:'wx'});
    return {status:'COMPILED',directory:result.directory,receipt:response.receipt};
  }catch(error){
    await writeFile(join(result.directory,'conversion.json'),json({status:'REJECTED',code:typeof error.code==='string'?error.code:'CONVERSION_FAILED',automaticRetries:0}),{flag:'wx'});
    throw error;
  }
}
export async function loadActionRun(directory,{config,pack,manifestSha256,aliases,instructions,ctx}){
  const read=async name=>JSON.parse(await readSafe(directory,name));
  const plan=await read('plan.json'),report=await read('conversion.json');
  const consumer=actionPlanConsumer(plan);
  await verifyActionPlan({plan,consumer},actionConsumer(config,consumer.presetId,pack,manifestSha256,aliases,consumer.orientation),instructions);
  const {intent,receipt}=await actionResponse(directory,plan);
  if(report.status!=='COMPILED')fail('ACTION_RUN_NOT_COMPILED');
  for(const entry of report.files)if(hash(await readSafe(directory,entry.file))!==entry.sha256)fail('ACTION_ARTIFACT_CHANGED');
  const preset=await compileIntent(plan.session,intent,config,consumer.presetId,surfaceCompileContext({...ctx,orientation:consumer.orientation},report.surfaceRecipesVersion??0));
  if(!isDeepStrictEqual(preset,await read('preset.json')))fail('ACTION_ARTIFACT_CHANGED');
  return {preset,evidence:{planSha256:plan.sha256,responseSha256:receipt.responseSha256,source:'model-response'}};
}
