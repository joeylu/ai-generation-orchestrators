import '@pixi/layout';
import {Application} from 'pixi.js';
import {loadPngSkin} from '../runtime/png-skin.mjs';
import {compilePanel} from '../panel/compiler.mjs';
import {createSession} from '../panel/session.mjs';
import {indexDocument} from '../panel/document.mjs';
import {sizeEditTargets,rectangleEditDocument,combinedEditDocument,freeLayoutDocument,textEditFields,textEditDocument,textStyleEditState} from '../panel/size-edit.mjs';
import {mountPanelCanvasGestures} from './panel-canvas-gestures.mjs';
import {canvasResolution} from './canvas-resolution.mjs';
import {frameCamera,zoomCamera,panCamera,resizeCamera} from './panel-camera.mjs';
import {mountPanelCameraNavigation} from './panel-camera-navigation.mjs';
import {assertEditedTextLabels} from './panel-text-labels.mjs';
import {initialFieldState,applyPresetAction} from '../panel/action-behavior.mjs';
import {attachPanelMotion} from '../panel/motion-runtime.mjs';
import {motionSelection} from '../panel/motion-profile.mjs';
import {panelSizeCopy} from '../panel/size-copy.mjs';
import {panelDocumentFingerprint,createPanelEditorDraftStore} from './panel-editor-drafts.mjs';
import {panelFormDraft,panelTextInputValue} from './panel-editor-forms.mjs';
import {createPanelEditorTree} from './panel-editor-tree.mjs';
import {panelEditorError} from './panel-editor-errors.mjs';
import {createPanelEditorLive} from './panel-editor-live.mjs';
import {panelBodyFrames} from './panel-editor-body.mjs';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1));
const artifactId=params.get('artifact'),motionStyle=params.get('motion')??'original';
const reloadForParameters=()=>location.reload();
window.addEventListener('hashchange',reloadForParameters);
window.addEventListener('pagehide',()=>window.removeEventListener('hashchange',reloadForParameters),{once:true});
let source,variant,ctx,skin,app,session,selected,revisionId=null,savedDocument='',mode='edit',busy=false,state={},motion,canvasGestures,previewScene=null,previewDocument=null,navigation,resizeObserver;
let cameraState={x:0,y:0,scale:1,mode:'focus'},lastViewport=null,focusId=null,navigationActive=false,compact=innerWidth<=700,treeHidden=compact,propertiesHidden=compact,focusMode=false,beforeFocus=null,desktopPanels={treeHidden:false,propertiesHidden:false};
let textBinding=null,formNode=null,formVariant=null,errorNode=null,errorOwner=null,inputStatus=null;
let liveGroup=null,liveSettling=null,liveCommitting=false,composing=false,liveFrame=0,showBodies=true;
const drafts=createPanelEditorDraftStore(),layerTree=createPanelEditorTree($('tree'),chooseFromTree);
const liveEditor=createPanelEditorLive({apply:previewInputs,delay:160,onError:(error,request,{isCurrent})=>{if(!isCurrent()||request.nodeId!==selected||request.variantKey!==variant?.key)return;clearPreview();app.render();selection();showError(error,'输入暂未应用：');inputFeedback(request.group,$('message-text').textContent,true);inputStatus={variantKey:request.variantKey,nodeId:request.nodeId,groups:[request.group]};draftControls();}});
document.documentElement.classList.toggle('embedded',parent!==window);
const status=(text,error=false,nodeId=null,ownerId=null)=>{inputStatus=null;$('message-text').textContent=text;$('message').title=text;$('message').classList.toggle('error',error);errorNode=nodeId;errorOwner=ownerId;$('locate-error').hidden=!nodeId;$('locate-owner').hidden=!ownerId;};
const pending=()=>variant?drafts.entries(variant.key):[];
const dirty=()=>session&&(pending().length>0||panelDocumentFingerprint(session.document)!==savedDocument);
const signalDirty=()=>{if(parent!==window)parent.postMessage({type:'ui-panel-size-dirty',dirty:!!dirty(),artifactId,variantKey:variant?.key,orientation:session?.document.canvas,viewToken:params.get('view')},location.origin);};
function showError(error,prefix=''){const info=panelEditorError(error,session.document,ctx);status(prefix+info.message+(info.details?.length?' '+info.details.join('；'):''),true,info.nodeId,info.ownerId);}
function inputFeedback(group,text='',error=false){const field=$(group==='rect'?'rect-feedback':'text-feedback');field.textContent=text;field.classList.toggle('error',error);$(group==='rect'?'size-form':'text-form').setAttribute('aria-invalid',String(error));}
function clearInputStatus(){if(inputStatus?.variantKey===variant?.key&&inputStatus.nodeId===selected&&inputStatus.groups.every(group=>!drafts.get(variant.key,selected)?.[group]))status('这组输入已恢复到当前已应用的值。');}
async function post(action,data){const response=await fetch('/panel-edit/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.message??'编辑副本未能保存。');return result;}
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const typeNames={Container:'布局分组',Panel:'面板',Dialog:'弹窗',Text:'文字',Button:'按钮',Switch:'开关',CheckBox:'勾选框',RadioGroup:'单选组',Select:'下拉框',Slider:'滑块',ProgressBar:'进度条',Input:'输入框',ScrollView:'滚动区',Tabs:'页签',List:'列表',Image:'图片'};
function nodeLabel(node,target){
 if(node.id===session.document.rootId)return '画布（比例固定）';
 if(node.props.label||node.props.title)return node.props.label||node.props.title;
 if(['Panel','Dialog'].includes(target.type))return '面板整体';
 if(node.id==='body')return '内容布局';if(node.id==='heading')return '主标题';if(node.id==='actions')return '按钮区域';
 if(node.props.text)return String(node.props.text).replace(/\s+/g,' ').slice(0,32);
 if(target.type==='Container'&&node.layout?.direction)return ({row:'横向分组',column:'纵向分组',grid:'网格分组',wrap:'换行分组'})[node.layout.direction]??'布局分组';
 return typeNames[target.type]??'组件';
}
function initialState(){
 if(variant.behavior)return Object.fromEntries(variant.behavior.fields.map(f=>[f.id,initialFieldState(f)]).filter(([,s])=>s));
 return Object.fromEntries(variant.document.nodes.flatMap(node=>{
  const type=node.recipeRef.split('@')[0],props=node.props;
  if(['check-box','switch'].includes(type))return [[node.id,{checked:props.checked}]];
  if(['slider','input'].includes(type))return [[node.id,{value:props.value}]];
  if(type==='select')return [[node.id,{selectedId:props.selectedId}]];
  return [];
 }));
}
function onEvent(scene,event){
 const value=scene.runtime.handles.get(event.nodeId)?.readState();
 if(value&&Object.keys(value).length)state[event.nodeId]=value;
 if(event.event==='activate'&&variant.behavior?.actions.some(a=>a.id===event.nodeId)){
  const result=applyPresetAction(variant.behavior,event.nodeId,state);state=result.state;
  for(const[id,value]of Object.entries(state))scene.runtime.handles.get(id)?.setState(value);
  status(result.errors.length?'输入内容未通过校验。':result.event.action==='reset-initial'?'已恢复试玩初值。':'已发出本地试玩事件。',result.errors.length>0);
  if(result.dismiss)scene.root.root.visible=false;
 }
 if(event.nodeId==='close'&&event.event==='activate'&&!variant.behavior?.actions.length){scene.root.root.visible=false;status('面板已关闭，切回编辑后可重新试玩。');}
}
function ensureLabels(scene){
 const literal=value=>String(value).replace(/\s+/g,' '),check=(actual,expected)=>{if(actual!==literal(expected))throw Error('尺寸不足以完整显示控件文案，请增加宽度。');};
 for(const h of scene.runtime.handles.values()){
  if(h.recipe.type==='Button')check(h.adapter.view.labelView?.text??h.adapter.view._views?.textView?.text,h.props.label);
  if(h.recipe.type==='Select'){
   for(const[index,row]of h.adapter.view.rows.entries())check(row.labelView.text,h.props.options[index].label);
   const expected=h.props.options.find(o=>o.id===h.readState().selectedId)?.label??h.props.placeholder;
   for(const button of [h.adapter.view.openButton,h.adapter.view.closeButton])check(button.labelView?.text??button._views?.textView?.text,expected);
  }
 }
}
function prepare(document){
 const scene=compilePanel(document,ctx,{app,skin,onEvent:event=>onEvent(scene,event)});
 try{for(const[id,value]of Object.entries(state))scene.runtime.handles.get(id)?.setState(value);scene.runtime.setMode(mode==='play'?'play':'edit');scene.runtime.flush();ensureLabels(scene);assertEditedTextLabels(scene,variant.document,ctx);scene.root.root.visible=false;return scene;}catch(error){scene.dispose();throw error;}
}
const renderScene=()=>previewScene??session?.current;
const editDocument=()=>previewDocument??session.document;
const viewportSize=()=>({width:Math.max(1,$('viewport').clientWidth),height:Math.max(1,$('viewport').clientHeight)});
function camera(next=cameraState){
 if(!app||!session?.current)return;const board=ctx.canvases.presets[session.document.canvas];
 cameraState={...next};const {x,y,scale}=cameraState;
 $('world').style.width=board.width*scale+'px';$('world').style.height=board.height*scale+'px';$('world').style.setProperty('--grid-step',20*scale+'px');$('zoom-label').textContent=Math.round(scale*100)+'%';
 $('world').style.left=x+'px';$('world').style.top=y+'px';
 const quality=canvasResolution({...board,scale,devicePixelRatio:devicePixelRatio||1});if(app.renderer.resolution!==quality.resolution)app.renderer.resize(board.width,board.height,quality.resolution);selection();
}
function fit(){if(!app||!session?.current||canvasGestures?.active||navigation?.active)return;const board=ctx.canvases.presets[session.document.canvas];lastViewport=viewportSize();camera(frameCamera({x:0,y:0,...board},lastViewport,{padding:24,maxScale:1,mode:'fit'}));}
function focusSelected(id=selected){
 if(!app||!session?.current||canvasGestures?.active||navigation?.active)return;
 if(id===session.document.rootId){fit();return;}const h=renderScene()?.runtime.handles.get(id);if(!h){fit();return;}
 const at=h.root.toGlobal({x:0,y:0});focusId=id;lastViewport=viewportSize();camera(frameCamera({...at,width:h.size.width,height:h.size.height},lastViewport));
}
function zoom(next,anchor){if(!app||!session?.current||canvasGestures?.active||navigation?.active)return;const v=viewportSize();camera(zoomCamera(cameraState,next,anchor??{x:v.width/2,y:v.height/2}));}
async function chooseFromTree(id){if(busy||composing)return;await settleLive();selectNode(id);}
function selectNode(id){liveEditor.cancel();clearPreview();captureInputs();selected=id;liveGroup=null;controls();selection();app.render();const h=renderScene()?.runtime.handles.get(id);if(!h)return;const p=h.root.toGlobal({x:0,y:0}),v=viewportSize(),c=cameraState;if(p.x*c.scale+c.x<20||p.y*c.scale+c.y<28||(p.x+h.size.width)*c.scale+c.x>v.width-20||(p.y+h.size.height)*c.scale+c.y>v.height-20)focusSelected(id);}
function panelLayout(){
 document.body.classList.toggle('tree-collapsed',treeHidden);document.body.classList.toggle('properties-collapsed',propertiesHidden);document.body.classList.toggle('focus-canvas',focusMode);
 $('toggle-tree').setAttribute('aria-expanded',String(!treeHidden));$('toggle-properties').setAttribute('aria-expanded',String(!propertiesHidden));$('focus-mode').setAttribute('aria-pressed',String(focusMode));$('focus-mode').textContent=focusMode?'退出专注':'专注画布';
}
function cameraControls(){const panning=!!navigation?.active;$('pan-tool').setAttribute('aria-pressed',String(!!navigation?.hand));$('viewport').dataset.hand=String(!!navigation?.hand||!!navigation?.space);$('viewport').dataset.cameraPan=String(panning);}
function viewChanged(){
 $('editor-layout').style.setProperty('--preview-tools-height',$('viewport').previousElementSibling.offsetHeight+'px');
 const next=viewportSize(),previous=lastViewport;lastViewport=next;if(!session?.current)return;if(previous&&Math.abs(next.width-previous.width)<.5&&Math.abs(next.height-previous.height)<.5){camera();return;}
 canvasGestures?.cancel('resize');navigation?.cancel('resize');
 if(cameraState.mode==='fit')fit();else if(cameraState.mode==='focus')focusSelected(focusId??selected);else camera(previous?resizeCamera(cameraState,previous,next):cameraState);
}
function selection(){
 const h=renderScene()?.runtime.handles.get(selected),box=$('selection');let visible=true;for(let view=h?.root;view;view=view.parent)if(!view.visible||!view.renderable||view.alpha===0)visible=false;
 box.hidden=mode!=='edit'||!h||!visible||selected===session.document.rootId;
 $('body-info').textContent='';
 for(const key of ['self','parent'])$('body-'+key).hidden=true;
 if(box.hidden)return;
 const doc=editDocument(),targets=sizeEditTargets(doc,ctx),target=targets.find(t=>t.id===selected),nodes=indexDocument(doc).nodes,node=nodes.get(selected),p=h.root.toGlobal({x:0,y:0});
 const bodies=panelBodyFrames(targets,selected,(id,point)=>renderScene()?.runtime.handles.get(id)?.root.toGlobal(point),cameraState.scale);
 for(const frame of bodies){const view=$('body-'+frame.key);view.hidden=!showBodies;Object.assign(view.style,{left:frame.rect.x+'px',top:frame.rect.y+'px',width:frame.rect.width+'px',height:frame.rect.height+'px'});$('body-'+frame.key+'-label').textContent=(frame.key==='self'?'内容区':'父级内容区')+' · '+nodeLabel(nodes.get(frame.nodeId),targets.find(t=>t.id===frame.nodeId))+' · '+Math.round(frame.body.width)+' × '+Math.round(frame.body.height)+(frame.body.allowVerticalOverflow?'（允许纵向延伸）':'');}
 $('body-info').textContent=bodies.length?bodies.map(frame=>(frame.key==='self'?'自身内容区':'父级可用区')+' '+Math.round(frame.body.width*100)/100+' × '+Math.round(frame.body.height*100)/100+(frame.body.allowVerticalOverflow?'；允许内容纵向延伸':'')).join('。'):'此组件没有独立的子内容槽，选框为实际组件矩形。';
 const {scale}=cameraState,width=h.size.width*scale,height=h.size.height*scale,hit=matchMedia('(pointer:coarse)').matches?40:24;
 Object.assign(box.style,{left:p.x*scale+'px',top:p.y*scale+'px',width:width+'px',height:height+'px'});
 box.style.setProperty('--handle-hit-width',Math.max(1,Math.min(hit,(width-4)*.75))+'px');box.style.setProperty('--handle-hit-height',Math.max(1,Math.min(hit,(height-4)*.75))+'px');
 const label=$('selection-move');label.textContent=nodeLabel(node,target)+' · '+Math.round(h.size.width)+' × '+Math.round(h.size.height);label.dataset.managed=String(!target.editablePosition);label.title=target.editablePosition?'拖动移动所选节点':target.positionReason;label.style.top=p.y*scale+cameraState.y<32?'4px':'-29px';
 for(const handle of box.querySelectorAll('[data-resize]')){const edge=handle.dataset.resize;handle.hidden=(/[ew]/.test(edge)&&!target.editableWidth)||(/[ns]/.test(edge)&&!target.editableHeight)||(/[nw]/.test(edge)&&!target.editablePosition)||(['e','w'].includes(edge)&&height<48)||(['n','s'].includes(edge)&&width<48)||(edge.includes('n')&&height<16)||(edge.includes('w')&&width<16);}
}
function values(doc=editDocument()){const target=sizeEditTargets(doc,ctx).find(t=>t.id===selected);for(const axis of ['x','y','width','height'])$(axis).value=target?Math.round(target[axis]*100)/100:'';for(const[id,value]of Object.entries(drafts.get(variant.key,selected)?.rect??{}))$(id).value=value;}
function formBaseline(){
 const target=sizeEditTargets(session.document,ctx).find(t=>t.id===selected),fields=textEditFields(session.document,selected,ctx),style=textStyleEditState(session.document,selected,ctx),rect={};
 for(const axis of ['x','y','width','height'])if(target?.[['x','y'].includes(axis)?'editablePosition':axis==='width'?'editableWidth':'editableHeight'])rect[axis]=String(target[axis]);
 return {rect,...(fields.length||style.editable?{text:{fields:Object.fromEntries(fields.map(field=>[field.id,panelTextInputValue(field.value,field.multiline)])),fontDefault:style.fontSizeOverride==null,fontSize:String(style.fontSize??ctx.profile.fontSize),colorDefault:style.textColorOverride==null,textColor:style.textColorOverride??''}}:{})};
}
function captureInputs(){
 if(!session||formNode!==selected||formVariant!==variant.key||mode!=='edit'||busy||canvasGestures?.active)return;
 const baseline=formBaseline(),values={rect:Object.fromEntries(Object.keys(baseline.rect).map(id=>[id,$(id).value]))};
 if(baseline.text)values.text={fields:Object.fromEntries(Array.from($('text-fields').querySelectorAll('[data-text-field]'),input=>[input.dataset.textField,input.value])),fontDefault:$('font-default').checked,fontSize:$('font-size').value,colorDefault:$('color-default').checked,textColor:$('text-color-hex').value};
 const draft=panelFormDraft(values,baseline);if(Object.keys(draft).length)drafts.set(variant.key,selected,draft);else drafts.delete(variant.key,selected);
 draftControls();
}
function inputCandidate(document,nodeId,draft,group=null){
 const rect=Object.create(null),changes=Object.create(null);
 if(draft.rect&&(!group||group==='rect')){
  const target=sizeEditTargets(document,ctx).find(t=>t.id===nodeId);
  for(const[axis,raw]of Object.entries(draft.rect)){if(String(raw).trim()===''||!Number.isFinite(Number(raw)))throw Object.assign(Error('请输入有效的位置和尺寸数值，输入已保留。'),{nodeId});if(Math.abs(Number(raw)-target[axis])>.005)rect[axis]=Number(raw);}
 }
 if(draft.text&&(!group||group==='text')){
  const raw=draft.text,fields=textEditFields(document,nodeId,ctx),style=textStyleEditState(document,nodeId,ctx);Object.assign(changes,Object.fromEntries(fields.filter(field=>Object.hasOwn(raw.fields,field.id)&&raw.fields[field.id]!==panelTextInputValue(field.value,field.multiline)).map(field=>[field.id,raw.fields[field.id]])));
  if(style.editable){const fontSize=raw.fontDefault?null:Number(raw.fontSize),textColor=raw.colorDefault?null:raw.textColor;if(fontSize!==(style.fontSizeOverride??null))changes.fontSize=fontSize;if(textColor?.toLowerCase()!==(style.textColorOverride??null)?.toLowerCase())changes.textColor=textColor;}
 }
 const hasRect=Object.keys(rect).length>0,hasText=Object.keys(changes).length>0;
 if(hasRect&&hasText)return combinedEditDocument(document,{nodeId,rect,changes},ctx);
 if(hasRect)return rectangleEditDocument(document,{nodeId,...rect},ctx);
 return hasText?textEditDocument(document,{nodeId,changes},ctx):document;
}
function previewInputs(request,{isCurrent}){
 if(!isCurrent()||busy||composing||mode!=='edit'||request.nodeId!==selected||request.variantKey!==variant.key||request.revision!==session.revision)return;
 const candidate=inputCandidate(session.document,request.nodeId,request.values,request.group),next=prepare(candidate);
 if(!isCurrent()){next.dispose();return;}
 previewScene?.dispose();previewDocument=candidate;previewScene=next;session.current.root.root.visible=false;next.root.root.visible=true;app.render();selection();
 status('正在实时预览，离开这组输入框后自动应用；Esc 取消。');
 inputFeedback(request.group,'已实时预览，离开这组输入框后自动应用。');
 draftControls();
}
function scheduleInputs(group,event){
 captureInputs();liveGroup=group;
 if(composing||event?.isComposing||busy||mode!=='edit')return;
 const values=drafts.get(variant.key,selected);
 if(!values?.[group]){liveEditor.cancel();clearPreview();inputFeedback(group);clearInputStatus();app.render();selection();draftControls();return;}
 liveEditor.schedule({variantKey:variant.key,nodeId:selected,group,values,revision:session.revision});
 if((group==='rect'||['font-size','text-color','font-default','color-default'].includes(event?.target?.id))&&!liveFrame)liveFrame=requestAnimationFrame(()=>{liveFrame=0;void liveEditor.flush();});
}
function settleLive(group=null){
 if(liveSettling)return liveSettling;
 if(!session||composing||busy||canvasGestures?.active||navigation?.active)return Promise.resolve(false);
 captureInputs();liveEditor.cancel();const nodeId=selected,draft=drafts.get(variant.key,nodeId),groups=['rect','text'].filter(key=>draft?.[key]&&(!group||key===group));
 if(!groups.length){clearPreview();for(const key of group?[group]:['rect','text'])if(!draft?.[key])inputFeedback(key);clearInputStatus();app.render();selection();liveGroup=null;return Promise.resolve(true);}
 liveSettling=change(async()=>{const candidate=inputCandidate(session.document,nodeId,draft,group);if(panelDocumentFingerprint(candidate)!==panelDocumentFingerprint(session.document))await session.commit(candidate);for(const key of groups)dropDraftGroup(nodeId,key);},'已自动应用到画布，可撤销。保存副本后面板预览会同步更新。',{keepEditing:true}).then(result=>{liveGroup=null;for(const key of groups)inputFeedback(key,result.ok?'已自动应用，可撤销。':result.error,!result.ok);if(!result.ok)inputStatus={variantKey:variant.key,nodeId,groups};return result.ok;}).finally(()=>{liveSettling=null;});
 return liveSettling;
}
function cancelLive(group=liveGroup){
 if(busy||liveSettling)return;liveEditor.cancel();clearPreview();if(group)dropDraftGroup(selected,group);else drafts.delete(variant.key,selected);for(const key of group?[group]:['rect','text'])inputFeedback(key);liveGroup=null;controls();app.render();selection();status('已取消本轮输入，恢复上一次有效画布。');
}
function finishOnBlur(group,form,event){if(event?.relatedTarget===$('restore-inputs'))return;queueMicrotask(()=>{if(!composing&&!form.contains(document.activeElement)&&document.activeElement!==$('restore-inputs'))void settleLive(group);});}
function draftControls(){
 const entries=pending(),current=entries.find(entry=>entry.nodeId===selected),blocked=busy||canvasGestures?.active||navigation?.active;
 $('input-draft').hidden=!entries.length;$('input-draft-state').textContent=current?(previewDocument?'正在实时预览，离开输入框后自动应用。':'输入尚未通过预览或正在检查；无效输入会保留。'):`另有 ${entries.length} 个控件的输入尚未通过检查。`;
 $('restore-inputs').hidden=!current;$('restore-inputs').disabled=blocked;$('locate-draft').disabled=blocked;
 $('saved-state').textContent=entries.length?`有 ${entries.length} 个控件正在编辑；保存时会检查并应用当前输入。`:dirty()?'有未保存的画布调整。':revisionId?'当前内容已保存为编辑副本。':'当前为原始生成布局。';
 $('save').disabled=blocked||!dirty();
 for(const button of $('tree').children)button.dataset.draft=String(entries.some(entry=>entry.nodeId===button.dataset.node));
 signalDirty();
}
function dropDraftGroup(nodeId,group){const value=drafts.get(variant.key,nodeId)??{};delete value[group];if(Object.keys(value).length)drafts.set(variant.key,nodeId,value);else drafts.delete(variant.key,nodeId);}
function locateDraft(){const first=pending().find(entry=>entry.nodeId===selected)??pending()[0];if(!first)return;selectNode(first.nodeId);propertiesHidden=false;if(compact)treeHidden=true;panelLayout();focusSelected();const input=first.values.text?$('text-fields').querySelector('input,textarea')??$('font-size'):Object.keys(first.values.rect??{}).map($).find(input=>!input.disabled);input?.focus();}
function guardPending(action){captureInputs();if(!pending().length)return false;locateDraft();status(`还有未通过检查的输入，请调整数值或还原输入，再${action}。`,true);return true;}
function restoreInputs(){cancelLive(null);}
function textControls(blocked){
 const fields=textEditFields(session.document,selected,ctx),style=textStyleEditState(session.document,selected,ctx),binding=JSON.stringify({variant:variant.key,nodeId:selected,fields:fields.map(({id,label,multiline})=>({id,label,multiline}))}),draft=drafts.get(variant.key,selected)?.text;
 if(binding!==textBinding){
  textBinding=binding;$('text-fields').replaceChildren();$('text-feedback').textContent='';$('text-feedback').classList.remove('error');
  for(const field of fields){const label=document.createElement('label'),input=document.createElement(field.multiline?'textarea':'input');label.textContent=field.label;input.dataset.textField=field.id;input.value=field.value;input.setAttribute('aria-describedby','text-feedback');if(!field.multiline)input.type='text';else input.rows=3;input.spellcheck=false;label.append(input);$('text-fields').append(label);}
 }
 for(const field of fields){const input=Array.from($('text-fields').querySelectorAll('[data-text-field]')).find(input=>input.dataset.textField===field.id),value=draft?.fields[field.id]??panelTextInputValue(field.value,field.multiline);if(input.value!==value)input.value=value;}
 const font=draft?.fontSize??style.fontSize??ctx.profile.fontSize;if($('font-size').value!==String(font))$('font-size').value=font;$('font-default').checked=draft?.fontDefault??style.fontSizeOverride==null;
 $('color-default').checked=draft?.colorDefault??style.textColorOverride==null;const color=draft?.textColor??style.textColorOverride??'';if($('text-color-hex').value!==color)$('text-color-hex').value=color;
 const picker=/^#[0-9a-f]{6}$/i.test(color||style.textColor||'')?color||style.textColor:'#202020';if($('text-color').value!==picker)$('text-color').value=picker;
 $('text-form').hidden=fields.length===0&&!style.editable;$('font-style-controls').hidden=!style.editable;
 for(const input of $('text-fields').querySelectorAll('[data-text-field]'))input.disabled=blocked||mode!=='edit';
 for(const id of ['font-size','font-default','text-color','text-color-hex','color-default'])$(id).disabled=blocked||mode!=='edit'||!style.editable;
 $('apply-text').disabled=blocked||mode!=='edit'||fields.length===0&&!style.editable;
}
function controls({preserveInputs=false}={}){
 if(formNode!==selected||formVariant!==variant.key)for(const key of ['rect','text'])inputFeedback(key);
 const draft=preserveInputs?Object.fromEntries(['x','y','width','height'].map(id=>[id,$(id).value])):null;
 const targets=sizeEditTargets(session.document,ctx),target=targets.find(t=>t.id===selected),blocked=busy||canvasGestures?.active||navigation?.active,inputBlocked=blocked&&!liveCommitting;
 $('world').inert=busy;
 const indexed=indexDocument(session.document),items=[];
 function visit(id,depth){const target=targets.find(t=>t.id===id),node=indexed.nodes.get(id);items.push({id,depth,label:nodeLabel(node,target)+' · '+(typeNames[target.type]??'组件')});Object.values(node.slots).flat().forEach(child=>visit(child,depth+1));}
 visit(session.document.rootId,0);
 layerTree.update(items,selected,{disabled:blocked,pending:new Set(pending().map(entry=>entry.nodeId))});
 $('node-title').textContent=target?nodeLabel(indexed.nodes.get(selected),target):'请选择组件';$('node-type').textContent=target?'类型：'+(typeNames[target.type]??'组件'):'';
 textControls(inputBlocked);
 values();for(const[id,value]of Object.entries(drafts.get(variant.key,selected)?.rect??draft??{}))$(id).value=value;for(const axis of ['x','y','width','height'])$(axis).disabled=inputBlocked||mode!=='edit'||!target?.[['x','y'].includes(axis)?'editablePosition':axis==='width'?'editableWidth':'editableHeight'];
 formNode=selected;formVariant=variant.key;
 $('position-hint').textContent=target?.positionReason??'坐标相对于所属分组；可直接拖动控件或上方选中标签。';
 $('size-hint').textContent=target?.reason??'可拖动可见边角，或输入精确宽高。小选框会精简中点手柄，放大画布后显示。';
 $('apply').disabled=blocked||mode!=='edit'||!target||(!target.editableWidth&&!target.editableHeight&&!target.editablePosition);
 const parent=targets.find(t=>t.id===target?.parentId),freeTarget=target?.canFreeLayout?target:parent?.canFreeLayout?parent:null;
 $('free-layout').hidden=!freeTarget;$('free-layout').disabled=blocked||mode!=='edit'||!freeTarget;$('free-layout').dataset.node=freeTarget?.id??'';$('free-layout').textContent=freeTarget?.id===selected?'将此分组切为自由布局':'将所在分组切为自由布局';
 $('layout-hint').textContent=freeTarget?'按当前大小和位置固定该分组的子项，之后可自由拖动；可通过撤销恢复自动排版。':target?.editablePosition?'当前位于自由布局中，可拖动位置和边角。':target?.positionReason??'';
 $('undo').disabled=blocked||mode!=='edit'||!session.canUndo&&!pending().length;$('redo').disabled=blocked||mode!=='edit'||!session.canRedo;$('reset').disabled=blocked||mode!=='edit';
 $('mode').disabled=blocked;$('mode').textContent=mode==='edit'?'试玩':'返回编辑';$('download').disabled=blocked;$('save').disabled=blocked||!dirty();$('variant').disabled=blocked||source.variants.length===1;
 for(const id of ['fit','focus-selection','zoom-in','zoom-out','pan-tool','toggle-tree','toggle-properties','focus-mode','toggle-body'])$(id).disabled=blocked;
 cameraControls();
 $('viewport').dataset.mode=mode;$('viewport').dataset.dragging=String(!!canvasGestures?.active);
 draftControls();
}
function show(){session.current.root.root.visible=true;app.render();controls();selection();}
function motionMode(){motion?.dispose();motion=null;session.current.root.root.visible=true;session.current.runtime.setMode(mode==='play'?'play':'edit');if(mode==='play')motion=attachPanelMotion(window,motionSelection(motionStyle));show();}
function clearPreview(){previewScene?.dispose();previewScene=null;previewDocument=null;$('selection').classList.remove('invalid');if(session?.current)session.current.root.root.visible=true;}
async function change(action,message='画布修改已应用。',{keepEditing=false}={}){
 if(busy||navigation?.active)return {ok:false,error:'请先完成当前操作。'};
 const treeFocus=document.activeElement?.closest?.('#tree button')?.dataset.node;
 liveEditor.cancel();canvasGestures?.cancel('change');clearPreview();busy=true;liveCommitting=keepEditing;controls();motion?.dispose();motion=null;let result;
 try{await action();if(!keepEditing)for(const group of ['rect','text'])inputFeedback(group);show();status(message);result={ok:true};}
 catch(error){showError(error);result={ok:false,error:$('message-text').textContent};}
 finally{
  if(mode==='play'){try{motionMode();}catch(error){status('修改已保留，动效预览未能恢复：'+error.message,true);}}
  busy=false;liveCommitting=false;controls();selection();
  if(treeFocus&&(!document.activeElement||document.activeElement===document.body))layerTree.button(treeFocus)?.focus({preventScroll:true});
 }
 return result;
}
async function historyAction(action){
 if(liveSettling)await liveSettling;
 if(!session?.current||mode!=='edit'||busy||canvasGestures?.active||navigation?.active)return;
 if(action==='undo'&&pending().some(entry=>entry.nodeId===selected)){cancelLive(null);return;}
 if(!(action==='undo'?session.canUndo:session.canRedo))return;
 if(guardPending(action==='undo'?'撤销':'重做'))return;
 change(()=>session[action](),action==='undo'?'已撤销上一步画布修改。':'已重做画布修改。');
}
function historyKeydown(event){
 if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.altKey||!event.ctrlKey&&!event.metaKey)return;
 const key=event.key.toLowerCase(),action=key==='z'?(event.shiftKey?'redo':'undo'):key==='y'&&event.ctrlKey&&!event.metaKey&&!event.shiftKey?'redo':null;
 if(!action)return;
 const target=event.composedPath()[0]??event.target;
 if(target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
 event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)historyAction(action);
}
async function openVariant(key){
 const next=source.variants.find(v=>v.key===key);if(!next)throw Error('面板版本不存在。');
 liveEditor.cancel();clearPreview();liveGroup=null;
 const previous={session,variant,revisionId,state,mode,selected,savedDocument},previousScreen={width:app.screen.width,height:app.screen.height,resolution:app.renderer.resolution},previousVisible=session?.current?.root.root.visible;let candidate;busy=true;if(session)controls();
 try{
  const saved=await post('load',{artifactId,variantKey:key});variant=next;revisionId=saved.revisionId;state=initialState();mode='edit';
  if(saved.document?.canvas!==next.orientation||saved.document?.bindings?.sha256!==source.pack.manifestSha256)throw Error('编辑副本与原画布或皮肤版本不一致。');
  // Dialog backdrops and popup owners capture the logical screen on creation.
  // Set the selected board before preparing the candidate renderer.
  const board=ctx.canvases.presets[saved.document.canvas];app.renderer.resize(board.width,board.height,app.renderer.resolution);
  candidate=createSession(saved.document,ctx,prepare);await candidate.initialize();
  motion?.dispose();motion=null;if(previous.session?.current)previous.session.current.root.root.visible=false;session=candidate;session.subscribe(show);selected=sizeEditTargets(session.document,ctx).find(t=>['Panel','Dialog'].includes(t.type))?.id??session.document.rootId;savedDocument=panelDocumentFingerprint(session.document);formNode=null;textBinding=null;
  $('canvas-info').textContent=(session.document.canvas==='portrait'?'竖版 9:16':'横版 16:9')+' · '+board.width+' × '+board.height;show();focusSelected();status('滚轮缩放，空格 / 中键平移；拖动选框调整大小，自由布局中可拖动位置。');previous.session?.dispose();
 }catch(error){candidate?.dispose();app.renderer.resize(previousScreen.width,previousScreen.height,previousScreen.resolution);({session,variant,revisionId,state,mode,selected,savedDocument}=previous);if(variant)$('variant').value=variant.key;if(session?.current)session.current.root.root.visible=previousVisible;app.render();throw error;}
 finally{busy=false;if(session)controls();}
}
$('size-form').onsubmit=event=>{event.preventDefault();return settleLive('rect');};
$('text-form').onsubmit=event=>{event.preventDefault();return settleLive('text');};
$('font-size').oninput=()=>{$('font-default').checked=false;};
$('font-default').onchange=()=>{if($('font-default').checked)$('font-size').value=ctx.profile.fontSize;};
$('text-color').oninput=()=>{$('color-default').checked=false;$('text-color-hex').value=$('text-color').value;};
$('text-color-hex').oninput=()=>{$('color-default').checked=false;if(/^#[0-9a-f]{6}$/i.test($('text-color-hex').value))$('text-color').value=$('text-color-hex').value;};
$('color-default').onchange=()=>{$('text-color-hex').value=$('color-default').checked?'':$('text-color').value;};
$('size-form').addEventListener('input',event=>scheduleInputs('rect',event));$('text-form').addEventListener('input',event=>scheduleInputs('text',event));$('text-form').addEventListener('change',event=>scheduleInputs('text',event));
for(const[group,id]of [['rect','size-form'],['text','text-form']]){
 const form=$(id);
 form.addEventListener('focusout',event=>finishOnBlur(group,form,event));
 form.addEventListener('compositionstart',()=>{composing=true;liveEditor.cancel();});
 form.addEventListener('compositionend',event=>{composing=false;scheduleInputs(group,event);if(!form.contains(document.activeElement))void settleLive(group);});
 form.addEventListener('keydown',event=>{if(event.isComposing||composing||event.keyCode===229)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancelLive(group);}else if(event.key==='Enter'&&(event.target.tagName!=='TEXTAREA'||event.ctrlKey||event.metaKey)){event.preventDefault();event.stopImmediatePropagation();void settleLive(group);}});
}
$('restore-inputs').onclick=restoreInputs;$('locate-draft').onclick=async()=>{await settleLive();locateDraft();};$('locate-error').onclick=async()=>{const nodeId=errorNode;if(!nodeId)return;await chooseFromTree(nodeId);propertiesHidden=false;if(compact)treeHidden=true;panelLayout();focusSelected();layerTree.button(nodeId)?.focus({preventScroll:true});};
$('locate-owner').onclick=async()=>{const nodeId=errorOwner;if(!nodeId)return;await chooseFromTree(nodeId);propertiesHidden=false;if(compact)treeHidden=true;panelLayout();focusSelected();layerTree.button(nodeId)?.focus({preventScroll:true});};
$('undo').onclick=()=>historyAction('undo');$('redo').onclick=()=>historyAction('redo');$('reset').onclick=async()=>{if(!await settleLive())return;if(!guardPending('恢复生成布局'))return change(()=>session.commit(variant.document));};
$('mode').onclick=async()=>{if(!await settleLive())return;if(guardPending('试玩'))return;navigation?.setHand(false);mode=mode==='edit'?'play':'edit';motionMode();status(mode==='play'?'可试玩；试玩值不会保存到尺寸副本。':'已返回尺寸编辑。');};
$('fit').onclick=fit;
$('toggle-body').onclick=()=>{showBodies=!showBodies;$('toggle-body').setAttribute('aria-pressed',String(showBodies));selection();};
$('focus-selection').onclick=()=>focusSelected();
$('zoom-in').onclick=()=>zoom(cameraState.scale*1.25);$('zoom-out').onclick=()=>zoom(cameraState.scale/1.25);
$('pan-tool').onclick=()=>navigation?.setHand(!navigation.hand);
function togglePanel(which){
 focusMode=false;beforeFocus=null;if(which==='tree'){treeHidden=!treeHidden;if(compact&&!treeHidden)propertiesHidden=true;}else{propertiesHidden=!propertiesHidden;if(compact&&!propertiesHidden)treeHidden=true;}panelLayout();
}
$('toggle-tree').onclick=()=>togglePanel('tree');$('toggle-properties').onclick=()=>togglePanel('properties');
$('focus-mode').onclick=()=>{if(focusMode){({treeHidden,propertiesHidden}=beforeFocus);beforeFocus=null;focusMode=false;}else{beforeFocus={treeHidden,propertiesHidden};treeHidden=propertiesHidden=true;focusMode=true;}panelLayout();};
$('free-layout').onclick=async()=>{if(!await settleLive())return;const id=$('free-layout').dataset.node;if(id&&!guardPending('切换布局'))return change(()=>session.commit(freeLayoutDocument(session.document,{nodeId:id},ctx)),'已将分组切为自由布局，当前大小和位置保留，可拖动子项。');};
$('save').onclick=async()=>{if(!await settleLive())return;if(!guardPending('保存'))return change(async()=>{const saved=await post('save',{artifactId,variantKey:variant.key,sourceSha256:source.previewSha256,expectedRevision:revisionId,document:session.document});revisionId=saved.revisionId;savedDocument=panelDocumentFingerprint(session.document);},'编辑副本已保存，重新打开可继续调整。');};
$('download').onclick=async()=>{if(!await settleLive())return;if(!guardPending('下载 JSON'))return change(async()=>{const value=await panelSizeCopy({source,variantKey:variant.key,document:session.document});const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=session.document.id+'.sizes.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'JSON 已下载，包含编辑配置、纹理与字体资源。');};
$('variant').onchange=async()=>{const key=$('variant').value;await settleLive();if(busy||canvasGestures?.active||navigation?.active){if(variant)$('variant').value=variant.key;return;}if(dirty()){status('请先保存当前编辑副本，再切换版本。',true);$('variant').value=variant.key;return;}try{await openVariant(key);}catch(error){status(error.message,true);}};
window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
window.addEventListener('resize',()=>{const next=innerWidth<=700;if(next!==compact){if(next){desktopPanels={treeHidden,propertiesHidden};treeHidden=propertiesHidden=true;}else({treeHidden,propertiesHidden}=desktopPanels);compact=next;focusMode=false;beforeFocus=null;panelLayout();}requestAnimationFrame(viewChanged);});
panelLayout();
try{
 if(!/^[a-z][a-z0-9-]{0,48}$/.test(artifactId??''))throw Error('面板标识无效。');
 try{motionSelection(motionStyle);}catch{throw Error('动效参数无效，请从面板预览重新进入尺寸编辑。');}
 const response=await fetch('/panel-edit/source?artifact='+encodeURIComponent(artifactId));source=await response.json();if(!response.ok)throw Error(source.message??'无法读取面板。');
 skin=await loadPngSkin({manifestBytes:bytes(source.pack.manifest),manifestSha256:source.pack.manifestSha256,expectedBindings:source.pack.bindings,read:file=>bytes(source.pack.resources[file])});ctx={...source.ctx,profile:skin.profile};
 app=new Application();await app.init({width:1280,height:720,backgroundAlpha:0,antialias:true,preference:'webgl',preserveDrawingBuffer:true,layout:{autoUpdate:true,throttle:0},eventFeatures:{globalMove:true}});$('world').prepend(app.canvas);
 for(const v of source.variants){const option=document.createElement('option');option.value=v.key;option.textContent=v.label;$('variant').append(option);}
 window.actionPreview={app,get scene(){return session?.current;}};
 const preferred=params.has('variant')?source.variants.find(v=>v.key===params.get('variant')):source.variants.find(v=>v.orientation===params.get('orientation'))??source.variants[0];if(!preferred)throw Error('面板版本不存在。');$('variant').value=preferred.key;await openVariant(preferred.key);
 navigation=mountPanelCameraNavigation({viewport:$('viewport'),allowed:()=>!!session?.current&&!busy&&!canvasGestures?.active,play:()=>mode==='play',read:()=>cameraState,zoom:(factor,anchor)=>zoom(cameraState.scale*factor,anchor),pan:(initial,dx,dy)=>camera(panCamera(initial,dx,dy)),restore:initial=>camera(initial),changed:()=>{const active=!!navigation?.active;if(active!==navigationActive){navigationActive=active;controls({preserveInputs:true});}else cameraControls();selection();}});
 canvasGestures=mountPanelCanvasGestures({viewport:$('viewport'),world:$('world'),canvas:app.canvas,document:()=>session.document,context:()=>ctx,scene:()=>session.current,selected:()=>selected,canEdit:()=>mode==='edit'&&!busy&&!navigation.active&&!navigation.hand&&!navigation.space,beforeEdit:()=>settleLive(),choose:selectNode,status,
  start:()=>{controls();},preview:document=>{const next=prepare(document);previewScene?.dispose();session.current.root.root.visible=false;previewDocument=document;previewScene=next;next.root.root.visible=true;app.render();$('selection').classList.remove('invalid');values(document);selection();status('正在预览，松开应用；按 Esc 取消。');},
  invalid:error=>{clearPreview();app.render();values();selection();$('selection').classList.add('invalid');showError(error,'未应用此次拖动：');},
  cancel:({reason,moved})=>{clearPreview();show();if(moved&&reason!=='invalid')status('已取消此次画布调整。');},finish:(document,revision)=>{clearPreview();change(()=>session.commit(document,revision),'画布修改已应用，可撤销。');}
 });
 resizeObserver=new ResizeObserver(viewChanged);resizeObserver.observe($('viewport'));cameraControls();
 window.addEventListener('keydown',historyKeydown,true);
 window.panelSizeEditor={get session(){return session;},get source(){return source;},get variant(){return variant;},get selected(){return selected;},get state(){return structuredClone(state);},get mode(){return mode;},get revisionId(){return revisionId;},get dirty(){return !!dirty();},get pendingInputs(){return pending();},get gesture(){return canvasGestures.inspect();},get renderScene(){return renderScene();},get scale(){return cameraState.scale;},get camera(){return {...cameraState,focusId};},get navigation(){return {active:navigation.active,hand:navigation.hand,space:navigation.space};},discardUnsaved(){liveEditor.cancel();clearPreview();liveGroup=null;navigation.cancel('discard');canvasGestures.cancel('discard');drafts.clear();textBinding=null;savedDocument=panelDocumentFingerprint(session.document);controls();app.render();selection();},app};
 window.addEventListener('pagehide',()=>{liveEditor.cancel();window.removeEventListener('keydown',historyKeydown,true);resizeObserver?.disconnect();app.stop();navigation?.dispose();canvasGestures?.dispose();clearPreview();motion?.dispose();session?.dispose();app.destroy({removeView:true,releaseGlobalResources:false},{children:true});skin.dispose();},{once:true});
}catch(error){status('尺寸编辑未能打开：'+error.message,true);}
