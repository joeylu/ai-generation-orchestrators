#!/usr/bin/env node
/** Verified optional shared SDK. It never opens Unity or modifies a consumer project. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createOutputDirectory,harnessRoot,readJson,writeNewJson,jsonFileBytes} from '../src/io.mjs';
import {digestBytes,digestJson,canonicalJson} from '../src/canonical.mjs';
import {validatePublicationReports} from './publish-unity-export.mjs';
const options={},args=process.argv.slice(2);for(let i=0;i<args.length;i+=2){assert(['--output','--native-evidence'].includes(args[i])&&args[i+1]&&!options[args[i].slice(2)],'UNITY_GAME_SDK_ARGUMENTS');options[args[i].slice(2)]=resolve(args[i+1]);}assert(options.output&&options['native-evidence'],'UNITY_GAME_SDK_ARGUMENTS');
const directory=options['native-evidence'],report=await readJson(join(directory,'coexistence-report.json')),game=await readJson(join(directory,'unity-game-smoke.json')),validation=await readJson(join(directory,'unity-validation.json'));
validatePublicationReports(validation,await readJson(join(directory,'unity-smoke.json')));
assert.equal(validation.smokeSourceSha256,await digestBytes(await readFile(join(harnessRoot,'adapters/unity/Tests/Editor/PanelExportSmoke.cs'))));assert.equal(report.status,'PASS');assert.equal(report.gameNative,'PASS');assert.equal(game.status,'PASS');assert(game.playMode&&game.instances===5&&game.cycles===10&&game.decodedResources===2&&game.modelCalls===0&&game.automaticRetries===0&&game.checks.length>=20&&game.checks.every(check=>check.status==='PASS'));assert.equal(canonicalJson(game),canonicalJson(report.game));
assert.equal(report.gameAdapter.testSourceSha256,await digestBytes(await readFile(join(harnessRoot,'adapters/unity/Tests/Editor/PanelGameBindingSmoke.cs'))));
const contents=[],sources=['GameRuntime/PanelGameBinding.cs','GameRuntime/MemoryPanelGamePort.cs','GameExamples/PanelGameExamplePorts.cs','HostRuntime/PanelInstanceHost.cs'];
const expected=new Map(report.gameAdapter.files.map(file=>[file.path,file]));assert.equal(expected.size,6);
for(const source of sources)for(const suffix of ['','.meta']){
 const path='Assets/PanelHarness/'+source+suffix,bytes=await readFile(join(harnessRoot,'adapters/unity',source+suffix)),sha256=await digestBytes(bytes);
 if(source.startsWith('HostRuntime/'))assert.equal(sha256,suffix?report.hostAdapter.metaSha256:report.hostAdapter.sourceSha256);
 else{const file=expected.get(path);assert(file&&file.bytes===bytes.length&&file.sha256===sha256,'UNITY_GAME_SDK_SOURCE_CHANGED');expected.delete(path);}
 contents.push({path,bytes});
}
assert.equal(expected.size,0);
const inputBytes=await readFile(join(directory,'project/Assets/PanelHarness/Kit/game-instances.json'));assert.equal(await digestBytes(inputBytes),report.gameInputSha256);const input=JSON.parse(inputBytes.toString('utf8'));assert(input.version==='0.1'&&input.instances.length===5);const documents=new Set();
for(const source of input.instances){
 assert(/^[a-z][a-z-]{0,40}$/.test(source.id));assert(/^[a-z][a-z-]{0,80}$/.test(source.document.panelId));assert.equal(source.binding.panelSha256,source.document.panelSha256);
 const common={gameBindingVersion:'0.1',panelId:source.binding.panelId,panelSha256:source.binding.panelSha256,states:source.binding.states,commands:source.binding.commands.map(command=>({...command,payload:Object.fromEntries(command.payload.map(route=>[route.key,route.fieldId]))}))};assert.equal(await digestJson(common),source.binding.sourceBindingSha256);
 contents.push({path:'Examples/Bindings/'+source.id+'.game-binding.unity.json',bytes:jsonFileBytes(source.binding)});
 if(!documents.has(source.document.panelId)){documents.add(source.document.panelId);contents.push({path:'Examples/Documents/'+source.document.panelId+'.panel.unity.json',bytes:jsonFileBytes(source.document)});}
}
contents.push({path:'README.md',bytes:await readFile(join(harnessRoot,'docs/unity-game-binding.md'))});
const output=await createOutputDirectory(options.output);
for(const file of contents){await mkdir(dirname(join(output,file.path)),{recursive:true});await writeFile(join(output,file.path),file.bytes,{flag:'wx'});}
await writeNewJson(output,'unity-game-sdk.json',{version:'0.1.0',status:'COMPLETE',target:'unity-ugui',requiredPanelRuntime:'0.1.4',sharedCoreScripts:3,optionalExampleScripts:1,modelCalls:0,productionRelease:false,verification:{native:'PASS',nativeChecks:game.checks.length,instances:game.instances,remountCycles:game.cycles,evidenceSha256:await digestBytes(await readFile(join(directory,'coexistence-report.json')))},files:await Promise.all(contents.map(async file=>({path:file.path,bytes:file.bytes.length,sha256:await digestBytes(file.bytes)})))});
console.log(JSON.stringify({status:'UNITY_GAME_SDK_EXPORTED',sharedCoreScripts:3,optionalExampleScripts:1,files:contents.length,native:'PASS',modelCalls:0}));
