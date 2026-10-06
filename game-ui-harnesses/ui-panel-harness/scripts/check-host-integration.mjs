#!/usr/bin/env node
/** One deterministic regression command. No model, retry, deployment or game-project writes. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {createOutputDirectory,harnessRoot,readJson,writeNewJson} from '../src/io.mjs';
import {digestBytes,canonicalJson} from '../src/canonical.mjs';
import {validatePublicationReports} from './publish-unity-export.mjs';

const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){assert(['--workbench','--bundles','--output','--unity','--font','--kit','--companions','--native-evidence'].includes(args[i])&&args[i+1]&&!options[args[i].slice(2)],'HOST_INTEGRATION_ARGUMENTS');options[args[i].slice(2)]=resolve(args[i+1]);}
assert(['workbench','bundles','output'].every(key=>options[key]),'HOST_INTEGRATION_ARGUMENTS');
const nativeArgs=['unity','font','kit','companions'];assert(nativeArgs.every(key=>options[key])||nativeArgs.every(key=>!options[key]),'HOST_NATIVE_ARGUMENTS');assert(!options.unity||!options['native-evidence'],'HOST_NATIVE_MODE');
const output=await createOutputDirectory(options.output),report={version:'0.1',status:'RUNNING',modelCalls:0,automaticRetries:0,checks:[],evidence:[],native:{status:'NOT_RUN'}};
const slash=path=>path.replaceAll('\\','/'),pass=(name,detail)=>report.checks.push({name,status:'PASS',...detail});
async function evidence(path){const bytes=await readFile(path);report.evidence.push({path:slash(relative(harnessRoot,path)),bytes:bytes.length,sha256:await digestBytes(bytes)});}
async function run(name,argv){
 const log=join(output,name+'.log');let stdout='',stderr='';
 const code=await new Promise((resolveRun,reject)=>{const child=spawn(process.execPath,argv,{cwd:harnessRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);child.once('error',reject);child.once('close',resolveRun);});
 await writeFile(log,stdout+stderr,{flag:'wx'});await evidence(log);assert.equal(code,0,'HOST_STAGE_'+name.toUpperCase());return stdout;
}
try{
 const tests=(await readdir(join(harnessRoot,'tests'))).filter(file=>file.endsWith('.test.mjs')).sort().map(file=>'tests/'+file),unitOutput=await run('unit',['--test','--test-reporter=spec',...tests]),count=Number(unitOutput.match(/tests (\d+)/u)?.[1]);assert(count>0);assert.match(unitOutput,/fail 0/u);pass('all-fixture-and-core-unit-tests',{tests:count});console.log(JSON.stringify({stage:'unit',status:'PASS',tests:count}));
 const inputDirectory=join(output,'input');await mkdir(inputDirectory);
 const sources=[['settings','游戏设置','COM01'],['role','角色资料','COM02'],['loading-a','资源加载 A','COM03'],['loading-b','资源加载 B','COM03'],['role-copy','角色资料副本','COM02']];
 await writeNewJson(inputDirectory,'host-input.json',{hostDemoVersion:'0.1',instances:sources.map(([id,title,caseId])=>({id,title,bundleFile:slash(relative(inputDirectory,join(options.bundles,caseId,'generated-panel.bundle.json')))}))});
 for(const caseId of ['COM01','COM02','COM03'])await evidence(join(options.bundles,caseId,'generated-panel.bundle.json'));
 await run('build-host',['scripts/build-host-demo.mjs','--input',join(inputDirectory,'host-input.json'),'--output',join(output,'demo')]);
 await evidence(join(output,'demo/host-demo-build.json'));pass('verified-source-host-build');
 await run('host-browser',['scripts/check-host-browser.mjs','--demo',join(output,'demo'),'--output',join(output,'browser')]);
 const browser=await readJson(join(output,'browser/host-browser.json'));assert.equal(browser.status,'PASS');assert.equal(browser.totals.instances,5);assert.equal(browser.totals.lifecycleCycles,20);assert.equal(browser.modelCalls,0);await evidence(join(output,'browser/host-browser.json'));pass('five-simultaneous-pixi-instances-and-twenty-lifecycle-cycles',browser.totals);console.log(JSON.stringify({stage:'pixi-host',status:'PASS',...browser.totals}));
 await run('composite-browser',['scripts/check-composite-workbench-browser.mjs','--workbench',options.workbench,'--bundles',options.bundles,'--output',join(output,'composite')]);
 const composite=await readJson(join(output,'composite/composite-browser.json'));assert.equal(composite.status,'PASS');assert.equal(composite.modelRequests,0);assert.equal(composite.totals.passed,4);await evidence(join(output,'composite/composite-browser.json'));pass('studio-composite-import-edit-undo-export-regression',composite.totals);console.log(JSON.stringify({stage:'studio-composite',status:'PASS',...composite.totals}));
 await run('build-game',['scripts/build-game-demo.mjs','--bundles',options.bundles,'--output',join(output,'game-demo')]);await evidence(join(output,'game-demo/game-demo-build.json'));
 await run('game-browser',['scripts/check-game-browser.mjs','--demo',join(output,'game-demo'),'--output',join(output,'game-browser')]);const game=await readJson(join(output,'game-browser/game-browser.json'));assert.equal(game.status,'PASS');assert.equal(game.modelCalls,0);assert.equal(game.remoteRequests,0);await evidence(join(output,'game-browser/game-browser.json'));pass('web-audio-character-submit-and-verified-local-resource-load',game.totals);report.gameNativeEngines='NOT_RUN';console.log(JSON.stringify({stage:'game-ports',status:'PASS',...game.totals}));
 const workbenchBuild=await readJson(join(options.workbench,'workbench-build.json'));let deliveryChecks=0,simpleChecks=0;
 if(workbenchBuild.deliveryRuntime){
  await run('delivery-browser',['scripts/check-delivery-workbench-browser.mjs','--workbench',options.workbench,'--output',join(output,'delivery-browser')]);
  const delivery=await readJson(join(output,'delivery-browser/delivery-browser-report.json'));assert.equal(delivery.status,'PASS');assert.equal(delivery.modelCalls,0);deliveryChecks=delivery.checks.length;await evidence(join(output,'delivery-browser/delivery-browser-report.json'));pass('studio-complete-download-offline-use-and-reimport',{checks:deliveryChecks});
  await run('simple-studio',['scripts/check-simple-workbench-browser.mjs','--workbench',options.workbench,'--output',join(output,'simple-studio')]);
  const simple=await readJson(join(output,'simple-studio/simple-workbench-browser-report.json'));assert.equal(simple.status,'PASS');assert.equal(simple.providerCalls,0);simpleChecks=simple.checks.length;await evidence(join(output,'simple-studio/simple-workbench-browser-report.json'));pass('studio-visible-generate-edit-and-failure-preservation',{checks:simpleChecks});
  console.log(JSON.stringify({stage:'studio-delivery',status:'PASS',deliveryChecks,simpleChecks}));
 }
 let nativeDirectory=options['native-evidence'];
 if(options.unity){nativeDirectory=join(output,'native');await run('unity',['scripts/check-unity-coexistence.mjs',...nativeArgs.flatMap(key=>['--'+key,options[key]]),'--output',nativeDirectory,'--delivery',join(output,'unity-delivery'),'--host-test','true']);}
 if(nativeDirectory){
  const coexistence=await readJson(join(nativeDirectory,'coexistence-report.json')),validation=await readJson(join(nativeDirectory,'unity-validation.json')),smoke=await readJson(join(nativeDirectory,'unity-smoke.json')),host=await readJson(join(nativeDirectory,'unity-host-smoke.json'));
  validatePublicationReports(validation,smoke);assert.equal(coexistence.status,'PASS');assert.equal(coexistence.simultaneousPanelInteraction,'PASS');assert.equal(host.status,'PASS');assert.equal(host.cycles,20);assert.equal(host.instances,5);assert.equal(host.submitDeliveries,21);assert.equal(canonicalJson(host),canonicalJson(coexistence.host));
  assert.equal(validation.smokeSourceSha256,await digestBytes(await readFile(join(harnessRoot,'adapters/unity/Tests/Editor/PanelExportSmoke.cs'))),'HOST_NATIVE_SMOKE_SOURCE_CHANGED');assert.equal(coexistence.hostAdapter.sourceSha256,await digestBytes(await readFile(join(harnessRoot,'adapters/unity/HostRuntime/PanelInstanceHost.cs'))),'HOST_NATIVE_ADAPTER_CHANGED');assert.equal(coexistence.hostAdapter.metaSha256,await digestBytes(await readFile(join(harnessRoot,'adapters/unity/HostRuntime/PanelInstanceHost.cs.meta'))),'HOST_NATIVE_ADAPTER_META_CHANGED');
  for(const file of ['coexistence-report.json','unity-validation.json','unity-smoke.json','unity-host-smoke.json'])await evidence(join(nativeDirectory,file));
  report.native={status:'PASS',mode:options.unity?'fresh-isolated-run':'verified-previous-isolated-run',instances:host.instances,cycles:host.cycles,hostChecks:host.checks.length,nativeChecks:validation.checks.length,coexistenceChecks:coexistence.checks.length};pass('native-ugui-host-focus-callback-state-and-package-regression',report.native);
  if(coexistence.gameAdapter){
   const gameNative=await readJson(join(nativeDirectory,'unity-game-smoke.json'));assert.equal(gameNative.status,'PASS');assert.equal(canonicalJson(gameNative),canonicalJson(coexistence.game));assert.equal(coexistence.gameNative,'PASS');assert(gameNative.playMode&&gameNative.instances===5&&gameNative.cycles===10&&gameNative.decodedResources===2&&gameNative.modelCalls===0&&gameNative.checks.length>=20&&gameNative.checks.every(check=>check.status==='PASS'));
   const allowed=new Set(['GameRuntime/PanelGameBinding.cs','GameRuntime/MemoryPanelGamePort.cs','GameExamples/PanelGameExamplePorts.cs'].flatMap(path=>[path,path+'.meta']));assert.equal(coexistence.gameAdapter.files.length,allowed.size);
   for(const file of coexistence.gameAdapter.files){assert(file.path.startsWith('Assets/PanelHarness/'));const path=file.path.slice('Assets/PanelHarness/'.length);assert(allowed.delete(path));const bytes=await readFile(join(harnessRoot,'adapters/unity',path));assert.equal(bytes.length,file.bytes);assert.equal(await digestBytes(bytes),file.sha256,'GAME_NATIVE_ADAPTER_CHANGED');}
   assert.equal(coexistence.gameAdapter.testSourceSha256,await digestBytes(await readFile(join(harnessRoot,'adapters/unity/Tests/Editor/PanelGameBindingSmoke.cs'))),'GAME_NATIVE_SMOKE_CHANGED');assert.equal(coexistence.gameInputSha256,await digestBytes(await readFile(join(nativeDirectory,'project/Assets/PanelHarness/Kit/game-instances.json'))),'GAME_NATIVE_INPUT_CHANGED');
   await evidence(join(nativeDirectory,'unity-game-smoke.json'));report.gameNativeEngines='PASS';report.native.gameChecks=gameNative.checks.length;pass('native-ugui-game-audio-submit-cancel-load-and-remount-regression',{checks:gameNative.checks.length,mode:report.native.mode});
  }
 }
 report.status='PASS';report.totals={unitTests:count,pixiHostChecks:browser.totals.checks,compositeChecks:composite.totals.checks,gameChecks:game.totals.checks,deliveryChecks,simpleChecks,nativeChecks:report.native.nativeChecks??0,coexistenceChecks:report.native.coexistenceChecks??0,nativeGameChecks:report.native.gameChecks??0};
}catch(error){report.status='FAIL';report.failure=String(error.message).slice(0,400);process.exitCode=1;}
finally{await writeNewJson(output,'host-integration.json',report);console.log(JSON.stringify({status:report.status,...report.totals,native:report.native.status,failure:report.failure,modelCalls:0}));}
