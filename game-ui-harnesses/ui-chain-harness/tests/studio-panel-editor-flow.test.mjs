import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {editorData} from '../src/panel/data.mjs';
import {createSession} from '../src/panel/session.mjs';
import {indexDocument,validateDocument} from '../src/panel/document.mjs';
import * as edits from '../src/panel/size-edit.mjs';
import * as drafts from '../src/studio/panel-editor-drafts.mjs';
import {panelFormDraft,panelTextInputValue} from '../src/studio/panel-editor-forms.mjs';
import {createPanelEditorTree} from '../src/studio/panel-editor-tree.mjs';
import {panelEditorError} from '../src/studio/panel-editor-errors.mjs';
import {frameCamera} from '../src/studio/panel-camera.mjs';
import {canvasResolution} from '../src/studio/canvas-resolution.mjs';
import {createPanelEditorLive} from '../src/studio/panel-editor-live.mjs';

// Execute the actual page handlers with an offline DOM double and real document,
// layout and session code. This does not observe or control a browser surface.
const page=(await readFile(new URL('../src/studio/panel-size.mjs',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const prefix=page.slice(0,page.indexOf('\ntry{\n if(!/^[a-z]')).replace(/^import .*;\n/gm,'');
assert(prefix.includes("$('save').onclick="));
const ctx=await editorData();
function dom(){
 const elements=new Map(),document={activeElement:null};
 function element(tag='div'){
  const classes=new Set();
  const el={tagName:tag.toUpperCase(),ownerDocument:document,children:[],dataset:{},get value(){return this._value??'';},set value(value){this._value=String(value);},clientWidth:900,clientHeight:600,checked:false,disabled:false,hidden:false,style:{setProperty(){}},classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));},toggle(name,on){if(on??!classes.has(name))classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},listeners:{},setAttribute(name,value){this[name]=value;},addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},insertBefore(node,before){const i=this.children.indexOf(node);if(i>=0)this.children.splice(i,1);this.children.splice(before?this.children.indexOf(before):this.children.length,0,node);},querySelectorAll(selector){const all=this.children.flatMap(child=>[child,...child.querySelectorAll(selector)]);return all.filter(child=>selector==='[data-text-field]'?Object.hasOwn(child.dataset,'textField'):selector==='input,textarea'?['INPUT','TEXTAREA'].includes(child.tagName):false);},querySelector(selector){return this.querySelectorAll(selector)[0]??null;},scrollIntoView(){},focus(){document.activeElement=this;},remove(){for(const parent of elements.values()){const i=parent.children.indexOf(this);if(i>=0)parent.children.splice(i,1);}},get textContent(){return this._text??'';},set textContent(value){this._text=String(value);}};
  return el;
 }
 const createElement=element;
 element=(tag='div')=>{const el=createElement(tag);el.contains=node=>el===node||el.children.some(child=>child.contains?.(node));return el;};
 document.createElement=element;document.getElementById=id=>{if(!elements.has(id)){const input=['x','y','width','height','font-size','font-default','color-default','text-color','text-color-hex'].includes(id),el=element(input?'input':'div');el.id=id;elements.set(id,el);}return elements.get(id);};document.documentElement=element();document.body=element();
 for(const[group,ids]of [['size-form',['x','y','width','height']],['text-form',['text-fields','font-size','font-default','color-default','text-color','text-color-hex']]])document.getElementById(group).append(...ids.map(document.getElementById));
 for(const el of elements.values())el.contains=node=>el===node||el.children.some(child=>child===node||child.contains?.(node));
 return {document,$:document.getElementById};
}
function fixture(){
 const node=(id,type,size,props={},slots={})=>({id,name:id,recipeRef:type+'@1.0.0',size,props,slots});
 const {width,height}=ctx.canvases.presets.landscape,root=node('artboard','container',{width,height},{}, {children:['first','second']});root.layout={childrenMode:'free',padding:0};
 const first=node('first','button',{width:300,height:60},{label:'开始'}),second=node('second','button',{width:300,height:60},{label:'返回'});first.position={x:40,y:40};second.position={x:40,y:140};
 return validateDocument({kind:'ui_panel_document',version:'0.3',id:'editor-flow',revision:0,title:'离线编辑测试',canvas:'landscape',bindings:ctx.binding,rootId:root.id,nodes:[root,first,second]},ctx);
}
async function editor({text,fontSize,height}={}){
 const ui=dom(),requests=[],window={addEventListener(){},removeEventListener(){}};
 const doc=fixture();if(text!==undefined){const node=doc.nodes.find(n=>n.id==='first');node.recipeRef='text@1.0.0';node.props={text,textStyleRef:'body'};}
 if(fontSize!==undefined){const node=doc.nodes.find(n=>n.id==='first');Object.assign(node.props,{fontSize,wrap:'none',overflow:'error'});}if(height!==undefined)doc.nodes.find(n=>n.id==='first').size.height=height;
 const scene=()=>({root:{root:{visible:true}},runtime:{handles:new Map()},dispose(){this.disposed=true;}}),session=await createSession(doc,ctx,scene).initialize();
 const sandbox={...edits,...drafts,createSession,indexDocument,panelFormDraft,panelTextInputValue,createPanelEditorTree,panelEditorError,createPanelEditorLive,frameCamera,canvasResolution,devicePixelRatio:1,fixtureSession:session,fixtureContext:ctx,fixturePrepare:scene,document:ui.document,window,parent:window,innerWidth:1280,location:{hash:'#artifact=fixture',origin:'http://fixture',reload(){}},URLSearchParams,Object,structuredClone,console,setTimeout,clearTimeout,queueMicrotask,requestAnimationFrame(){return 1;},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({revisionId:'saved-1'})};}};
 vm.runInNewContext(prefix+`\nctx=fixtureContext;session=fixtureSession;source={variants:[{key:'a'},{key:'b'}]};variant={key:'a',document:session.document};selected='first';savedDocument=panelDocumentFingerprint(session.document);app={render(){},renderer:{resolution:1,resize(){}}};prepare=fixturePrepare;session.subscribe(show);controls();globalThis.editor={select:chooseFromTree,capture:captureInputs,showValues:values,flush:()=>liveEditor.flush(),finish:settleLive,cancel:cancelLive,get preview(){return previewDocument;},get pending(){return pending();},get dirty(){return !!dirty();},get selected(){return selected;},get document(){return session.document;},get revision(){return session.revision;},showError};`,sandbox);
 return {...ui,requests,session,editor:sandbox.editor};
}
const event={preventDefault(){}};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function inputText(ui,value){const input=ui.$('text-fields').querySelector('[data-text-field]');input.value=value;ui.editor.capture();return input;}

test('switching layers automatically applies valid values while preserving invalid per-node input',async()=>{
 const ui=await editor();ui.$('width').value='0310.00';inputText(ui,'新的开始');await ui.editor.select('second');ui.$('width').value='';ui.editor.capture();await ui.editor.select('first');
 assert.equal(ui.$('width').value,'310');assert.equal(ui.$('text-fields').querySelector('[data-text-field]').value,'新的开始');assert.equal(ui.editor.pending.length,1);assert.equal(ui.editor.dirty,true);assert.equal(ui.editor.document.nodes.find(n=>n.id==='first').size.width,310);
 await ui.editor.select('second');assert.equal(ui.$('width').value,'');
});
test('save and export refuse invalid values, locate them, and never submit an older document',async()=>{
 const ui=await editor();inputText(ui,'长文案'.repeat(400));await ui.editor.select('second');await ui.$('save').onclick();await ui.$('download').onclick();
 assert.equal(ui.requests.length,0);assert.equal(ui.editor.selected,'first');assert.equal(ui.document.activeElement,ui.$('text-fields').querySelector('[data-text-field]'));
});
test('applying dimensions preserves text drafts, failed text retains inputs and history, restore is explicit',async()=>{
 const ui=await editor();ui.$('width').value='310';inputText(ui,'长文案'.repeat(400));ui.$('size-form').onsubmit(event);await settle();
 assert.equal(ui.editor.document.nodes.find(n=>n.id==='first').size.width,310);assert.equal(ui.editor.pending[0].values.rect,undefined);assert(ui.editor.pending[0].values.text);
 const revision=ui.editor.revision;await ui.$('text-form').onsubmit(event);assert.equal(ui.editor.revision,revision);assert.equal(ui.$('text-fields').querySelector('[data-text-field]').value,'长文案'.repeat(400));assert.equal(ui.$('locate-error').hidden,false,ui.$('message-text').textContent);
 ui.$('restore-inputs').onclick();assert.equal(ui.editor.pending.length,0);assert.equal(ui.$('text-fields').querySelector('[data-text-field]').value,'开始');assert.equal(ui.editor.revision,revision);
});
test('undo back to saved content clears dirty despite monotonically increasing revisions',async()=>{
 const ui=await editor();inputText(ui,'继续');await ui.$('text-form').onsubmit(event);ui.$('save').onclick();await settle();const savedRevision=ui.editor.revision;
 ui.$('width').value='310';ui.editor.capture();ui.$('size-form').onsubmit(event);await settle();assert.equal(ui.editor.dirty,true);
 ui.$('undo').onclick();await settle();assert(ui.editor.revision>savedRevision);assert.equal(ui.editor.dirty,false,JSON.stringify({pending:ui.editor.pending,message:ui.$('message-text').textContent,requests:ui.requests}));assert.equal(ui.$('save').disabled,true);
});
test('fractional actual dimensions use the same tolerance for drafts and applying',async()=>{
 const ui=await editor();ui.$('width').value='300.334';ui.editor.capture();ui.$('size-form').onsubmit(event);await settle();
 ui.$('width').value='300.338';ui.editor.capture();assert.equal(ui.editor.pending.length,0);const before=ui.editor.revision;ui.$('size-form').onsubmit(event);await settle();assert.equal(ui.editor.revision,before);
});
test('history restores layer focus if temporary disabling blurred it to the page body',async()=>{
 const ui=await editor();inputText(ui,'继续');await ui.$('text-form').onsubmit(event);
 const button=ui.$('tree').children.find(b=>b.dataset.node==='first');button.closest=selector=>selector==='#tree button'?button:null;let disabled=false;
 Object.defineProperty(button,'disabled',{get:()=>disabled,set:value=>{disabled=value;if(value&&ui.document.activeElement===button)ui.document.activeElement=ui.document.body;}});
 button.focus();ui.$('undo').onclick();await settle();assert.equal(ui.document.activeElement,button);assert.equal(button.disabled,false);
});
test('a gesture preview and failed-gesture value reset cannot erase existing raw dimension inputs',async()=>{
 const ui=await editor();ui.$('width').value='0320.00';ui.editor.capture();
 ui.editor.showValues(edits.rectangleEditDocument(ui.editor.document,{nodeId:'first',width:310},ctx));assert.equal(ui.$('width').value,'0320.00');
 ui.editor.showValues();ui.editor.capture();assert.equal(ui.editor.pending[0].values.rect.width,'0320.00');assert.equal(ui.editor.document.nodes.find(n=>n.id==='first').size.width,300);
});
function fire(ui,form,name,target,extra={}){for(const listener of ui.$(form).listeners[name]??[])listener({target,preventDefault(){},stopImmediatePropagation(){},...extra});}
test('numeric input previews without a submit and commits one undo step when the group loses focus',async()=>{
 const ui=await editor(),input=ui.$('width');input.focus();input.value='310';fire(ui,'size-form','input',input);await ui.editor.flush();assert.equal(ui.editor.preview.nodes.find(n=>n.id==='first').size.width,310);assert.equal(ui.editor.revision,0);assert.equal(ui.document.activeElement,input);
 input.value='330';fire(ui,'size-form','input',input);await ui.editor.flush();assert.equal(ui.editor.preview.nodes.find(n=>n.id==='first').size.width,330);assert.equal(ui.editor.revision,0);
 ui.document.activeElement=ui.document.body;fire(ui,'size-form','focusout',input);await settle();assert.equal(ui.editor.document.nodes.find(n=>n.id==='first').size.width,330);assert.equal(ui.editor.revision,1);assert.equal(ui.editor.preview,null);
 await ui.$('undo').onclick();assert.equal(ui.editor.document.nodes.find(n=>n.id==='first').size.width,300);
});
test('font size and color preview from input while retaining the input and current authored document',async()=>{
 const ui=await editor(),font=ui.$('font-size');font.focus();font.value='20';font.oninput();fire(ui,'text-form','input',font);await ui.editor.flush();assert.equal(ui.editor.preview.nodes.find(n=>n.id==='first').props.fontSize,20);assert.equal(ui.editor.document.nodes.find(n=>n.id==='first').props.fontSize,undefined);
 const textInput=ui.$('text-fields').querySelector('[data-text-field]');const color=ui.$('text-color');color.value='#dd7744';color.oninput();fire(ui,'text-form','input',color);await ui.editor.flush();assert.equal(ui.editor.preview.nodes.find(n=>n.id==='first').props.textColor,'#dd7744');await ui.editor.finish('text');assert.equal(ui.editor.revision,1);assert.equal(ui.$('text-fields').querySelector('[data-text-field]'),textInput);
});
test('invalid latest input clears an older valid preview and never silently commits it',async()=>{
 const ui=await editor(),input=ui.$('width');input.value='310';fire(ui,'size-form','input',input);await ui.editor.flush();assert(ui.editor.preview);
 input.value='';fire(ui,'size-form','input',input);await ui.editor.flush();assert.equal(ui.editor.preview,null);assert.equal(await ui.editor.finish('rect'),false);assert.equal(ui.editor.revision,0);assert.equal(input.value,'');assert.equal(ui.editor.pending[0].values.rect.width,'');assert.equal(ui.$('locate-error').hidden,false);
});
test('composition waits for completion and Escape cancels the round without touching history',async()=>{
 const ui=await editor(),input=ui.$('text-fields').querySelector('[data-text-field]');input.focus();fire(ui,'text-form','compositionstart',input);input.value='新的文字';fire(ui,'text-form','input',input,{isComposing:true});await ui.editor.flush();assert.equal(ui.editor.preview,null);assert.equal(ui.editor.revision,0);
 fire(ui,'text-form','compositionend',input);await ui.editor.flush();assert.equal(ui.editor.preview.nodes.find(n=>n.id==='first').props.label,'新的文字');fire(ui,'text-form','keydown',input,{key:'Escape'});assert.equal(ui.editor.preview,null);assert.equal(input.value,'开始');assert.equal(ui.editor.revision,0);assert.equal(ui.document.activeElement,input);assert.equal(ui.editor.pending.length,0);
});
test('save flushes current valid input and submits that value once without any Apply click',async()=>{
 const ui=await editor(),input=ui.$('width');input.value='340';fire(ui,'size-form','input',input);await ui.$('save').onclick();assert.equal(ui.requests.length,1);const body=JSON.parse(ui.requests[0].options.body);assert.equal(body.document.nodes.find(n=>n.id==='first').size.width,340);assert.equal(ui.editor.revision,1);assert.equal(ui.editor.dirty,false);await ui.editor.flush();assert.equal(ui.editor.preview,null);
});
test('focus/blur and style-only editing preserve the original frozen CRLF text bytes',async()=>{
 const original='第一行\r\n第二行',ui=await editor({text:original}),input=ui.$('text-fields').querySelector('[data-text-field]');assert.equal(input.value,'第一行\n第二行');await ui.editor.finish('text');assert.equal(ui.editor.revision,0);assert.equal(ui.editor.document.nodes.find(n=>n.id==='first').props.text,original);
 const font=ui.$('font-size');font.value='18';font.oninput();fire(ui,'text-form','input',font);await ui.editor.flush();assert.equal(ui.editor.preview.nodes.find(n=>n.id==='first').props.text,original);await ui.editor.finish('text');assert.equal(ui.editor.revision,1);assert.equal(ui.editor.document.nodes.find(n=>n.id==='first').props.text,original);
});
test('restoring raw inputs by its button bypasses blur auto-commit',async()=>{
 const ui=await editor(),input=ui.$('width');input.value='350';fire(ui,'size-form','input',input);await ui.editor.flush();ui.$('restore-inputs').focus();fire(ui,'size-form','focusout',input,{relatedTarget:ui.$('restore-inputs')});ui.$('restore-inputs').onclick();await settle();assert.equal(ui.editor.preview,null);assert.equal(ui.editor.pending.length,0);assert.equal(ui.editor.revision,0);assert.equal(ui.editor.document.nodes.find(n=>n.id==='first').size.width,300);
});
test('position and both dimensions preview together and publish as one rectangle change',async()=>{
 const ui=await editor();for(const[id,value]of Object.entries({x:'80',y:'90',width:'330',height:'80'})){ui.$(id).value=value;fire(ui,'size-form','input',ui.$(id));}
 await ui.editor.flush();const preview=ui.editor.preview.nodes.find(n=>n.id==='first');assert.deepEqual({...preview.position},{x:80,y:90});assert.deepEqual({...preview.size},{width:330,height:80});assert.equal(ui.editor.revision,0);
 await ui.editor.finish('rect');assert.equal(ui.editor.revision,1);await ui.$('undo').onclick();const original=ui.editor.document.nodes.find(n=>n.id==='first');assert.deepEqual({...original.position},{x:40,y:40});assert.deepEqual({...original.size},{width:300,height:60});
});

test('invalid rectangle input is explained beside its form without moving input focus',async()=>{
 const ui=await editor(),input=ui.$('width');input.focus();input.value='';fire(ui,'size-form','input',input);await ui.editor.flush();
 assert.equal(ui.$('rect-feedback').textContent,ui.$('message-text').textContent);assert.match(ui.$('rect-feedback').textContent,/请输入有效/);assert.equal(ui.$('rect-feedback').classList.contains('error'),true);assert.equal(ui.$('size-form')['aria-invalid'],'true');assert.equal(ui.document.activeElement,input);assert.equal(ui.editor.revision,0);assert.equal(input.value,'');
 await ui.editor.finish('rect');assert.equal(ui.$('rect-feedback').classList.contains('error'),true);assert.equal(ui.editor.revision,0);
 fire(ui,'size-form','keydown',input,{key:'Escape'});assert.equal(ui.$('rect-feedback').textContent,'');assert.equal(ui.$('size-form')['aria-invalid'],'false');assert.equal(ui.document.activeElement,input);
});

test('restoring original rectangle values clears its stale error and locator without a commit',async()=>{
 const ui=await editor(),input=ui.$('width');input.value='';fire(ui,'size-form','input',input);await ui.editor.flush();assert.equal(ui.$('message').classList.contains('error'),true);assert.equal(ui.$('locate-error').hidden,false);
 input.value='300';fire(ui,'size-form','input',input);await ui.editor.flush();assert.equal(ui.editor.pending.length,0);assert.equal(ui.editor.dirty,false);assert.equal(ui.editor.revision,0);assert.equal(ui.$('message').classList.contains('error'),false);assert.equal(ui.$('locate-error').hidden,true);assert.equal(ui.$('rect-feedback').textContent,'');assert.equal(ui.$('size-form')['aria-invalid'],'false');
});

test('restoring the default font clears only the input error and keeps frozen text intact',async()=>{
 const ui=await editor(),font=ui.$('font-size');font.focus();font.value='';font.oninput();fire(ui,'text-form','input',font);await ui.editor.flush();assert.equal(ui.$('text-feedback').classList.contains('error'),true);assert.equal(ui.$('text-form')['aria-invalid'],'true');
 ui.$('font-default').checked=true;ui.$('font-default').onchange();fire(ui,'text-form','change',ui.$('font-default'));await ui.editor.flush();assert.equal(ui.$('message').classList.contains('error'),false);assert.equal(ui.$('text-feedback').textContent,'');assert.equal(ui.$('text-form')['aria-invalid'],'false');assert.equal(ui.editor.pending.length,0);assert.equal(ui.editor.revision,0);assert.equal(ui.editor.document.nodes.find(n=>n.id==='first').props.label,'开始');
});

test('new layer selection clears inline feedback but keeps an unresolved draft on its original node',async()=>{
 const ui=await editor(),input=ui.$('width');input.value='';fire(ui,'size-form','input',input);await ui.editor.flush();await ui.editor.select('second');assert.equal(ui.$('rect-feedback').textContent,'');assert.equal(ui.$('size-form')['aria-invalid'],'false');assert.equal(ui.editor.pending[0].nodeId,'first');assert.equal(ui.editor.pending[0].values.rect.width,'');assert.equal(ui.$('text-fields').querySelector('[data-text-field]')['aria-describedby'],'text-feedback');
});

test('restoring raw values does not erase a newer unrelated error from the status bar',async()=>{
 const ui=await editor(),input=ui.$('width');input.value='';fire(ui,'size-form','input',input);await ui.editor.flush();ui.editor.showError(Object.assign(Error('other renderer failure'),{nodeId:'second'}));input.value='300';fire(ui,'size-form','input',input);await ui.editor.flush();assert.equal(ui.editor.pending.length,0);assert.equal(ui.$('rect-feedback').textContent,'');assert.equal(ui.$('message').classList.contains('error'),true);assert.match(ui.$('message-text').textContent,/other renderer failure/);assert.equal(ui.$('locate-error').hidden,false);
});

test('smaller rectangle and font drafts settle together once even when the rectangle alone cannot fit',async()=>{
 const ui=await editor({text:'Hello',fontSize:32,height:60}),height=ui.$('height'),font=ui.$('font-size');height.value='30';fire(ui,'size-form','input',height);await ui.editor.flush();assert.equal(ui.editor.preview,null);assert.equal(ui.$('rect-feedback').classList.contains('error'),true);
 font.value='12';font.oninput();fire(ui,'text-form','input',font);await ui.editor.flush();assert.equal(ui.editor.preview.nodes.find(n=>n.id==='first').props.fontSize,12);assert.equal(ui.editor.revision,0);
 assert.equal(await ui.editor.finish(),true,ui.$('message-text').textContent);const node=ui.editor.document.nodes.find(n=>n.id==='first');assert.equal(node.size.height,30);assert.equal(node.props.fontSize,12);assert.equal(ui.editor.revision,1);assert.equal(ui.editor.pending.length,0);assert.equal(ui.$('size-form')['aria-invalid'],'false');assert.equal(ui.$('text-form')['aria-invalid'],'false');
 await ui.$('undo').onclick();const original=ui.editor.document.nodes.find(n=>n.id==='first');assert.equal(original.size.height,60);assert.equal(original.props.fontSize,32);assert.equal(ui.session.canUndo,false);
});

test('save applies a larger font and rectangle as one complete transaction',async()=>{
 const ui=await editor({text:'Hello',fontSize:12,height:30}),font=ui.$('font-size'),height=ui.$('height');font.value='32';font.oninput();fire(ui,'text-form','input',font);await ui.editor.flush();assert.equal(ui.editor.preview,null);
 height.value='60';fire(ui,'size-form','input',height);await ui.editor.flush();await ui.$('save').onclick();assert.equal(ui.requests.length,1,ui.$('message-text').textContent);const saved=JSON.parse(ui.requests[0].options.body).document.nodes.find(n=>n.id==='first');assert.equal(saved.size.height,60);assert.equal(saved.props.fontSize,32);assert.equal(ui.editor.revision,1);assert.equal(ui.editor.pending.length,0);assert.equal(ui.editor.dirty,false);
});

test('a combined edit that still cannot fit preserves both raw groups and the original history',async()=>{
 const ui=await editor({text:'Hello',fontSize:32,height:60}),height=ui.$('height'),font=ui.$('font-size');height.value='24';fire(ui,'size-form','input',height);font.value='96';font.oninput();fire(ui,'text-form','input',font);const before=ui.editor.document;await ui.$('save').onclick();assert.equal(ui.requests.length,0);assert.deepEqual(ui.editor.document,before);assert.equal(ui.editor.revision,0);assert.equal(ui.session.canUndo,false);assert.equal(ui.session.canRedo,false);assert.equal(ui.editor.pending[0].values.rect.height,'24');assert.equal(ui.editor.pending[0].values.text.fontSize,'96');assert.equal(ui.$('rect-feedback').classList.contains('error'),true);assert.equal(ui.$('text-feedback').classList.contains('error'),true);
});

test('undo and redo clear stale inline success messages while retaining the new history status',async()=>{
 const ui=await editor();inputText(ui,'继续');await ui.editor.finish('text');assert.match(ui.$('text-feedback').textContent,/已自动应用/);assert.equal(ui.session.canUndo,true);
 await ui.$('undo').onclick();assert.equal(ui.$('text-feedback').textContent,'');assert.equal(ui.$('rect-feedback').textContent,'');assert.match(ui.$('message-text').textContent,/已撤销/);assert.equal(ui.session.canUndo,false);assert.equal(ui.session.canRedo,true);assert.equal(ui.$('text-form')['aria-invalid'],'false');
 await ui.$('redo').onclick();assert.equal(ui.$('text-feedback').textContent,'');assert.equal(ui.$('rect-feedback').textContent,'');assert.match(ui.$('message-text').textContent,/已重做/);assert.equal(ui.session.canUndo,true);assert.equal(ui.session.canRedo,false);
});
