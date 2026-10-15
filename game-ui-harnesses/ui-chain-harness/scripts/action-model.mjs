import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {codexPlanningClient} from '../src/panel/planning-client.mjs';
import {validateSettingsResponse} from '../src/panel/settings-intent.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {actionConsumer,prepareActionPlan,verifyActionPlan} from '../src/panel/action-model.mjs';
import {editorData} from '../src/panel/data.mjs';
import {verifySkinPackage,bindingsOf,json,hash} from '../src/skins/package.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {referenceActionConfig} from '../src/panel/reference-presets.mjs';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const {positionals,values}=parseArgs({allowPositionals:true,options:{request:{type:'string'},package:{type:'string'},plan:{type:'string'},authorize:{type:'string'},preset:{type:'string'},aliases:{type:'string'},orientation:{type:'string'}}});
try {
  if(!['prepare','run'].includes(positionals[0])||positionals.length!==1||!values.package)throw Error('ARGUMENTS');
  if(positionals[0]==='run'&&(!values.plan||!values.authorize||values.request))throw Error('ARGUMENTS');
  if(positionals[0]==='prepare'&&(!values.request||!values.preset||values.authorize||values.plan))throw Error('ARGUMENTS');
  const api=await codexPlanningClient();
  const {pack,manifestSha256}=await verifySkinPackage(resolve(values.package));
  const expected=bindingsOf(await readContracts(defaults));
  if(pack.sourceKind!=='imported'||Object.keys(expected).some(k=>expected[k]!==pack.bindings[k]))throw Error('SKIN_BINDINGS_CHANGED');
  let config=await read(join(root,'configs/action-presets.json'));const aliases=await read(values.aliases?resolve(values.aliases):join(root,'configs/planning-skin-aliases.json'));
  const bundle=positionals[0]==='run'?await read(values.plan):null;
  const presetId=values.preset??bundle?.consumer.presetId;
  const instructions=await readFile(join(root,presetId==='custom'?'prompts/custom-panel-planner.md':'prompts/action-planner.md'),'utf8');
  if(presetId?.startsWith('sdk-'))config=referenceActionConfig(config,presetId);
  if(presetId==='custom')config=customActionConfig(config);
  const consumer=actionConsumer(config,values.preset??bundle?.consumer.presetId,pack,manifestSha256,aliases,values.orientation??bundle?.consumer.orientation);
  if(positionals[0]==='prepare') {
    if(!values.request||values.authorize||values.plan)throw Error('ARGUMENTS');
    const request=await read(values.request),catalog=await read(join(root,'../ui-panel-harness/examples/modern-all-components.catalog.json'));
    const {plan}=await prepareActionPlan({request,catalog,instructions,consumer});
    const dir=join(root,'work/panels/action-model-plans');await mkdir(dir,{recursive:true});
    const path=join(dir,plan.sha256+'.json');await writeFile(path,json({plan,consumer}),{flag:'wx'});
    console.log(JSON.stringify({status:'PREPARED',plan:path,sha256:plan.sha256,model:plan.model,effort:plan.effort,modelCalls:0}));
  } else {
    if(!values.plan||!values.authorize||values.request)throw Error('ARGUMENTS');
    await verifyActionPlan(bundle,consumer,instructions);
    const result=await api.runCodexPlanning(bundle.plan,{authorizationSha256:values.authorize,outputRoot:join(root,'work/panels/action-model-runs'),writableRoot:root});
    // Raw response and transport receipt already exist before semantic validation.
    try {
    await validateSettingsResponse(bundle.plan.session,result.intent);
    if(result.intent.panel===null&&result.intent.unresolved.length) {
      await writeFile(join(result.directory,'conversion.json'),json({status:'NEEDS_INPUT',questions:result.intent.unresolved,automaticRetries:0}),{flag:'wx'});
      console.log(JSON.stringify({status:'NEEDS_INPUT',directory:result.directory,questions:result.intent.unresolved,receipt:result.receipt}));
      process.exitCode=2;
    } else {
      const data=await editorData(),ctx={...data,orientation:consumer.orientation,profile:pack.theme,...settingsSkinGeometry(pack),binding:{sourceKind:'imported',sha256:manifestSha256}};
      const converted=await actionPresetFromIntent(bundle.plan.session,result.intent,config,consumer.presetId,ctx);
      const files=[];
      for(const[name,value]of Object.entries({'session.json':bundle.plan.session,'config.json':config,'preset.json':converted,'content.json':converted.content,'behavior.json':converted.behavior,
        ...Object.fromEntries(Object.entries(converted.documents).map(([name,doc])=>[name+'.panel.json',doc]))})){
        const bytes=Buffer.from(json(value));await writeFile(join(result.directory,name),bytes,{flag:'wx'});files.push({file:name,sha256:hash(bytes)});
      }
      await writeFile(join(result.directory,'conversion.json'),json({status:'COMPILED',...converted.provenance,files,productionReady:false,visualAcceptance:'unreviewed'}),{flag:'wx'});
      console.log(JSON.stringify({status:'COMPILED',directory:result.directory,receipt:result.receipt}));
    }
    }catch(error){
      await writeFile(join(result.directory,'conversion.json'),json({status:'REJECTED',code:typeof error.code==='string'?error.code:'CONVERSION_FAILED',automaticRetries:0}),{flag:'wx'});
      throw error;
    }
  }
}catch(error){console.error(JSON.stringify({status:'FAILED',code:/^[A-Za-z0-9_.-]+$/.test(error.code??error.message)?error.code??error.message:'ACTION_MODEL_FAILED',receipt:error.receipt??null}));process.exitCode=1;}
