import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from '../../ui-component-harness/node_modules/vite/dist/node/index.js';
import {harnessRoot} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
export async function buildDeliveryRuntime(){
 const result=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,sourcemap:false,lib:{entry:fileURLToPath(new URL('../src/delivery-runtime.mjs',import.meta.url)),name:'PanelDelivery',formats:['iife'],fileName:()=> 'panel-runtime.js'}}});
 const chunks=(Array.isArray(result)?result:[result]).flatMap(item=>item.output);assert(chunks.length===1&&chunks[0].type==='chunk'&&!chunks[0].imports.length&&chunks[0].dynamicImports.every(path=>path==='panel-runtime.js'),'DELIVERY_RUNTIME_BUILD');
 const code=chunks[0].code,sha256=await digestBytes(new TextEncoder().encode(code));
 const license=await readFile(new URL('../../ui-component-harness/node_modules/pixi.js/LICENSE',import.meta.url),'utf8');
 return{version:'0.1.0',code,sha256,notices:'PixiJS\n\n'+license};
}
