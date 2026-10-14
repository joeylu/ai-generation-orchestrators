/** Explicit deterministic variants and separate public stress fixtures; no model calls. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {harnessRoot,readJson,writeNewJson,createOutputDirectory} from '../src/io.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--output'&&args[2]==='--stress-output');
const run=resolve(harnessRoot,'output/panel-copy-real-v1'),plan=await readJson(resolve(harnessRoot,'output/panel-copy-plan-v1/input-adaptability-plan.json'));
const audit=await readJson(resolve(harnessRoot,'output/panel-copy-audit-v1/audit.json')),bytes=await readFile(join(run,'input-adaptability-report.json')),original=JSON.parse(bytes);
assert.equal(plan.sha256,'4e3419e8a82b46b362ec0c4ec3a78d76e827935182703dd6f5e61bd5ae353311');assert.equal(original.planSha256,plan.sha256);
assert.equal(audit.sourceReportSha256,await digestBytes(bytes));assert.equal(audit.sourceFingerprint,'PASS');assert.equal(audit.receiptIntegrity,'PASS');assert.equal(original.realModelCalls,8);
const core=await loadWorkspaceCore(),runtime=await buildDeliveryRuntime(),unity=await readUnityAdapterSources(),catalog=await readJson(resolve(harnessRoot,'examples/modern-compact-message.catalog.json'));
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)],parents=[];
async function deliver(directory,id,bundle,evidence){
  await validatePanelBundle(bundle,core);const target=await createOutputDirectory(join(directory,id)),kit=await createUnityKitFiles(bundle,core,unity),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit}),zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
  for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
  await writeNewJson(target,'panel.bundle.json',bundle);await writeNewJson(target,'variant-evidence.json',evidence);await writeFile(join(target,'panel.zip'),zip,{flag:'wx'});
  for(const [path,data]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(path)&&path.split('/').every(part=>part&&!['.','..'].includes(part)));await mkdir(dirname(join(target,'delivery',path)),{recursive:true});await writeFile(join(target,'delivery',path),data,{flag:'wx'});}
  return {id,status:'PASS',outcome:'EXPLICIT_OFFLINE_COMPACT_VARIANT',bundleSha256:bundle.sha256,...evidence,delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)}};
}
const output=await createOutputDirectory(args[1]),results=[];
for(const entry of plan.cases){
  const before=await validatePanelBundle(await readJson(join(run,entry.id,'panel.bundle.json')),core);assert.equal(before.sha256,audit.cases.find(value=>value.id===entry.id).panelSha256);parents.push(before);
  const spec=structuredClone(before.spec),compact=entry.stability.purpose==='exit-confirmation';
  if(compact)for(const row of spec.sections.flatMap(section=>section.rows))if(row.kind==='text'){assert.equal(row.recipe.id,'message.text');row.recipe.version='0.2.0';}
  const selectedCatalog=compact?{...catalog,themes:before.catalog.themes}:before.catalog;
  if(compact){const measured=await createPanelBundle(spec,selectedCatalog,core,before.state,panelBundleAssetInputs(before,core));assert.equal(spec.frame,null);spec.canvas.height=Math.ceil(flatten(measured.componentBundle.document.root).find(node=>node.id===spec.id+'.panel').layout.height)+64;}
  const bundle=await createPanelBundle(spec,selectedCatalog,core,before.state,panelBundleAssetInputs(before,core));
  for(const key of ['actions','bindings','state','assetClosure'])assert.deepEqual(bundle[key],before[key]);if(!compact)assert.deepEqual(bundle,before);
  results.push(await deliver(output,entry.id,bundle,{kind:'EXPLICIT_OFFLINE_LAYOUT_VARIANT_NOT_ORIGINAL_MODEL_RESULT',sourceBundleSha256:before.sha256,changed:compact,originalAttemptsAndStatusesPreserved:true,realModelCalls:0,
    adoption:compact?{recipe:'message.text@0.2.0',canvasHeight:{from:before.spec.canvas.height,to:bundle.spec.canvas.height},policy:'EXPLICIT_INTRINSIC_PANEL_PLUS_64_CANVAS_MARGIN'}:null}));
}
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',treatment:'EXPLICIT_COMPACT_MESSAGE_REPLAY',cohort:'panel-compact-message-v1',status:'PASS_BEFORE_BROWSER',sourcePlanSha256:plan.sha256,sourceReportSha256:audit.sourceReportSha256,
  planSha256:await digestJson(results.map(value=>({id:value.id,bundle:value.bundleSha256,parent:value.sourceBundleSha256}))),realModelCalls:0,originalRealModelCalls:8,automaticRetries:0,sourceCases:plan.cases.map(({id,stability})=>({id,stability})),results});
const stress=await createOutputDirectory(args[3]),stressResults=[],seed=parents.find(bundle=>bundle.spec.id==='S08');
const recipes={id:'message.text',version:'0.2.0'},buttonStyle={backgroundColor:null,textColor:null,borderColor:null,borderWidth:null,cornerRadius:null,width:null,height:null,shape:null};
const scenarios=[
  {id:'L01',name:'长中文段落',edit:spec=>{spec.sections[0].rows[0].text='这是一段完整说明，请仔细确认当前操作，相关信息应该完整保留并允许阅读。'.repeat(9);}},
  {id:'L02',name:'英文与长词换行',edit:spec=>{spec.sections[0].rows[0].text='Confirm returning to the main menu. Current progress may be saved by the host. Supercalifragilisticexpialidocious'.repeat(3);}},
  {id:'L03',name:'明确段落及空行',edit:spec=>{spec.sections[0].rows[0].text='是否继续？\n\n请先阅读完整说明。\n当前选择仍由用户决定。';}},
  {id:'L04',name:'普通数据标签保留',edit:spec=>{spec.sections[0].rows.splice(1,0,{...spec.sections[0].rows[0],id:'coins',recipe:{id:'settings.text',version:'0.1.0'},label:'金币',text:'100'});}},
  {id:'L05',name:'固定框400高',edit:spec=>{spec.frame={width:480,height:400};spec.layout.maxHeight=400;spec.canvas.height=464;}},
  {id:'L06',name:'过宽按钮改为纵向',edit:spec=>{spec.buttonStyles=spec.sections[0].rows.filter(row=>row.kind==='button').map(row=>({rowId:row.id,style:{...buttonStyle,width:300}}));}},
  {id:'L07',name:'窄版与两行问句',edit:spec=>{spec.layout.width=360;spec.canvas.width=424;spec.sections[0].rows[0].text='确定要结束当前挑战并返回游戏开始界面吗？';}},
  {id:'L08',name:'明确正文缩进',edit:spec=>{spec.sections[0].rows[0].text='  这是带有明确缩进的确认消息，缩进应保留。';}},
];
for(const scenario of scenarios){const spec=structuredClone(seed.spec);spec.id=scenario.id;spec.provenance={kind:'programmatic-fixture',description:'Offline compact message stress fixture; not a new model response or a user requirement.',assumptions:[]};spec.sections[0].rows[0].recipe=recipes;spec.canvas.height=1400;spec.layout.maxHeight=1300;scenario.edit(spec);
  const bundle=await createPanelBundle(spec,{...catalog,themes:seed.catalog.themes},core,seed.state);stressResults.push(await deliver(stress,scenario.id,bundle,{kind:'PROGRAMMATIC_STRESS_FIXTURE_NOT_MODEL_RESULT',scenario:scenario.name,realModelCalls:0}));}
await writeNewJson(stress,'input-adaptability-report.json',{kind:'DETERMINISTIC_PROGRAMMATIC_STRESS_NOT_MODEL_RESULTS',cohort:'compact-message-stress-offline',status:'PASS_BEFORE_BROWSER',planSha256:await digestJson(stressResults.map(value=>({id:value.id,bundle:value.bundleSha256}))),realModelCalls:0,automaticRetries:0,results:stressResults});
console.log(JSON.stringify({originalReplay:results.length,changed:results.filter(value=>value.changed).length,stressFixtures:stressResults.length,realModelCalls:0}));
