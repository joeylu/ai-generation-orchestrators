#!/usr/bin/env node
/** Deterministic workspace delivery; no model, Unity or game project writes. */
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {readJson,createOutputDirectory} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
const options={},args=process.argv.slice(2);
try{
 for(let i=0;i<args.length;i+=2){if(!['--bundle','--output'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('DELIVERY_ARGUMENTS');options[args[i]]=args[i+1];}
 if(Object.keys(options).length!==2)throw Error('DELIVERY_ARGUMENTS');
 const core=await loadWorkspaceCore(),bundle=await readJson(options['--bundle']);
 const unityKit=await createUnityKitFiles(bundle,core,await readUnityAdapterSources()),runtime=await buildDeliveryRuntime();
 const delivery=await createPanelDelivery(bundle,core,{runtime,unityKit}),zip=createStoredZip(delivery.contents);
 const output=await createOutputDirectory(options['--output']);
 for(const [path,bytes]of delivery.contents){const target=resolve(output,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});}
 await writeFile(resolve(output,delivery.panelId+'.panel-delivery.zip'),zip,{flag:'wx'});
 console.log(JSON.stringify({status:'PANEL_DELIVERY_BUILT',panelSha256:delivery.manifest.panelSha256,files:delivery.contents.size,modelCalls:0,unityImport:'NOT_RUN'}));
}catch(error){const value=error.code??error.message;console.error(JSON.stringify({status:'FAILED',code:/^[A-Z][A-Z0-9_]{0,79}$/.test(value)?value:'DELIVERY_FAILED'}));process.exitCode=1;}
