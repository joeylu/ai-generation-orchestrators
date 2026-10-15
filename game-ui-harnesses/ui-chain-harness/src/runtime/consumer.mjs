// Candidate browser entry: use this bundled Pixi instance for host objects too.
export * from 'pixi.js';
export {createRuntime} from './runtime.mjs';
export {loadPngSkin} from './png-skin.mjs';
export {layoutBox} from './basic.mjs';
export {createFixtureSkin,reject} from './skin.mjs';
import {createRuntime} from './runtime.mjs';
import {loadPngSkin} from './png-skin.mjs';
export async function createComponentKit({app,data,onEvent}){
  const from64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)),p=data.skinPack;
  const skin=await loadPngSkin({manifestBytes:from64(p.manifest),manifestSha256:p.manifestSha256,expectedBindings:p.bindings,read:f=>from64(p.resources[f])});
  try{
    const runtime=createRuntime({app,registry:data.registry,usage:data.usage,skin,onEvent});
    return {runtime,skin,dispose(){runtime.dispose();skin.dispose();}};
  }catch(e){skin.dispose();throw e;}
}
