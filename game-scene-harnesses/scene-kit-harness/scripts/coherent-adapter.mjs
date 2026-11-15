import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {check} from '../src/generation/common.mjs';

// Optional host integration only. Keep transport state outside public plans/kits.
export async function createCoherentImageAdapter(root,options,{codexFactory,loadModule}={}){
  check(typeof root==='string'&&root.length>0&&Boolean(options.adapter)!==Boolean(options.adapterModule)
    &&(!options.adapter||options.adapter==='codex'),'COHERENT_ARGUMENTS');
  let adapter;
  if(options.adapter){
    if(!codexFactory)({createSceneCodexAdapter:codexFactory}=await import('../adapters/codex.mjs'));
    adapter=await codexFactory({workspace:join(resolve(root),'private-transport')});
  }else{
    const plugin=await(loadModule??(url=>import(url)))(pathToFileURL(resolve(options.adapterModule)).href);
    check(typeof plugin.createAdapter==='function','PIPELINE_ADAPTER_REQUIRED');adapter=await plugin.createAdapter();
  }
  check(adapter&&typeof adapter.preflight==='function'&&typeof adapter.generate==='function','PIPELINE_ADAPTER_REQUIRED');return adapter;
}
