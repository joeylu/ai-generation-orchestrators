/** Pixi adapter for createPanelHost. Every mount owns its canvas, editor and resources. */
import { createTreePreview, componentCore } from './workspace/component-browser.mjs';
import {attachPanelSession} from './state.mjs';
import {attachLayoutSession} from './layout-session.mjs';
import {attachInputEditor} from './input-editor.mjs';
import {attachPanelVisuals} from './panel-visuals.mjs';
import {compilePanel} from './compiler.mjs';
import {observePanelViewport} from './panel-viewport.mjs';
export const pixiPanelCore = componentCore;

function imageFor(resource,signal){return new Promise((resolve,reject)=>{const image=new Image(),cleanup=()=>{image.onload=null;image.onerror=null;signal.removeEventListener('abort',abort);},abort=()=>{cleanup();image.src='';reject(new Error('PANEL_HOST_OPEN_CANCELLED'));};image.onload=()=>{cleanup();resolve(image);};image.onerror=()=>{cleanup();reject(new Error('PANEL_HOST_IMAGE'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}image.src=`data:${resource.mime};base64,${resource.base64}`;});}
export async function mountPixiPanelInstance({bundle,state,options,signal,onEvent,onFatal}){
  const container=options.container;if(!(container instanceof HTMLElement)||container.childElementCount)throw new Error('PANEL_HOST_CONTAINER');
  const surface=document.createElement('div');surface.className='panel-instance-surface';surface.style.transformOrigin='top left';container.append(surface);const previousHeight=container.style.height;
  let runtime,session,layout,detachViewport=()=>{},detachInput=()=>{},detachVisuals=()=>{},disposed=false;
  const destroy=()=>{if(disposed)return;disposed=true;const errors=[];for(const action of [()=>detachViewport(),()=>detachVisuals(),()=>detachInput(),()=>layout?.destroy(),()=>session?.destroy(),()=>runtime?.destroy(),()=>surface.remove(),()=>{container.style.height=previousHeight;}])try{action();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'PANEL_PIXI_CLEANUP_FAILED');};
  const aborted=()=>destroy();signal.addEventListener('abort',aborted,{once:true});
  try{
    signal.throwIfAborted();runtime=await createTreePreview(surface,onFatal);if(disposed||signal.aborted){runtime.destroy();throw new Error('PANEL_HOST_OPEN_CANCELLED');}
    const resources=new Map(bundle.componentBundle.resources.map(resource=>[resource.path,resource]));
    // A reopen retains host state. Its document must reflect that state, including
    // progress paint, page visibility and form-dependent button availability.
    const compiled=compilePanel(bundle.spec,bundle.catalog,pixiPanelCore,state,bundle.assetClosure,bundle.compilerVersion);
    await runtime.load(compiled.document,signal,(path,loadSignal)=>{const resource=resources.get(path);if(!resource||resource.mime!=='image/png')throw new Error('PANEL_HOST_RESOURCE');return imageFor(resource,loadSignal);});signal.throwIfAborted();
    detachVisuals=attachPanelVisuals(bundle,runtime);
    layout=attachLayoutSession(bundle.spec,runtime);session=attachPanelSession(bundle.spec,runtime,onEvent,state);detachInput=attachInputEditor(surface,bundle.spec,runtime,session);
    detachViewport=observePanelViewport(bundle.spec.canvas,container,surface,runtime);
    return Object.freeze({getState:()=>session.getState(),setState:value=>session.setState(value),inspect:()=>runtime.inspect(),destroy(){signal.removeEventListener('abort',aborted);destroy();}});
  }catch(error){signal.removeEventListener('abort',aborted);destroy();throw error;}
}
