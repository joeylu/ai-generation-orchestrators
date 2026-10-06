#!/usr/bin/env node
/** Import verified companion packages into a new isolated Unity acceptance project. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {digestBytes} from '../src/canonical.mjs';
import {readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {prepareUnityValidation,runUnityValidation} from './check-unity-export.mjs';
import {readManagedUnityPackage,readNativeFile} from './unity-package-evidence.mjs';
import {publishUnityExport} from './publish-unity-export.mjs';
import {checkUnityInstall} from './check-unity-install.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {createUnityGameBinding} from '../src/unity-game-binding.mjs';
import {GAME_ROUTE_TEMPLATES} from '../examples/game-integration-v1/bindings.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--unity','--font','--kit','--companions','--output','--delivery','--host-test','--game-test'].includes(args[i])&&args[i+1]&&!options[args[i].slice(2)],'UNITY_COEXISTENCE_ARGUMENTS');options[args[i].slice(2)]=args[i+1];}
assert(['unity','font','kit','companions','output','delivery'].every(key=>options[key])&&(!options['host-test']||options['host-test']==='true'),'UNITY_COEXISTENCE_ARGUMENTS');
assert(!options['game-test']||(options['game-test']==='true'&&options['host-test']==='true'),'UNITY_GAME_ARGUMENTS');
const inputPath=resolve(options.companions),input=await readJson(inputPath);assert.deepEqual(Object.keys(input),['deliveries']);assert(Array.isArray(input.deliveries)&&input.deliveries.length>=1&&input.deliveries.length<=8);
const companions=[],panelIds=new Set(),guids=new Map(),files=new Map();
for(const relative of input.deliveries){
 assert(typeof relative==='string'&&relative.length<512,'UNITY_COMPANION_PATH');const delivery=resolve(dirname(inputPath),relative),manifest=await readJson(join(delivery,'delivery.json'));assert.equal(manifest.status,'COMPLETE');assert.equal(manifest.target,'unity-ugui');
 const record=manifest.files.find(f=>f.path==='panel.unitypackage'),bytes=await readNativeFile(join(delivery,'panel.unitypackage'));assert.equal(bytes.length,record.bytes);assert.equal(await digestBytes(bytes),record.sha256);assert(manifest.sourceEvidence.prefab.path.startsWith('project/'));
 const managed=await readManagedUnityPackage(bytes,manifest.sourceEvidence.prefab.path.slice(8));assert.equal(managed.identity.panelSha256,manifest.panelSha256);assert(!panelIds.has(managed.identity.panelId),'UNITY_COMPANION_DUPLICATE_PANEL');panelIds.add(managed.identity.panelId);
 for(const [path,file]of managed.files){assert(!guids.has(file.guid)||guids.get(file.guid)===path,'UNITY_COMPANION_GUID_COLLISION');guids.set(file.guid,path);if(files.has(path)){assert(path.startsWith('Assets/PanelHarness/Runtime/'),'UNITY_COMPANION_RESOURCE_COLLISION');assert(file.bytes.equals(files.get(path).bytes)&&file.meta.equals(files.get(path).meta),'UNITY_COMPANION_RUNTIME_CONFLICT');}else files.set(path,file);}
 companions.push({delivery,managed,packageSha256:record.sha256});
}
const prepared=await prepareUnityValidation({...options,render:true,audio:options['game-test']==='true'});
const report={version:'0.1',status:'RUNNING',providerCalls:0,modelCalls:0,automaticRetries:0,checks:[],companions:companions.map(c=>({panelId:c.managed.identity.panelId,packageSha256:c.packageSha256,prefabGuid:c.managed.identity.prefabGuid,runtimeSha256:c.managed.identity.runtimeSha256})),nativeSharedProjectImport:'NOT_RUN',simultaneousPanelInteraction:'NOT_RUN'};
const pass=name=>report.checks.push({name,status:'PASS'}),before=[];
try{
 const main=await readJson(join(prepared.project,'Assets/PanelHarness/Kit/panel.unity.json'));assert(!panelIds.has(main.panelId),'UNITY_COMPANION_MAIN_PANEL_COLLISION');
 for(const c of companions)assert.equal(c.managed.identity.runtimeSha256,prepared.report.runtimeIdentity.runtimeSha256,'UNITY_COMPANION_RUNTIME_VERSION');pass('all-panels-share-exact-runtime-version');
 for(const [path,file]of files){const target=join(prepared.project,path);await mkdir(dirname(target),{recursive:true});let existing;try{existing=await readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing){assert(path.startsWith('Assets/PanelHarness/Runtime/'),'UNITY_COMPANION_EXISTING_PANEL');assert(existing.equals(file.bytes),'UNITY_COMPANION_RUNTIME_BYTES');const meta=await readFile(target+'.meta');assert.equal(meta.toString('utf8').replace(/\r\n/g,'\n'),file.meta.toString('utf8').replace(/\r\n/g,'\n'),'UNITY_COMPANION_RUNTIME_META');}
  else{await writeFile(target,file.bytes,{flag:'wx'});await writeFile(target+'.meta',file.meta,{flag:'wx'});}
  before.push({path,assetSha256:await digestBytes(file.bytes),metaText:file.meta.toString('utf8').replace(/\r\n/g,'\n')});
 }pass('verified-packages-merged-with-shared-scripts-and-distinct-panel-folders');
 if(options['host-test']){
  // Optional shared host SDK; existing generated Runtime identity stays intact.
  const hostSource=await readNativeFile(join(harnessRoot,'adapters/unity/HostRuntime/PanelInstanceHost.cs')),hostMeta=await readNativeFile(join(harnessRoot,'adapters/unity/HostRuntime/PanelInstanceHost.cs.meta'));
  const sdkFolder=join(prepared.project,'Assets/PanelHarness/HostRuntime');await mkdir(sdkFolder);await writeFile(join(sdkFolder,'PanelInstanceHost.cs'),hostSource,{flag:'wx'});await writeFile(join(sdkFolder,'PanelInstanceHost.cs.meta'),hostMeta,{flag:'wx'});
  await writeFile(join(prepared.project,'Assets/csc.rsp'),'-define:PANEL_HOST_ACCEPTANCE'+(options['game-test']?',PANEL_GAME_ACCEPTANCE':'')+'\n',{flag:'wx'});
  report.hostAdapter={version:'0.1.0',sourceSha256:await digestBytes(hostSource),metaSha256:await digestBytes(hostMeta),scripts:1};
  const core=await loadWorkspaceCore(),instances=[{id:'main',prefab:prepared.panelOutput+'/'+main.nodes[0].id+'.prefab',document:main}],sourceBundles=new Map();
  for(let index=0;index<companions.length;index++){
   const companion=companions[index],manifest=await readJson(join(companion.delivery,'delivery.json')),record=manifest.files.find(file=>file.path==='panel.bundle.json'),bytes=await readNativeFile(join(companion.delivery,'panel.bundle.json'));
   assert(record&&bytes.length===record.bytes&&await digestBytes(bytes)===record.sha256,'UNITY_COMPANION_BUNDLE_INTEGRITY');
   const bundle=JSON.parse(bytes.toString('utf8')),document=await createUnityDocument(bundle,core);assert.equal(document.panelSha256,companion.managed.identity.panelSha256);sourceBundles.set(document.panelId,bundle);
   const item={id:'companion-'+index,prefab:manifest.sourceEvidence.prefab.path.slice(8),document};instances.push(item);
   if(document.controls.some(control=>control.kind==='input'))instances.push({...item,id:'input-copy'});
  }
  assert(instances.length>=3&&instances.length<=10&&instances.filter(item=>item.document.controls.some(control=>control.kind==='input')).length===2,'UNITY_HOST_FIXTURE_SHAPE');
  await writeNewJson(join(prepared.project,'Assets/PanelHarness/Kit'),'host-instances.json',{version:'0.1',cycles:20,instances});
  if(options['game-test']){
   const gameFiles=[];
   for(const relative of ['GameRuntime/PanelGameBinding.cs','GameRuntime/MemoryPanelGamePort.cs','GameExamples/PanelGameExamplePorts.cs'])for(const suffix of ['','.meta']){
    const bytes=await readNativeFile(join(harnessRoot,'adapters/unity',relative+suffix)),path='Assets/PanelHarness/'+relative+suffix;
    await mkdir(dirname(join(prepared.project,path)),{recursive:true});await writeFile(join(prepared.project,path),bytes,{flag:'wx'});gameFiles.push({path,bytes:bytes.length,sha256:await digestBytes(bytes)});
   }
   const testSource=await readNativeFile(join(harnessRoot,'adapters/unity/Tests/Editor/PanelGameBindingSmoke.cs'));
   await writeFile(join(prepared.project,'Assets/Tests/Editor/PanelGameBindingSmoke.cs'),testSource,{flag:'wx'});
   report.gameAdapter={version:'0.1.0',scripts:3,files:gameFiles,testSourceSha256:await digestBytes(testSource)};
   const gameInstances=[];
   for(const [id,template]of [['settings',GAME_ROUTE_TEMPLATES.settings],['role',GAME_ROUTE_TEMPLATES.role],['role-copy',GAME_ROUTE_TEMPLATES.role],['loading-a',GAME_ROUTE_TEMPLATES.loading],['loading-b',GAME_ROUTE_TEMPLATES.loading]]){
    const source=instances.find(item=>item.document.panelId===template.panelId),bundle=sourceBundles.get(template.panelId);assert(source&&bundle,'UNITY_GAME_FIXTURE_SOURCE');
    const binding=await createUnityGameBinding({gameBindingVersion:'0.1',...template,panelSha256:bundle.sha256},bundle);
    gameInstances.push({id,prefab:source.prefab,document:source.document,binding});
   }
   const resources=[],resourceIds=new Set();
   for(const bundle of sourceBundles.values())for(const resource of bundle.componentBundle.resources){
    if(resourceIds.has(resource.sha256))continue;resourceIds.add(resource.sha256);const bytes=Buffer.from(resource.base64,'base64');assert.equal(await digestBytes(bytes),resource.sha256,'UNITY_GAME_RESOURCE_INTEGRITY');
    const path='Assets/PanelHarness/GameTest/Resources/'+resource.sha256+'.png';await mkdir(dirname(join(prepared.project,path)),{recursive:true});await writeFile(join(prepared.project,path),bytes,{flag:'wx'});resources.push({path,sha256:resource.sha256});
   }
   assert.equal(resources.length,2,'UNITY_GAME_RESOURCE_COUNT');await writeNewJson(join(prepared.project,'Assets/PanelHarness/Kit'),'game-instances.json',{version:'0.1',instances:gameInstances,resources});
   report.gameInputSha256=await digestBytes(await readFile(join(prepared.project,'Assets/PanelHarness/Kit/game-instances.json')));
  }
 }
 const result=await runUnityValidation(prepared);assert.equal(result.status,'PASS','UNITY_MAIN_SMOKE_FAILED');report.nativeChecks=result.checks.length;report.editorVersion=result.editor.version;report.nativeSharedProjectImport='PASS';pass('unity-opens-isolated-project-containing-all-panel-prefabs');
 if(options['host-test']){const host=await readJson(join(prepared.output,'unity-host-smoke.json'));assert.equal(host.status,'PASS','UNITY_HOST_SMOKE_FAILED');assert.equal(host.cycles,20);assert(host.instances>=3&&host.checks.length>=6&&host.checks.every(check=>check.status==='PASS'));report.host=host;report.simultaneousPanelInteraction='PASS';pass('simultaneous-native-panels-state-event-focus-and-lifecycle-isolation');}
 if(options['game-test']){const game=await readJson(join(prepared.output,'unity-game-smoke.json'));assert.equal(game.status,'PASS','UNITY_GAME_SMOKE_FAILED');assert(game.playMode&&game.instances===5&&game.cycles===10&&game.decodedResources===2&&game.modelCalls===0&&game.automaticRetries===0&&game.checks.length>=20&&game.checks.every(check=>check.status==='PASS'));report.game=game;report.gameNative='PASS';pass('native-audio-form-submit-and-local-resource-loading-game-bindings');}
 for(const f of before){assert.equal(await digestBytes(await readNativeFile(join(prepared.project,f.path))),f.assetSha256);assert.equal((await readNativeFile(join(prepared.project,f.path+'.meta'))).toString('utf8').replace(/\r\n/g,'\n'),f.metaText);}pass('companion-prefabs-assets-metadata-and-script-bytes-retained');
 const publication=await publishUnityExport({validation:prepared.output,output:options.delivery});report.publication=publication;pass('main-native-package-passes-unmodified-publication-gates');
 report.installs=[];for(const delivery of [...companions.map(c=>c.delivery),resolve(options.delivery)]){const installation=await checkUnityInstall({delivery,project:prepared.project});assert.equal(installation.action,'ALREADY_INSTALLED');assert.equal(installation.writes,0);report.installs.push(installation);}pass('every-panel-install-preflight-already-installed-with-zero-writes');
 report.totals={panels:panelIds.size+1,sharedScripts:[...files.keys()].filter(p=>p.startsWith('Assets/PanelHarness/Runtime/')).length,checks:report.checks.length};report.status='PASS';
}catch(error){report.status='FAIL';report.failure=String(error.code??error.message).slice(0,180);process.exitCode=1;}
finally{await writeNewJson(prepared.output,'coexistence-report.json',report);console.log(JSON.stringify({status:report.status,...report.totals,nativeChecks:report.nativeChecks,failure:report.failure,modelCalls:0}));}
