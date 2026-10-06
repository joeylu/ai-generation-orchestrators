import {createMemoryGamePort} from './game-port.mjs';
import {digestBytes} from './canonical.mjs';

function error(code){const cause=new Error(code);cause.code=code;return cause;}
export function waitForGameStep(milliseconds,signal){return new Promise((resolve,reject)=>{let timer;const aborted=()=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);reject(new DOMException('Cancelled','AbortError'));};if(signal?.aborted){aborted();return;}timer=setTimeout(()=>{signal?.removeEventListener('abort',aborted);resolve();},milliseconds);signal?.addEventListener('abort',aborted,{once:true});});}
const percentage=value=>Number.isInteger(value)&&value>=0&&value<=100;

/** Web Audio gain buses. No autoplay, oscillator, generated media or game-project writes. */
export function createBrowserAudioGamePort(initialState){
 let context,nodes,disposed=false;
 const port=createMemoryGamePort({initialState,validate:state=>{if(!['volume','musicVolume','effectsVolume'].every(key=>percentage(state[key]))||typeof state.muted!=='boolean')throw error('AUDIO_STATE_INVALID');}});
 const apply=state=>{if(!nodes)return;nodes.master.gain.value=state.muted?0:state.volume/100;nodes.music.gain.value=state.musicVolume/100;nodes.effects.gain.value=state.effectsVolume/100;};
 const detach=port.subscribe(apply);
 return Object.freeze({port,
  async open(){if(disposed)throw error('AUDIO_PORT_DESTROYED');if(!context){const Audio=globalThis.AudioContext??globalThis.webkitAudioContext;if(!Audio)throw error('AUDIO_UNAVAILABLE');context=new Audio();nodes={master:context.createGain(),music:context.createGain(),effects:context.createGain()};nodes.music.connect(nodes.master);nodes.effects.connect(nodes.master);nodes.master.connect(context.destination);apply(port.getSnapshot());}await context.resume();if(disposed)throw error('AUDIO_PORT_DESTROYED');return context.state;},
  connect(source,bus='master'){if(!nodes||!Object.hasOwn(nodes,bus)||source?.context!==context)throw error('AUDIO_SOURCE_INVALID');source.connect(nodes[bus]);return()=>source.disconnect(nodes[bus]);},
  inspect:()=>({contextState:context?.state??'NOT_OPENED',gainNodes:nodes?3:0,masterGain:nodes?.master.gain.value??null,musicGain:nodes?.music.gain.value??null,effectsGain:nodes?.effects.gain.value??null}),
  async destroy(){if(disposed)return;disposed=true;detach();port.destroy();if(nodes)for(const node of Object.values(nodes))node.disconnect();nodes=null;if(context&&context.state!=='closed')await context.close();},
 });
}

/** Reference in-memory character application. Submission is async; no persistence. */
export function createCharacterGamePort({delayMs=200}={}){
 let port,generation=0;
 port=createMemoryGamePort({initialState:{draftName:'',draftDeclaration:'',savedName:'',savedDeclaration:'',commits:0,status:'IDLE',error:''},validate:state=>{if(!['draftName','draftDeclaration','savedName','savedDeclaration','status','error'].every(key=>typeof state[key]==='string')||!Number.isInteger(state.commits)||state.commits<0)throw error('ROLE_STATE_INVALID');},commands:{
  'profile.submit':async({name,declaration},ctx)=>{if(typeof name!=='string'||name.trim().length<2||name.length>12||typeof declaration!=='string'||declaration.length>30)throw error('ROLE_FIELDS_INVALID');const token=++generation;ctx.update({status:'SUBMITTING',error:''});try{await waitForGameStep(delayMs,ctx.signal);if(name.trim()==='已存在'){ctx.update({status:'FAILED',error:'ROLE_NAME_EXISTS'});throw error('ROLE_NAME_EXISTS');}const previous=ctx.getSnapshot();ctx.update({savedName:name,savedDeclaration:declaration,commits:previous.commits+1,status:'SAVED',error:''});return{name,declaration};}catch(cause){if(cause.name==='AbortError'&&token===generation&&port.inspect().alive)port.update({status:'CANCELLED'});throw cause;}},
  'profile.cancel':async(_,ctx)=>{port.cancel('profile.submit');ctx.update({status:'CANCELLED',error:''});},
 }});return port;
}

/** Verify and decode the page's embedded PNG assets; percentage comes from completed bytes. */
export async function decodeLocalGameResource(resource,signal){
 signal.throwIfAborted();const bytes=Uint8Array.from(atob(resource.base64),character=>character.charCodeAt(0));
 if(resource.mime!=='image/png'||await digestBytes(bytes)!==resource.sha256)throw error('LOAD_RESOURCE_INTEGRITY');signal.throwIfAborted();
 const bitmap=await createImageBitmap(new Blob([bytes],{type:resource.mime}));try{signal.throwIfAborted();if(bitmap.width<=0||bitmap.height<=0)throw error('LOAD_RESOURCE_DECODE');return bytes.length;}finally{bitmap.close();}
}

export function createLocalLoadingGamePort(resources,{stepMs=500,decode=decodeLocalGameResource}={}){
 if(!Array.isArray(resources)||!resources.length||typeof decode!=='function'||!Number.isFinite(stepMs)||stepMs<0)throw error('LOAD_PORT_OPTIONS');
 const size=resource=>atob(resource.base64).length,totalBytes=resources.reduce((total,resource)=>total+size(resource),0);let port,generation=0;
 port=createMemoryGamePort({initialState:{progress:25,downloaded:50,promptSound:true,loadedResources:0,loadedBytes:0,totalBytes,status:'IDLE',error:''},validate:state=>{if(!Number.isFinite(state.progress)||state.progress<0||state.progress>100||!Number.isFinite(state.downloaded)||state.downloaded<0||state.downloaded>250||typeof state.promptSound!=='boolean'||!['loadedResources','loadedBytes','totalBytes'].every(key=>Number.isInteger(state[key])&&state[key]>=0)||state.loadedBytes>state.totalBytes||typeof state.status!=='string'||typeof state.error!=='string')throw error('LOAD_STATE_INVALID');},commands:{
  'load.start':async(_,ctx)=>{
   const token=++generation;ctx.update({progress:0,downloaded:0,loadedResources:0,loadedBytes:0,status:'LOADING',error:''});let loadedBytes=0;
   try{for(let index=0;index<resources.length;index++){await waitForGameStep(stepMs,ctx.signal);const bytes=await decode(resources[index],ctx.signal);if(bytes!==size(resources[index]))throw error('LOAD_RESOURCE_BYTES');loadedBytes+=bytes;ctx.update({progress:loadedBytes/totalBytes*100,downloaded:loadedBytes/totalBytes*250,loadedBytes,loadedResources:index+1});}ctx.update({status:'COMPLETE'});return{resources:resources.length,bytes:loadedBytes};}
   catch(cause){if(cause.name!=='AbortError')ctx.update({status:'FAILED',error:cause.code??'LOAD_FAILED'});else if(token===generation&&port.inspect().alive)port.update({status:'CANCELLED'});throw cause;}
  },
  'load.cancel':async(_,ctx)=>{port.cancel('load.start');ctx.update({status:'CANCELLED',error:''});},
 }});return port;
}
