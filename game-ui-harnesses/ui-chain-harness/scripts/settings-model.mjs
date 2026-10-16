import {panelOrientations,orientationInstructions} from '../src/panel/orientation.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {planningClient,codexPlanningClient} from '../src/panel/planning-client.mjs';
import {readPanelSdkJson} from '../src/panel/sdk.mjs';
import {settingsFromIntent,validateSettingsResponse} from '../src/panel/settings-intent.mjs';
import {editorData} from '../src/panel/data.mjs';
import {verifySkinPackage,json,hash} from '../src/skins/package.mjs';
import {panelSkinContracts} from '../src/panel/skin-contracts.mjs';
import {referenceSettingsPolicy} from '../src/panel/reference-presets.mjs';
import {surfaceCompileContext} from '../src/panel/surface-presentation.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const {positionals,values}=parseArgs({allowPositionals:true,options:{request:{type:'string'},package:{type:'string'},plan:{type:'string'},authorize:{type:'string'},aliases:{type:'string'},preset:{type:'string'},orientation:{type:'string'},contracts:{type:'string'}}});
try {
  if(!['prepare','run'].includes(positionals[0])||positionals.length!==1||!values.package)throw Error('ARGUMENTS');
  const api=await codexPlanningClient();
  const {pack,manifestSha256}=await verifySkinPackage(resolve(values.package));
  const contracts=await panelSkinContracts(pack,values.contracts);
  let policy=await read(join(root,'configs/settings-planning-policy.json')),layout=await read(join(root,'configs/settings-layout.json'));
  const saved=positionals[0]==='run'&&values.plan?await read(values.plan):null;
  const preset=values.preset??saved?.consumer.policy.reference?.id;if(preset&&preset!=='sdk-settings')throw Error('REFERENCE_PRESET_UNKNOWN');if(preset)policy=referenceSettingsPolicy(policy);
  if(saved){policy=structuredClone(saved.consumer.policy);layout=structuredClone(saved.consumer.layout);}
  const aliases=await read(values.aliases?resolve(values.aliases):join(root,'configs/planning-skin-aliases.json'));
  if(aliases.version!=='1.0'||!Array.isArray(aliases.skins[pack.id])||!aliases.skins[pack.id].every(s=>typeof s==='string'&&s.trim()))throw Error('SKIN_ALIASES_REQUIRED');
  const orientation=values.orientation??saved?.consumer.orientation;panelOrientations(orientation);
  const consumer={...(orientation?{orientation}:{}),policy,layout,skinSha256:manifestSha256,selectedSkin:{id:pack.id,aliases:aliases.skins[pack.id],manifestSha256}};
  if(positionals[0]==='prepare') {
    if(!values.request||values.authorize||values.plan)throw Error('ARGUMENTS');
    const request=await read(values.request),catalog=await readPanelSdkJson('examples/modern-all-components.catalog.json');
    const session=await planningClient().prepare({request,catalog});
    const instructions=orientationInstructions(await readFile(join(root,'prompts/settings-planner.md'),'utf8'),orientation);
    const plan=await api.prepareCodexPlanning(session,instructions+'\n\nConsumer constraints:\n'+json(consumer));
    const dir=join(root,'work/panels/model-plans');await mkdir(dir,{recursive:true});
    const path=join(dir,plan.sha256+'.json');await writeFile(path,json({plan,consumer}),{flag:'wx'});
    console.log(JSON.stringify({status:'PREPARED',plan:path,sha256:plan.sha256,model:plan.model,effort:plan.effort,modelCalls:0}));
  } else {
    if(!values.plan||!values.authorize||values.request)throw Error('ARGUMENTS');
    const bundle=await read(values.plan);
    if(json(bundle.consumer)!==json(consumer)||!bundle.plan.instructions.endsWith('\n\nConsumer constraints:\n'+json(consumer)))throw Error('CONSUMER_CHANGED_REPLAN');
    await planningClient().verify(bundle.plan.session);
    const result=await api.runCodexPlanning(bundle.plan,{authorizationSha256:values.authorize,outputRoot:join(root,'work/panels/model-runs'),writableRoot:root});
    // Raw response and transport receipt already exist before semantic validation.
    try {
    await validateSettingsResponse(bundle.plan.session,result.intent);
    if(result.intent.panel===null&&result.intent.unresolved.length) {
      await writeFile(join(result.directory,'conversion.json'),json({status:'NEEDS_INPUT',questions:result.intent.unresolved,automaticRetries:0}),{flag:'wx'});
      console.log(JSON.stringify({status:'NEEDS_INPUT',directory:result.directory,questions:result.intent.unresolved,receipt:result.receipt}));
      process.exitCode=2;
    } else {
      const data=await editorData(contracts),ctx={...data,orientation,profile:pack.theme,...settingsSkinGeometry(pack),binding:{sourceKind:'imported',sha256:manifestSha256}};
      const surfaceVersion=layout.presentation?.version==='3.0'?3:layout.presentation?.version==='2.0'?2:1,converted=await settingsFromIntent(bundle.plan.session,result.intent,policy,layout,surfaceCompileContext(ctx,surfaceVersion));
      const files=[];
      for(const[name,value]of Object.entries({'session.json':bundle.plan.session,'policy.json':policy,'layout.json':layout,'content.json':converted.content,
        ...Object.fromEntries(Object.entries(converted.documents).map(([name,doc])=>[name+'.panel.json',doc]))})){
        const bytes=Buffer.from(json(value));await writeFile(join(result.directory,name),bytes,{flag:'wx'});files.push({file:name,sha256:hash(bytes)});
      }
      await writeFile(join(result.directory,'conversion.json'),json({status:'COMPILED',surfaceRecipesVersion:surfaceVersion,...converted.provenance,files,productionReady:false,visualAcceptance:'unreviewed'}),{flag:'wx'});
      console.log(JSON.stringify({status:'COMPILED',directory:result.directory,receipt:result.receipt}));
    }
    }catch(error){
      await writeFile(join(result.directory,'conversion.json'),json({status:'REJECTED',code:typeof error.code==='string'?error.code:'CONVERSION_FAILED',automaticRetries:0}),{flag:'wx'});
      throw error;
    }
  }
}catch(error){console.error(JSON.stringify({status:'FAILED',code:/^[A-Za-z0-9_.-]+$/.test(error.code??error.message)?error.code??error.message:'SETTINGS_MODEL_FAILED',receipt:error.receipt??null}));process.exitCode=1;}
