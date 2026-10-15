import '@pixi/layout';
import {Application} from 'pixi.js';
import {loadPngSkin} from '../runtime/png-skin.mjs';
import {compilePanel} from '../panel/compiler.mjs';
import {initialFieldState,applyPresetAction} from '../panel/action-behavior.mjs';
import {canvasResolution} from './canvas-resolution.mjs';
import {assertEditedTextLabels} from './panel-text-labels.mjs';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1));
const artifactId=params.get('artifact'),requestedVariant=params.get('variant'),requestedOrientation=params.get('orientation');
// Parameter-only iframe navigation otherwise keeps this module and its old scene alive.
const reloadForParameters=()=>location.reload();
window.addEventListener('hashchange',reloadForParameters);
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const unsupported=new Set(['PANEL_EDIT_UNSUPPORTED_PREVIEW','STUDIO_PANEL_EDIT_UNSUPPORTED_PREVIEW']);
let source,ctx,skin,app,current=null,disposed=false,appReady=false,epoch=0,loadController,resizeObserver,lastStatus=null;
const sourceController=new AbortController();

function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function announce(status,text,target=current?.variant){
  lastStatus={type:'ui-panel-copy-state',artifactId,variantKey:target?.key??requestedVariant??null,orientation:target?.orientation??requestedOrientation??null,revisionId:current?.revisionId??null,viewToken:params.get('view'),status,...(text?{message:text}:{})};
  document.body.dataset.status=status;
  if(text)message(text,status!=='ready');
  if(parent!==window)parent.postMessage(lastStatus,location.origin);
}
const failure=(text,code)=>Object.assign(new Error(text),{publicMessage:text,code});
async function request(url,options){
  const response=await fetch(url,{cache:'no-store',...options});
  let value;try{value=await response.json();}catch{throw failure('面板预览返回了无法读取的结果，请重新打开。');}
  if(!response.ok)throw failure(typeof value.message==='string'?value.message:'面板预览未能读取，请重新打开。',value.code);
  return value;
}
function initialState(variant,document){
  if(variant.behavior)return Object.fromEntries(variant.behavior.fields.map(field=>[field.id,initialFieldState(field)]).filter(([,value])=>value));
  return Object.fromEntries(document.nodes.flatMap(node=>{
    const type=node.recipeRef.split('@')[0],p=node.props;
    if(['check-box','switch'].includes(type))return [[node.id,{checked:p.checked}]];
    if(['slider','input'].includes(type))return [[node.id,{value:p.value}]];
    if(type==='select')return [[node.id,{selectedId:p.selectedId}]];
    return [];
  }));
}
function feedback(text,error=false){message(text,error);if(lastStatus)lastStatus={...lastStatus,message:text};}
function onEvent(record,event){
  if(disposed||current!==record)return;
  const handle=record.scene.runtime.handles.get(event.nodeId),value=handle?.readState();
  if(value&&Object.keys(value).length)record.state[event.nodeId]=value;
  try{
    if(event.event==='activate'&&record.variant.behavior?.actions.some(action=>action.id===event.nodeId)){
      const result=applyPresetAction(record.variant.behavior,event.nodeId,record.state);record.state=result.state;
      for(const [id,value]of Object.entries(record.state))record.scene.runtime.handles.get(id)?.setState(value);
      feedback(result.errors.length?'输入内容未通过校验，请检查后再试。':result.event.action==='reset-initial'?'已恢复试玩初值。':result.dismiss?'面板已关闭，可用“重新打开”继续试玩。':'已发出本地试玩事件。',result.errors.length>0);
      if(result.dismiss)record.scene.root.root.visible=false;
    }else if(event.nodeId==='close'&&event.event==='activate'&&!record.variant.behavior?.actions.length){
      record.scene.root.root.visible=false;feedback('面板已关闭，可用“重新打开”继续试玩。');
    }else if(event.event==='closed')feedback('弹窗已关闭，可用“重新打开”继续试玩。');
    else if(event.event==='activate')feedback('已触发本地试玩事件。');
  }catch{feedback('本地交互未能完成；当前面板和已保存副本均保留。',true);}
}
function fit(){
  if(disposed||!app||!current)return;
  const board=ctx.canvases.presets[current.document.canvas],view=$('viewport');
  const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight);
  const scale=Math.min(1,Math.max(1,width-24)/board.width,Math.max(1,height-24)/board.height);
  const quality=canvasResolution({...board,scale,devicePixelRatio:window.devicePixelRatio||1});
  if(app.screen.width!==board.width||app.screen.height!==board.height||app.renderer.resolution!==quality.resolution)app.renderer.resize(board.width,board.height,quality.resolution);
  Object.assign($('world').style,{width:board.width*scale+'px',height:board.height*scale+'px',left:(width-board.width*scale)/2+'px',top:(height-board.height*scale)/2+'px'});
  app.render();
}
function updateControls(){
  $('variant').disabled=!source?.variants?.length||disposed;
  $('reopen').disabled=!current||disposed;$('fit').disabled=!current||disposed;
  if(!current)return;
  $('variant').value=current.variant.key;
  const board=ctx.canvases.presets[current.document.canvas];
  $('canvas-info').textContent=(current.document.canvas==='portrait'?'竖版 9:16':'横版 16:9')+' · '+board.width+' × '+board.height;
  $('revision-info').textContent=current.revisionId?'正在预览已保存的编辑副本':'正在预览原始生成结果';
}
async function openVariant(key){
  const next=source.variants.find(variant=>variant.key===key);
  if(!next)throw failure('所选面板版本不存在，请从面板预览重新进入。');
  const ticket=++epoch;loadController?.abort();const controller=new AbortController();loadController=controller;
  message(current?'正在读取所选版本，当前面板可继续试玩…':'正在读取面板…');
  let record,resized=false;
  try{
    const saved=await request('/panel-edit/load',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({artifactId,variantKey:key}),signal:controller.signal});
    if(disposed||ticket!==epoch)return;
    if(saved.document?.canvas!==next.orientation||saved.document?.bindings?.sha256!==source.pack.manifestSha256)throw failure('编辑副本与原画布或皮肤版本不一致，已保留上一面板。');
    record={variant:next,document:structuredClone(saved.document),revisionId:saved.revisionId??null,state:initialState(next,saved.document),scene:null};
    // Overlay owners snapshot the logical screen at construction. Set the
    // requested board before compilation, including portrait-first previews.
    const board=ctx.canvases.presets[record.document.canvas];
    app.renderer.resize(board.width,board.height,app.renderer.resolution);resized=true;
    record.scene=compilePanel(record.document,ctx,{app,skin,onEvent:event=>onEvent(record,event)});
    record.scene.root.root.visible=false;
    for(const [id,value]of Object.entries(record.state))record.scene.runtime.handles.get(id)?.setState(value);
    record.scene.runtime.setMode('play');record.scene.runtime.flush();
    assertEditedTextLabels(record.scene,next.document,ctx);
    if(disposed||ticket!==epoch){record.scene.dispose();return;}
    const previous=current,previousVisible=previous?.scene.root.root.visible;
    try{
      if(previous)previous.scene.root.root.visible=false;
      current=record;record.scene.root.root.visible=true;$('world').hidden=false;fit();
    }catch(error){current=previous;record.scene.dispose();record=null;if(previous){previous.scene.root.root.visible=previousVisible;fit();}else $('world').hidden=true;throw error;}
    previous?.scene.dispose();updateControls();
    announce('ready',record.revisionId?'已载入已保存的编辑副本，可直接试玩。':'此版本尚无已保存编辑副本，正在预览原始生成结果。');
  }catch(error){
    if(disposed||ticket!==epoch||error.name==='AbortError')return;
    if(record&&record!==current)record.scene?.dispose();
    if(resized&&current)fit();
    updateControls();announce(unsupported.has(error.code)?'unsupported':'error',error.publicMessage??(current?'所选版本未能载入，已保留上一面板及试玩状态。':'面板预览未能打开，请返回后重新进入。'),current?.variant??next);
  }finally{if(loadController===controller)loadController=null;}
}

window.actionPreview=Object.freeze({get app(){return app;},get scene(){return current?.scene;}});
window.panelCopyPreview=Object.freeze({
  get doc(){return current?structuredClone(current.document):null;},
  get variant(){return current?structuredClone(current.variant):null;},
  get revisionId(){return current?.revisionId??null;},
  get state(){return current?Object.fromEntries([...current.scene.runtime.handles].map(([id,handle])=>[id,structuredClone(handle.readState())])):{};},
  get status(){return lastStatus?structuredClone(lastStatus):null;},
});
$('variant').onchange=()=>{openVariant($('variant').value).catch(error=>{if(!disposed){updateControls();announce('error',error.publicMessage??'所选版本未能载入，已保留当前面板。');}});};
$('fit').onclick=fit;
$('reopen').onclick=()=>{
  if(disposed||!current)return;
  try{current.scene.root.root.visible=true;for(const handle of current.scene.runtime.handles.values())if(handle.recipe.type==='Dialog'&&handle.props.open)handle.setState({open:true});current.scene.runtime.flush();feedback('已重新打开，保留当前试玩值。');}
  catch{feedback('面板暂时无法重新打开，请重新选择该版本。',true);}
};
window.addEventListener('resize',fit);
window.addEventListener('pagehide',()=>{
  disposed=true;epoch++;sourceController.abort();loadController?.abort();resizeObserver?.disconnect();window.removeEventListener('resize',fit);window.removeEventListener('hashchange',reloadForParameters);
  if(appReady)app.stop();current?.scene.dispose();current=null;if(appReady)app.destroy({removeView:true,releaseGlobalResources:false},{children:true});skin?.dispose();
},{once:true});

try{
  if(!/^[a-z][a-z0-9-]{0,48}$/.test(artifactId??''))throw failure('面板标识无效，请从作品库重新打开。');
  source=await request('/panel-edit/source?artifact='+encodeURIComponent(artifactId),{signal:sourceController.signal});
  if(disposed)throw Object.assign(new Error(),{name:'AbortError'});
  if(!Array.isArray(source.variants)||!source.variants.length)throw failure('该面板没有可预览版本。');
  let preferred;
  if(requestedVariant!==null){preferred=source.variants.find(variant=>variant.key===requestedVariant);if(!preferred)throw failure('所请求的面板版本不存在，请从作品库重新打开。');}
  else if(requestedOrientation!==null){preferred=source.variants.find(variant=>variant.orientation===requestedOrientation);if(!preferred)throw failure('该面板没有所请求的画布方向，请从作品库重新打开。');}
  else preferred=source.variants[0];
  skin=await loadPngSkin({manifestBytes:bytes(source.pack.manifest),manifestSha256:source.pack.manifestSha256,expectedBindings:source.pack.bindings,read:file=>bytes(source.pack.resources[file])});
  if(disposed){skin.dispose();throw Object.assign(new Error(),{name:'AbortError'});}
  ctx={...source.ctx,profile:skin.profile};app=new Application();
  await app.init({width:1280,height:720,backgroundAlpha:0,antialias:true,preference:'webgl',preserveDrawingBuffer:true,layout:{autoUpdate:true,throttle:0},eventFeatures:{globalMove:true}});
  appReady=true;
  if(disposed){app.destroy({removeView:true,releaseGlobalResources:false},{children:true});throw Object.assign(new Error(),{name:'AbortError'});}
  $('world').prepend(app.canvas);
  for(const variant of source.variants){const option=document.createElement('option');option.value=variant.key;option.textContent=variant.label;$('variant').append(option);}
  $('variant').value=preferred.key;updateControls();
  resizeObserver=new ResizeObserver(fit);resizeObserver.observe($('viewport'));
  await openVariant(preferred.key);
}catch(error){if(!disposed&&error.name!=='AbortError')announce(unsupported.has(error.code)?'unsupported':'error',error.publicMessage??'面板预览未能打开，请返回后重新进入。');}
