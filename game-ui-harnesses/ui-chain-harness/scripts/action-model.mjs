import {freezeReferenceLayout} from '../src/panel/reference-layout-source.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {codexPlanningClient} from '../src/panel/planning-client.mjs';
import {readPanelSdkJson} from '../src/panel/sdk.mjs';
import {actionConsumer,prepareActionPlan,verifyActionPlan,materializeActionRun,actionPlanningFiles,inventoryModelContext} from '../src/panel/action-model.mjs';
import {editorData} from '../src/panel/data.mjs';
import {verifySkinPackage,json} from '../src/skins/package.mjs';
import {panelSkinContracts} from '../src/panel/skin-contracts.mjs';
import {referenceActionConfig} from '../src/panel/reference-presets.mjs';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const {positionals,values}=parseArgs({allowPositionals:true,options:{request:{type:'string'},package:{type:'string'},plan:{type:'string'},authorize:{type:'string'},preset:{type:'string'},aliases:{type:'string'},orientation:{type:'string'},contracts:{type:'string'},columns:{type:'string'},rows:{type:'string'}}});
try {
  if(!['prepare','run'].includes(positionals[0])||positionals.length!==1||!values.package)throw Error('ARGUMENTS');
  if(positionals[0]==='run'&&(!values.plan||!values.authorize||values.request))throw Error('ARGUMENTS');
  if(positionals[0]==='prepare'&&(!values.request||!values.preset||values.authorize||values.plan))throw Error('ARGUMENTS');
  const api=await codexPlanningClient();
  const verified=await verifySkinPackage(resolve(values.package)),{pack,manifestSha256}=verified;
  const contracts=await panelSkinContracts(pack,values.contracts);
  let config=await read(join(root,'configs/action-presets.json'));const aliases=await read(values.aliases?resolve(values.aliases):join(root,'configs/planning-skin-aliases.json'));
  const bundle=positionals[0]==='run'?await read(values.plan):null;
  const presetId=values.preset??bundle?.consumer.presetId;
  if((values.columns!==undefined||values.rows!==undefined)&&(presetId!=='inventory'||positionals[0]!=='prepare'))throw Error('ARGUMENTS');
  if(!bundle&&presetId?.startsWith('sdk-'))config=await freezeReferenceLayout(referenceActionConfig(config,presetId),presetId);
  if(!bundle&&presetId==='custom')config=customActionConfig(config);
  if(bundle){config=structuredClone(bundle.consumer.config);if(!config?.presets?.[presetId])throw Error('CONSUMER_CHANGED_REPLAN');}
  let ctx;
  if(presetId==='inventory'){
    const {inventoryActionConfig,validateInventoryActionConfig}=await import('../src/panel/inventory-intent.mjs');
    const data=await editorData(contracts),orientation=values.orientation??bundle?.consumer.orientation;
    ctx=inventoryModelContext({...data,orientation,profile:pack.theme,...settingsSkinGeometry(pack),binding:{sourceKind:'imported',sha256:manifestSha256}},verified);
    if(positionals[0]==='prepare'){
      const integer=value=>{if(value===undefined)return undefined;if(!/^[1-9][0-9]*$/.test(value))throw Error('PANEL_INVENTORY_GRID');return Number(value);};
      const grid=values.columns===undefined&&values.rows===undefined?undefined:{columns:integer(values.columns),rows:integer(values.rows)};
      config=inventoryActionConfig(config,{...ctx,...(grid?{grid}:{})});
    }else{
      config=structuredClone(bundle.consumer.config);validateInventoryActionConfig(config,ctx);
    }
  }
  const files=actionPlanningFiles(presetId,config),instructions=await readFile(join(root,files.instructions),'utf8');
  const consumer=actionConsumer(config,values.preset??bundle?.consumer.presetId,pack,manifestSha256,aliases,values.orientation??bundle?.consumer.orientation);
  if(positionals[0]==='prepare') {
    if(!values.request||values.authorize||values.plan)throw Error('ARGUMENTS');
    const request=await read(values.request),catalog=presetId==='inventory'?(await import('../src/panel/inventory-intent.mjs')).inventoryPlanningCatalog(config):await readPanelSdkJson(files.catalog);
    const {plan}=await prepareActionPlan({request,catalog,instructions,consumer});
    const dir=join(root,'work/panels/action-model-plans');await mkdir(dir,{recursive:true});
    const path=join(dir,plan.sha256+'.json');await writeFile(path,json({plan,consumer}),{flag:'wx'});
    console.log(JSON.stringify({status:'PREPARED',plan:path,sha256:plan.sha256,model:plan.model,effort:plan.effort,modelCalls:0}));
  } else {
    if(!values.plan||!values.authorize||values.request)throw Error('ARGUMENTS');
    await verifyActionPlan(bundle,consumer,instructions);
    const result=await api.runCodexPlanning(bundle.plan,{authorizationSha256:values.authorize,outputRoot:join(root,'work/panels/action-model-runs'),writableRoot:root});
    // Raw response and transport receipt already exist before semantic validation.
    if(!ctx&&result.intent.panel!==null){const data=await editorData(contracts);ctx={...data,orientation:consumer.orientation,profile:pack.theme,...settingsSkinGeometry(pack),binding:{sourceKind:'imported',sha256:manifestSha256}};}
    const converted=await materializeActionRun(result,{plan:bundle.plan,consumer,config,ctx});
    console.log(JSON.stringify(converted));if(converted.status==='NEEDS_INPUT')process.exitCode=2;
  }
}catch(error){console.error(JSON.stringify({status:'FAILED',code:/^[A-Za-z0-9_.-]+$/.test(error.code??error.message)?error.code??error.message:'ACTION_MODEL_FAILED',receipt:error.receipt??null}));process.exitCode=1;}
