import {panelOrientations,orientationInstructions} from './orientation.mjs';
import {planningClient,codexPlanningClient} from './planning-client.mjs';
import {json,hash,readSafe} from '../skins/package.mjs';
import {actionPresetFromIntent} from './action-intent.mjs';
import {isDeepStrictEqual} from 'node:util';
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function actionConsumer(config,presetId,pack,manifestSha256,aliases,orientation){
  panelOrientations(orientation);
  if(!Object.hasOwn(config.presets,presetId))fail('ACTION_PRESET_UNKNOWN');
  const names=aliases.skins[pack.id];
  if(aliases.version!=='1.0'||!Array.isArray(names)||!names.length||!names.every(s=>typeof s==='string'&&s.trim()))fail('SKIN_ALIASES_REQUIRED');
  return {...(orientation?{orientation}:{}),config:structuredClone(config),presetId,skinSha256:manifestSha256,selectedSkin:{id:pack.id,aliases:[...names],manifestSha256}};
}
export async function prepareActionPlan({request,catalog,instructions,consumer}){
  const session=await planningClient().prepare({request,catalog});
  const api=await codexPlanningClient();
  const plan=await api.prepareCodexPlanning(session,orientationInstructions(instructions,consumer.orientation)+'\n\nConsumer constraints:\n'+json(consumer));
  return {plan,consumer};
}
export async function verifyActionPlan(bundle,consumer,instructions){
  if(!isDeepStrictEqual(bundle.consumer,consumer)||bundle.plan.instructions!==orientationInstructions(instructions,consumer.orientation)+'\n\nConsumer constraints:\n'+json(consumer))fail('CONSUMER_CHANGED_REPLAN');
  await planningClient().verify(bundle.plan.session);
  const api=await codexPlanningClient(),expected=await api.prepareCodexPlanning(bundle.plan.session,bundle.plan.instructions);
  if(!isDeepStrictEqual(expected,bundle.plan))fail('PLANNING_PLAN_CHANGED');
  return bundle;
}
export async function loadActionRun(directory,{config,pack,manifestSha256,aliases,instructions,ctx}){
  const read=async name=>JSON.parse(await readSafe(directory,name));
  const plan=await read('plan.json'),receipt=await read('receipt.json'),report=await read('conversion.json');
  const suffix='\n\nConsumer constraints:\n',consumer=JSON.parse(plan.instructions.slice(plan.instructions.lastIndexOf(suffix)+suffix.length));
  await verifyActionPlan({plan,consumer},actionConsumer(config,consumer.presetId,pack,manifestSha256,aliases,consumer.orientation),instructions);
  const raw=await readSafe(directory,'response.txt'),intent=await read('intent.json');
  if(receipt.status!=='RESPONSE_RECEIVED'||receipt.planSha256!==plan.sha256||receipt.contextSha256!==plan.session.context.sha256||receipt.responseSha256!==hash(raw)||receipt.invocationCount!==1||receipt.automaticRetries!==0)fail('ACTION_RECEIPT_INVALID');
  if(!isDeepStrictEqual(JSON.parse(raw),intent)||report.status!=='COMPILED')fail('ACTION_RUN_NOT_COMPILED');
  for(const entry of report.files)if(hash(await readSafe(directory,entry.file))!==entry.sha256)fail('ACTION_ARTIFACT_CHANGED');
  const preset=await actionPresetFromIntent(plan.session,intent,config,consumer.presetId,{...ctx,orientation:consumer.orientation});
  if(!isDeepStrictEqual(preset,await read('preset.json')))fail('ACTION_ARTIFACT_CHANGED');
  return {preset,evidence:{planSha256:plan.sha256,responseSha256:receipt.responseSha256,source:'model-response'}};
}
