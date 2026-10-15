// Offline acceptance: verified frozen artwork, a temporary copy store and no
// model/generation adapters. This never connects to the user's running Studio.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {studioSnapshot} from '../src/studio/catalog.mjs';
import {studioServer} from '../src/studio/tasks.mjs';
import {studioStyles} from '../src/studio/styles.mjs';
import {studioPanelPresets} from '../src/studio/panel-presets.mjs';
import {panelEditController} from '../src/studio/panel-edit.mjs';
import {panelEditSourceFromSnapshot} from '../src/studio/panel-edit-source.mjs';
import {sizeEditDocument,sizeEditTargets,rectangleEditDocument,positionEditDocument,freeLayoutDocument} from '../src/panel/size-edit.mjs';
import {hash,json} from '../src/skins/package.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const {values}=parseArgs({options:{port:{type:'string'},screenshots:{type:'string'},project:{type:'string'},artifact:{type:'string'},'small-panel':{type:'boolean'}}});
const port=Number(values.port??4322),base='http://127.0.0.1:'+port;
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid fixture port');
const evidence=resolve(values.screenshots??join(tmpdir(),'ui-chain-panel-size-evidence'));
const repository=resolve(root,'../..'),evidenceRelative=relative(repository,evidence);
if(!isAbsolute(evidenceRelative)&&evidenceRelative!=='..'&&!evidenceRelative.startsWith('..'+sep))throw Error('Screenshots must be outside the repository');
await mkdir(evidence,{recursive:true});
const storageRoot=await mkdtemp(join(tmpdir(),'ui-chain-panel-size-'));
 const checks=[],errors=[],network=[],pendingSourceRequests=new Map(),check=(id,result=true)=>{assert.ok(result,id);checks.push(id);};
const bounded=(promise,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(label+' timed out; '+errors.join('; '))),30000))]).finally(()=>clearTimeout(timer));};
let browser,server;
const report={kind:'ui_studio_panel_size_check',version:'1.0',browser:'Edge / Playwright; Browser plugin not available',modelCalls:0,checks,errors};
try{
 const project=JSON.parse(await readFile(resolve(root,values.project??'work/studio/project.json')));
 const snapshot=await studioSnapshot(root,project),artifactId=values.artifact??snapshot.items.find(item=>item.id==='actions'&&item.type==='panel')?.id??snapshot.items.find(item=>item.type==='panel')?.id;
 await studioStyles(root,snapshot);studioPanelPresets(snapshot);
 if(!artifactId)throw Error('A verified generated panel fixture is required');
 const source=panelEditSourceFromSnapshot(snapshot,artifactId);
 const variant=source.variants.find(v=>v.key==='form-portrait')??source.variants.find(v=>v.orientation==='portrait')??source.variants[0];
 report.artifactId=artifactId;report.variantKey=variant.key;report.sourceSha256=source.previewSha256;
 const originalFiles=new Map([...snapshot.files].filter(([name])=>name.startsWith('artifacts/')).map(([name,bytes])=>[name,hash(bytes)]));
 const controller=panelEditController(storageRoot,snapshot);
 server=studioServer(snapshot,port,async()=>[],undefined,undefined,undefined,undefined,undefined,async()=>({projects:[]}),controller);
 await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',accept);});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1.25,serviceWorkers:'block',acceptDownloads:true,hasTouch:true});
 let nativeDialogs=0;
 const observe=page=>{
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.type()+': '+message.text());});
  page.on('request',request=>{if(/\/(?:generation|pipeline)\/|\/projects\/plan/.test(request.url()))network.push(request.url());});
  page.on('request',request=>{if(request.url().startsWith(base+'/panel-edit/source?')||request.url()===base+'/panel-edit/load')pendingSourceRequests.set(request,{url:request.url(),method:request.method(),startedAt:Date.now()});});
  for(const event of ['requestfinished','requestfailed'])page.on(event,request=>pendingSourceRequests.delete(request));
  page.on('dialog',dialog=>{nativeDialogs++;return dialog.accept();});
 };
 const page=await context.newPage();observe(page);
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')||/^(data:|blob:)/.test(route.request().url())?route.continue():route.abort());
 const route=base+'/panel-size.html#artifact='+encodeURIComponent(artifactId)+'&orientation='+variant.orientation;
 const ready=async p=>{try{await p.waitForFunction(()=>!!window.panelSizeEditor?.session?.current,{},{timeout:30000});}catch(error){
  const pending=()=>[...pendingSourceRequests.values()].map(({startedAt,...request})=>({...request,elapsedMs:Date.now()-startedAt}));let timer;
  const text=(async()=>{try{return {message:await p.locator('#message').textContent({timeout:1000}),pending:pending()};}catch(failure){return {message:'Diagnostic text unavailable: '+failure.message,pending:pending()};}})();
  const diagnostic=await Promise.race([text,new Promise(accept=>timer=setTimeout(()=>accept({message:'Diagnostic capture timed out after 3000ms',pending:pending()}),3000))]).finally(()=>clearTimeout(timer));
  report.readyFailure={...diagnostic,lastCheck:checks.at(-1)??'initializing'};throw Error(error.message+'; ready diagnostic: '+JSON.stringify(report.readyFailure));
 }};
 const active=async()=>page.evaluate(()=>({document:panelSizeEditor.session.document,selected:panelSizeEditor.selected,revisionId:panelSizeEditor.revisionId,dirty:panelSizeEditor.dirty,mode:panelSizeEditor.mode,variant:panelSizeEditor.variant.key}));
 const sameGeometry=(a,b)=>JSON.stringify(a.nodes.map(n=>({id:n.id,size:n.size,sizing:n.sizing,position:n.position,layout:n.layout})))===JSON.stringify(b.nodes.map(n=>({id:n.id,size:n.size,sizing:n.sizing,position:n.position,layout:n.layout})));
 const choose=async id=>{if(!await page.locator('#tree').isVisible())await page.locator('#toggle-tree').click();await page.locator('#tree button[data-node="'+id+'"]').click();await page.waitForFunction(id=>panelSizeEditor.selected===id,id);if(await page.evaluate(()=>innerWidth<=700)&&await page.locator('#toggle-tree').getAttribute('aria-expanded')==='true')await page.locator('#toggle-tree').click();};
 const apply=async edit=>{
  await choose(edit.nodeId);if(edit.width!==undefined)await page.locator('#width').fill(String(edit.width));if(edit.height!==undefined)await page.locator('#height').fill(String(edit.height));
  const revision=await page.evaluate(()=>panelSizeEditor.session.revision);await page.locator('#apply').click();
  await page.waitForFunction(revision=>panelSizeEditor.session.revision>revision||document.querySelector('#message').classList.contains('error'),revision);
  check('valid resize transaction '+edit.nodeId+' accepted',!await page.locator('#message').evaluate(node=>node.classList.contains('error')));
 };
 const clickControl=async id=>{
  const point=await page.evaluate(id=>{const p=panelSizeEditor,h=p.session.current.runtime.handles.get(id),b=h.adapter.view.getBounds(),canvas=p.app.canvas.getBoundingClientRect();return {x:canvas.left+(b.x+b.width/2)*canvas.width/p.app.screen.width,y:canvas.top+(b.y+b.height/2)*canvas.height/p.app.screen.height};},id);
  await page.mouse.click(point.x,point.y);
 };
 let resumeInitialLoad,initialLoadRequested;
 const initialLoadBlocked=new Promise(accept=>resumeInitialLoad=accept),initialLoadStarted=new Promise(accept=>initialLoadRequested=accept);
 const delayInitialLoad=async route=>{initialLoadRequested();await initialLoadBlocked;return route.continue();};
 let navigationError;await page.route(base+'/panel-edit/load',delayInitialLoad);const entering=page.goto(route).catch(error=>{navigationError=error;});await bounded(initialLoadStarted,'Initial panel document request');
 await page.setViewportSize({width:1366,height:900});await page.evaluate(()=>new Promise(accept=>requestAnimationFrame(()=>requestAnimationFrame(accept))));
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>new Promise(accept=>requestAnimationFrame(()=>requestAnimationFrame(accept))));
 check('viewport resize during delayed initial document load raises no runtime error',errors.length===0);
 resumeInitialLoad();await entering;if(navigationError)throw navigationError;await ready(page);await page.unroute(base+'/panel-edit/load',delayInitialLoad);
 if(await page.locator('#variant').inputValue()!==variant.key){await page.locator('#variant').selectOption(variant.key);await page.waitForFunction(key=>panelSizeEditor.variant.key===key,variant.key);}
 check('page identity',await page.title()==='调整面板尺寸 · UI Studio');check('meaningful editor content',await page.locator('#tree button').count()>3&&await page.locator('#world canvas').count()===1);
 check('no framework error overlay',await page.locator('vite-error-overlay,nextjs-portal').count()===0);
 const initial=await active();check('preselected canvas orientation retained',initial.document.canvas===variant.orientation);check('original skin binding retained',initial.document.bindings.sha256===source.pack.manifestSha256);
 const cameraAuthoring=()=>page.evaluate(()=>({document:panelSizeEditor.session.document,revision:panelSizeEditor.session.revision,canUndo:panelSizeEditor.session.canUndo,canRedo:panelSizeEditor.session.canRedo,dirty:panelSizeEditor.dirty,state:panelSizeEditor.state}));
 const sameCameraAuthoring=async before=>JSON.stringify(await cameraAuthoring())===JSON.stringify(before);
 const surfaceDisplay=()=>page.evaluate(()=>{const p=panelSizeEditor,h=[...p.session.current.runtime.handles.values()].find(h=>['Panel','Dialog'].includes(h.recipe.type)),canvas=p.app.canvas.getBoundingClientRect(),view=document.querySelector('#viewport').getBoundingClientRect();return {scale:p.scale,width:h.size.width*canvas.width/p.app.screen.width,height:h.size.height*canvas.height/p.app.screen.height,viewport:{width:view.width,height:view.height}};});
 const initialCameraAuthoring=await cameraAuthoring(),defaultDisplay=await surfaceDisplay();await page.locator('#fit').click();const fullDisplay=await surfaceDisplay();
 report.defaultFocus={focused:defaultDisplay,wholeCanvas:fullDisplay,scaleRatio:defaultDisplay.scale/fullDisplay.scale};
 check('default outer panel focus is materially larger than whole-canvas fit',defaultDisplay.scale>=fullDisplay.scale*1.3);
 check('default panel focus provides an operable screen rectangle',defaultDisplay.width>=240&&defaultDisplay.height>=140&&defaultDisplay.width<=defaultDisplay.viewport.width+.6&&defaultDisplay.height<=defaultDisplay.viewport.height+.6);
 await page.locator('#focus-selection').click();check('focusing and whole-canvas fit do not change authoring history dirty state or play values',await sameCameraAuthoring(initialCameraAuthoring));
 const cameraPoint=async point=>page.evaluate(point=>{const c=panelSizeEditor.app.canvas.getBoundingClientRect();return {x:(point.x-c.left)*panelSizeEditor.app.screen.width/c.width,y:(point.y-c.top)*panelSizeEditor.app.screen.height/c.height,scale:panelSizeEditor.scale,camera:panelSizeEditor.camera};},point);
 const viewBox=await page.locator('#viewport').boundingBox(),anchor={x:viewBox.x+viewBox.width*.57,y:viewBox.y+viewBox.height*.43},beforeWheel=await cameraPoint(anchor);
 await page.mouse.move(anchor.x,anchor.y);await page.mouse.wheel(0,100);await page.waitForFunction(scale=>panelSizeEditor.scale!==scale,beforeWheel.scale);const afterWheel=await cameraPoint(anchor);
 check('wheel zoom keeps the logical point under the cursor fixed',Math.abs(afterWheel.x-beforeWheel.x)<1&&Math.abs(afterWheel.y-beforeWheel.y)<1);
 for(const [kind,dx,dy]of [['middle',31,19],['space',-23,15],['tool',17,-11]]){
  if(kind==='space'){await page.locator('#viewport').focus();await page.keyboard.down('Space');}if(kind==='tool')await page.locator('#pan-tool').click();
  const before=await page.evaluate(()=>panelSizeEditor.camera);await page.mouse.move(anchor.x,anchor.y);await page.mouse.down({button:kind==='middle'?'middle':'left'});await page.mouse.move(anchor.x+dx,anchor.y+dy,{steps:3});
  check(kind+' navigation owns the pointer without opening a document gesture',await page.evaluate(()=>panelSizeEditor.navigation.active&&!panelSizeEditor.gesture.active));await page.mouse.up({button:kind==='middle'?'middle':'left'});if(kind==='space')await page.keyboard.up('Space');if(kind==='tool')await page.locator('#pan-tool').click();
  const after=await page.evaluate(()=>panelSizeEditor.camera);check(kind+' panning changes viewport pixels only',Math.abs(after.x-before.x-dx)<.6&&Math.abs(after.y-before.y-dy)<.6);
 }
 check('wheel and all panning modes preserve authoring state',await sameCameraAuthoring(initialCameraAuthoring));
 const expandedWidth=(await page.locator('#viewport').boundingBox()).width;
 await page.locator('#toggle-tree').click();check('collapsing the tree increases canvas width',(await page.locator('#viewport').boundingBox()).width>expandedWidth+100);await page.locator('#toggle-properties').click();
 check('both sidebars can collapse without changing authoring',await page.locator('#toggle-tree').getAttribute('aria-expanded')==='false'&&await page.locator('#toggle-properties').getAttribute('aria-expanded')==='false'&&await sameCameraAuthoring(initialCameraAuthoring));
 await page.locator('#toggle-tree').click();await page.locator('#focus-mode').click();check('focus mode hides both editor sidebars',await page.locator('#toggle-tree').getAttribute('aria-expanded')==='false'&&await page.locator('#toggle-properties').getAttribute('aria-expanded')==='false');await page.locator('#focus-mode').click();
 check('exiting focus mode restores the previous sidebar choices',await page.locator('#toggle-tree').getAttribute('aria-expanded')==='true'&&await page.locator('#toggle-properties').getAttribute('aria-expanded')==='false');await page.locator('#toggle-properties').click();
 await page.locator('#focus-selection').click();await page.screenshot({path:join(evidence,'panel-camera-default-focus.png'),fullPage:true});
 console.log(JSON.stringify({phase:'camera-navigation-verified',artifactId,checks:checks.length}));
 await choose(initial.document.rootId);check('canvas dimensions protected',await page.locator('#width').isDisabled()&&await page.locator('#height').isDisabled());
 const targets=sizeEditTargets(initial.document,source.ctx),surface=targets.find(t=>['Panel','Dialog'].includes(t.type));
 assert.ok(surface,'A generated outer panel fixture is required');
 const panelEdit={nodeId:surface.id,width:surface.width+40,height:surface.height+40};
 const panelCandidate=sizeEditDocument(initial.document,panelEdit,source.ctx);await apply(panelEdit);
 check('panel width and height reach runtime',await page.evaluate(({nodeId,width,height})=>{const size=panelSizeEditor.session.current.runtime.handles.get(nodeId).size;return Math.abs(size.width-width)<.1&&Math.abs(size.height-height)<.1;},panelEdit));
 const control=sizeEditTargets(panelCandidate,source.ctx).find(t=>t.type==='Input')??sizeEditTargets(panelCandidate,source.ctx).find(t=>['Button','Switch','CheckBox'].includes(t.type));
 assert.ok(control,'An editable generated control fixture is required');
 let controlEdit,controlCandidate;
 for(const dw of [-20,-10,20])for(const dh of [40,8,-4]){if(controlEdit)break;try{const edit={nodeId:control.id,width:control.width+dw,height:control.height+dh};controlCandidate=sizeEditDocument(panelCandidate,edit,source.ctx);controlEdit=edit;}catch{}}
 assert.ok(controlEdit,'Fixture must allow a safe control width/height change');await apply(controlEdit);
 check('internal control width and height reach runtime',await page.evaluate(({nodeId,width,height})=>{const size=panelSizeEditor.session.current.runtime.handles.get(nodeId).size;return Math.abs(size.width-width)<.1&&Math.abs(size.height-height)<.1;},controlEdit));
 const resized=await active();check('two changes are undoable and dirty',resized.dirty&&await page.locator('#undo').isEnabled());
 await page.locator('#undo').click();await page.waitForFunction(revision=>panelSizeEditor.session.revision>revision,resized.document.revision);check('undo restores previous layout',sameGeometry((await active()).document,panelCandidate));
 const undone=await active();await page.locator('#redo').click();await page.waitForFunction(revision=>panelSizeEditor.session.revision>revision,undone.document.revision);check('redo restores dimensions',sameGeometry((await active()).document,controlCandidate));
 const valid=await active(),sceneToken=await page.evaluate(()=>{window.sizeCheckScene=panelSizeEditor.session.current;return panelSizeEditor.session.revision;});
 await choose(control.id);await page.locator('#width').fill('24');await page.locator('#apply').click();await page.waitForFunction(()=>document.querySelector('#message').classList.contains('error'));
 check('unsafe resize retains authored dimensions',sameGeometry((await active()).document,valid.document));check('unsafe resize retains valid renderer and history',await page.evaluate(revision=>panelSizeEditor.session.current===window.sizeCheckScene&&panelSizeEditor.session.revision===revision,sceneToken));
 await page.screenshot({path:join(evidence,'panel-size-rejected.png'),fullPage:true});
 const beforePlay=JSON.stringify((await active()).document);await page.locator('#mode').click();check('play mode disables size mutation',(await active()).mode==='play'&&await page.locator('#apply').isDisabled());
 const plainPlayScale=await page.evaluate(()=>panelSizeEditor.scale),playView=await page.locator('#viewport').boundingBox();await page.mouse.move(playView.x+playView.width/2,playView.y+playView.height/2);await page.mouse.wheel(0,100);await page.evaluate(()=>new Promise(requestAnimationFrame));check('ordinary play-mode wheel remains with controls rather than zooming',await page.evaluate(scale=>panelSizeEditor.scale===scale,plainPlayScale));
 const behavior=variant.behavior;
 if(behavior){
  const field=behavior.fields.find(f=>f.type==='input'&&f.enabled&&!f.readOnly);
  if(field){const text='测'.repeat(Math.max(field.minLength??0,Math.min(field.maxLength??4,4)));await clickControl(field.id);const native=page.locator('input:not(#size-form input):not(#text-form input)');await native.fill(text);await native.press('Enter');
   check('native input retained in play mode',await page.evaluate(({id,text})=>panelSizeEditor.state[id]?.value===text,{id:field.id,text}));
  }
  const toggle=behavior.fields.find(f=>['switch','check-box'].includes(f.type)&&f.enabled);
  if(toggle){const checked=await page.evaluate(id=>panelSizeEditor.state[id].checked,toggle.id);await clickControl(toggle.id);check('pointer toggle retained in play mode',await page.evaluate(({id,checked})=>panelSizeEditor.state[id].checked!==checked,{id:toggle.id,checked}));}
  const action=behavior.actions.find(a=>a.enabled&&a.action==='submit');if(action){await clickControl(action.id);check('local submit behavior retained',(await page.locator('#message').textContent()).includes('本地试玩事件'));}
 }
 check('play values stay outside authoring document',JSON.stringify((await active()).document)===beforePlay);
 await page.locator('#mode').click();check('returns to edit mode',(await active()).mode==='edit');
 await page.locator('#save').click();await page.waitForFunction(()=>panelSizeEditor.revisionId&&!panelSizeEditor.dirty);const saved=await active();check('size copy saved independently',!!saved.revisionId&&!saved.dirty);
 const downloadEvent=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadEvent;const downloaded=JSON.parse(await readFile(await download.path()));
 check('download contains authored sizes and original behavior',downloaded.kind==='ui_panel_size_copy'&&sameGeometry(downloaded.document,saved.document)&&JSON.stringify(downloaded.behavior)===JSON.stringify(variant.behavior));
 const second=await context.newPage();observe(second);await second.goto(route);await ready(second);if(await second.locator('#variant').inputValue()!==variant.key){await second.locator('#variant').selectOption(variant.key);await second.waitForFunction(key=>panelSizeEditor.variant.key===key,variant.key);}
 check('saved copy reopens with same sizes',sameGeometry(await second.evaluate(()=>panelSizeEditor.session.document),saved.document));
 const staleDocument=await second.evaluate(()=>panelSizeEditor.session.document),staleRevision=await second.evaluate(()=>panelSizeEditor.revisionId);
 const resizeAgain={nodeId:surface.id,width:panelEdit.width+20,height:panelEdit.height+20};await apply(resizeAgain);await page.locator('#save').click();await page.waitForFunction(revision=>panelSizeEditor.revisionId!==revision&&!panelSizeEditor.dirty,saved.revisionId);
 const staleResponse=await second.request.post(base+'/panel-edit/save',{headers:{Origin:base},data:{artifactId,variantKey:variant.key,sourceSha256:source.previewSha256,expectedRevision:staleRevision,document:staleDocument}});
 check('stale tab cannot overwrite newer size copy',staleResponse.status()===409);
 await page.reload();await ready(page);if(await page.locator('#variant').inputValue()!==variant.key){await page.locator('#variant').selectOption(variant.key);await page.waitForFunction(key=>panelSizeEditor.variant.key===key,variant.key);}
 check('reload retains selected direction and current revision',(await active()).document.canvas===variant.orientation&&(await active()).revisionId!==staleRevision);
 const otherVariant=source.variants.find(value=>value.key!==variant.key);
 if(otherVariant){
  const before=await active();await page.evaluate(()=>{window.sizeCheckScene=panelSizeEditor.session.current;});
  let release,requested;const requestStarted=new Promise(accept=>requested=accept),blocked=new Promise(accept=>release=accept);
  const intercept=async route=>{if(route.request().postDataJSON().variantKey===otherVariant.key){requested();await blocked;return route.fulfill({json:{revisionId:null,document:{kind:'invalid-variant-fixture'}}});}return route.continue();};
  await page.route(base+'/panel-edit/load',intercept);await page.locator('#variant').selectOption(otherVariant.key);await bounded(requestStarted,'Variant candidate request');
  check('variant loading disables concurrent editor actions',await page.locator('#variant').isDisabled()&&await page.locator('#apply').isDisabled());
  release();await page.waitForFunction(()=>document.querySelector('#message').classList.contains('error'));
  check('failed variant candidate preserves scene, selection and authoring',await page.evaluate(before=>panelSizeEditor.session.current===window.sizeCheckScene&&panelSizeEditor.selected===before.selected&&panelSizeEditor.variant.key===before.variant&&JSON.stringify(panelSizeEditor.session.document)===JSON.stringify(before.document),before));
  check('failed variant restores selector and enabled editor',await page.locator('#variant').inputValue()===variant.key&&await page.locator('#apply').isEnabled());
  await page.unroute(base+'/panel-edit/load',intercept);
  await page.reload();await ready(page);if(await page.locator('#variant').inputValue()!==variant.key){await page.locator('#variant').selectOption(variant.key);await page.waitForFunction(key=>panelSizeEditor.variant.key===key,variant.key);}
 }
 await page.locator('#fit').click();
 check('desktop canvas stays within visible preview viewport',await page.evaluate(()=>{const canvas=document.querySelector('#world canvas').getBoundingClientRect(),view=document.querySelector('#viewport').getBoundingClientRect(),t=.6;return canvas.left>=view.left-t&&canvas.right<=view.right+t&&canvas.top>=view.top-t&&canvas.bottom<=view.bottom+t&&view.bottom<=innerHeight+t;}));
 await page.screenshot({path:join(evidence,'panel-size-desktop.png'),fullPage:true});check('desktop has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(requestAnimationFrame));check('390px mobile has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(evidence,'panel-size-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});for(const id of ['toggle-tree','toggle-properties'])if(await page.locator('#'+id).getAttribute('aria-expanded')==='false')await page.locator('#'+id).click();const revisionBeforeReset=(await active()).document.revision;await page.locator('#reset').click();await page.waitForFunction(revision=>panelSizeEditor.session.revision>revision,revisionBeforeReset);check('restore generation dimensions keeps original graph',sameGeometry((await active()).document,variant.document));
 console.log(JSON.stringify({phase:'authoring-and-storage-verified',artifactId,checks:checks.length}));
 // Canvas transactions use real pointer input. Provisional scenes must remain
 // outside the author's document and undo history until a valid release.
 await page.bringToFront();
 const targetNow=id=>page.evaluate(id=>{const p=panelSizeEditor,h=p.session.current.runtime.handles.get(id),node=p.session.document.nodes.find(n=>n.id===id);return {size:{...h.size},position:{...node.position},revision:p.session.revision,document:p.session.document};},id);
 const pointerStart=async(id,selector,dx,dy)=>{
  await choose(id);const handle=page.locator(selector);let box=await handle.boundingBox(),view=await page.locator('#viewport').boundingBox();if(!box||box.x+box.width/2<view.x||box.x+box.width/2>view.x+view.width||box.y+box.height/2<view.y||box.y+box.height/2>view.y+view.height){await page.locator('#focus-selection').click();await page.evaluate(()=>new Promise(requestAnimationFrame));box=await handle.boundingBox();}const scale=await page.evaluate(()=>panelSizeEditor.scale),x=box.x+box.width/2,y=box.y+box.height/2;
  const hit=await page.evaluate(({x,y})=>{const target=document.elementFromPoint(x,y),edge=target?.closest('[data-resize]')?.dataset.resize,p=panelSizeEditor,h=p.session.current.runtime.handles.get(p.selected);return {edge:edge??(target?.closest('#selection-move')?'move':null),scale:p.scale,size:h.size};},{x,y}),expected=selector.match(/data-resize="([a-z]+)"/)?.[1]??'move';
  check('pointer hits requested '+expected+' handle for '+id+' '+JSON.stringify(hit),hit.edge===expected);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx*scale,y+dy*scale,{steps:4});
  await page.waitForFunction(()=>panelSizeEditor.gesture.active&&((panelSizeEditor.gesture.candidateDocument)||panelSizeEditor.gesture.valid===false));
  return {x,y,scale};
 };
 const pointerFinish=async revision=>{await page.mouse.up();await page.waitForFunction(revision=>!panelSizeEditor.gesture.active&&panelSizeEditor.session.revision===revision+1,revision);};
 const resizeHandle=async id=>{await choose(id);return await page.locator('#selection [data-resize="e"]').isVisible()?'#selection [data-resize="e"]':'#selection [data-resize="se"]';};
 const visibleHandleHits=async id=>{await choose(id);await page.locator('#focus-selection').click();for(const edge of await page.locator('#selection [data-resize]:visible').evaluateAll(nodes=>nodes.map(node=>node.dataset.resize))){const handle=page.locator('#selection [data-resize="'+edge+'"]'),box=await handle.boundingBox();check('visible '+edge+' handle is individually hittable for '+id,await page.evaluate(({x,y,edge})=>document.elementFromPoint(x,y)?.closest('[data-resize]')?.dataset.resize===edge,{x:box.x+box.width/2,y:box.y+box.height/2,edge}));}};
 const captureScene=()=>page.evaluate(()=>{window.canvasCheckScene=panelSizeEditor.session.current;return {revision:panelSizeEditor.session.revision,document:panelSizeEditor.session.document,state:panelSizeEditor.state};});
 const unchanged=async before=>page.evaluate(before=>panelSizeEditor.session.current===window.canvasCheckScene&&panelSizeEditor.renderScene===window.canvasCheckScene&&panelSizeEditor.session.revision===before.revision&&JSON.stringify(panelSizeEditor.session.document)===JSON.stringify(before.document),before);
 const surfaceBefore=await targetNow(surface.id);await pointerStart(surface.id,'#selection [data-resize="se"]',20,20);
 check('mouse drag previews real panel dimensions without authoring commit',await page.evaluate(({id,revision,width,height})=>{const p=panelSizeEditor,h=p.renderScene.runtime.handles.get(id);return p.gesture.active&&p.gesture.valid&&p.session.revision===revision&&p.renderScene!==p.session.current&&Math.abs(h.size.width-width)<.1&&Math.abs(h.size.height-height)<.1;},{id:surface.id,revision:surfaceBefore.revision,width:surfaceBefore.size.width+20,height:surfaceBefore.size.height+20}));
 await pointerFinish(surfaceBefore.revision);check('one mouse drag publishes exactly one history transaction',(await active()).document.revision===surfaceBefore.revision+1);
 const surfaceDragged=await active();await page.locator('#undo').click();await page.waitForFunction(revision=>panelSizeEditor.session.revision>revision,surfaceDragged.document.revision);check('one undo reverses the complete drag',sameGeometry((await active()).document,surfaceBefore.document));
 const undoneDrag=await active();await page.locator('#redo').click();await page.waitForFunction(revision=>panelSizeEditor.session.revision>revision,undoneDrag.document.revision);check('redo reapplies the complete drag',sameGeometry((await active()).document,surfaceDragged.document));
 const afterPanelDrag=(await active()).document,gestureTargets=sizeEditTargets(afterPanelDrag,source.ctx);
 const internal=gestureTargets.find(t=>t.type==='Input'&&gestureTargets.find(p=>p.id===t.parentId)?.canFreeLayout)??gestureTargets.find(t=>['Button','Switch','CheckBox'].includes(t.type)&&gestureTargets.find(p=>p.id===t.parentId)?.canFreeLayout);
 assert.ok(internal,'Fixture needs one editable control in a flow group');await choose(internal.id);
 check('automatic layout exposes only supported resize edges and locks movement',await page.locator('#x').isDisabled()&&await page.locator('#y').isDisabled()&&await page.locator('#selection [data-resize]:visible').evaluateAll(nodes=>nodes.length>0&&nodes.every(node=>['e','s','se'].includes(node.dataset.resize))));await visibleHandleHits(internal.id);
 const beforeEditClick=await captureScene();await clickControl(internal.id);await page.mouse.move(2,2);check('editing a control does not activate its business state',await page.evaluate(before=>JSON.stringify(panelSizeEditor.state)===JSON.stringify(before.state)&&panelSizeEditor.session.revision===before.revision&&panelSizeEditor.session.current.root.root.visible,beforeEditClick));
 await choose(internal.id);const moveLabel=await page.locator('#selection-move').boundingBox();await page.mouse.move(moveLabel.x+moveLabel.width/2,moveLabel.y+moveLabel.height/2);await page.mouse.down();await page.mouse.move(moveLabel.x+moveLabel.width/2+12,moveLabel.y+moveLabel.height/2+8);await page.mouse.up();
 check('automatic layout cannot be silently moved',await page.evaluate(revision=>!panelSizeEditor.gesture.active&&panelSizeEditor.session.revision===revision,beforeEditClick.revision));
 const beforeInvalid=await captureScene(),invalidSize=await targetNow(internal.id),invalidPointer=await pointerStart(internal.id,await resizeHandle(internal.id),-8,0);
 check('drag has a valid provisional candidate before the invalid latest target',await page.evaluate(()=>panelSizeEditor.gesture.valid&&!!panelSizeEditor.gesture.candidateDocument));
 await page.mouse.move(invalidPointer.x+(24-invalidSize.size.width)*invalidPointer.scale,invalidPointer.y,{steps:4});await page.waitForFunction(()=>panelSizeEditor.gesture.active&&panelSizeEditor.gesture.valid===false);
 check('invalid live candidate restores committed scene and dimension inputs',await page.evaluate(({id,width,revision})=>panelSizeEditor.gesture.valid===false&&panelSizeEditor.renderScene===panelSizeEditor.session.current&&Number(document.querySelector('#width').value)===width&&panelSizeEditor.session.revision===revision,{id:internal.id,width:invalidSize.size.width,revision:beforeInvalid.revision}));
 await page.mouse.up();await page.waitForFunction(()=>!panelSizeEditor.gesture.active);check('invalid release keeps scene document and undo history unchanged',await unchanged(beforeInvalid));
 for(const cancellation of ['pointercancel','escape','lostcapture','blur','resize']){
  const before=await captureScene();await pointerStart(surface.id,'#selection [data-resize="se"]',8,8);
  if(cancellation==='pointercancel')await page.locator('#viewport').dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',isPrimary:true});
  else if(cancellation==='escape')await page.keyboard.press('Escape');
  else if(cancellation==='lostcapture')await page.evaluate(()=>document.querySelector('#viewport').releasePointerCapture(1));
  else if(cancellation==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  else await page.setViewportSize({width:1439,height:1000});
  await page.waitForFunction(()=>!panelSizeEditor.gesture.active);await page.mouse.up();check(cancellation+' discards provisional scene without history',await unchanged(before));
  if(cancellation==='resize')await page.setViewportSize({width:1440,height:1000});
 }
 // Create room for a position change, then make the group conversion explicit.
 let shrinkEdit;for(const delta of [-20,-10,-4])try{rectangleEditDocument((await active()).document,{nodeId:internal.id,width:(await targetNow(internal.id)).size.width+delta},source.ctx);shrinkEdit=delta;break;}catch{}
 assert.ok(shrinkEdit,'Fixture control must allow a small width reduction');const beforeShrink=await targetNow(internal.id);await pointerStart(internal.id,await resizeHandle(internal.id),shrinkEdit,0);await pointerFinish(beforeShrink.revision);
 await choose(internal.id);const freeId=await page.locator('#free-layout').getAttribute('data-node'),beforeFree=(await active()).document,expectedFree=freeLayoutDocument(beforeFree,{nodeId:freeId},source.ctx);
 const rects=await page.evaluate(()=>Object.fromEntries([...panelSizeEditor.session.current.runtime.handles].map(([id,h])=>[id,{...h.root.toGlobal({x:0,y:0}),...h.size}])));
 await page.locator('#free-layout').click();await page.waitForFunction(revision=>panelSizeEditor.session.revision>revision,beforeFree.revision);
 check('explicit free-layout conversion preserves solved positions and sizes',await page.evaluate(rects=>[...panelSizeEditor.session.current.runtime.handles].every(([id,h])=>{const p=h.root.toGlobal({x:0,y:0}),r=rects[id];return Math.abs(p.x-r.x)<.6&&Math.abs(p.y-r.y)<.6&&Math.abs(h.size.width-r.width)<.6&&Math.abs(h.size.height-r.height)<.6;}),rects)&&sameGeometry((await active()).document,expectedFree));
 await choose(internal.id);check('free-layout control enables movement and nonoverlapping resize handles',await page.locator('#x').isEnabled()&&await page.locator('#y').isEnabled()&&await page.locator('#selection [data-resize="se"]').isVisible());await visibleHandleHits(internal.id);
 const moveValid=async id=>{const current=(await active()).document,t=sizeEditTargets(current,source.ctx).find(t=>t.id===id);for(const [dx,dy]of [[8,0],[-8,0],[0,8],[0,-8]])try{positionEditDocument(current,{nodeId:id,x:t.x+dx,y:t.y+dy},source.ctx);return {dx,dy,target:t};}catch{}throw Error('Fixture has no safe movement space: '+id);};
 for(const [label,id]of [['outer panel',surface.id],['internal free-layout control',internal.id]]){
  let move;try{move=await moveValid(id);}catch(error){
   if(id!==internal.id)throw error;
   // A one-button row can be exactly as small as that button. Give its explicit
   // free group room using the normal editor before asking to move the child.
   const current=(await active()).document,parentId=sizeEditTargets(current,source.ctx).find(t=>t.id===id).parentId,parent=sizeEditTargets(current,source.ctx).find(t=>t.id===parentId);
   let room;for(const axis of ['width','height'])for(const extra of [16,8]){if(room)break;try{rectangleEditDocument(current,{nodeId:parentId,[axis]:parent[axis]+extra},source.ctx);room={nodeId:parentId,[axis]:parent[axis]+extra};}catch{}}
   if(!room)throw error;await apply(room);check('explicit group resize makes safe room for an edge-to-edge fixture control');move=await moveValid(id);
  }
  const before=await targetNow(id);await pointerStart(id,'#selection-move',move.dx,move.dy);await pointerFinish(before.revision);
  check(label+' drag applies parent-local position',await page.evaluate(({id,x,y})=>{const n=panelSizeEditor.session.document.nodes.find(n=>n.id===id);return Math.abs(n.position.x-x)<.1&&Math.abs(n.position.y-y)<.1;},{id,x:move.target.x+move.dx,y:move.target.y+move.dy}));
 }
 for(const kind of ['resize','move']){
  const id=kind==='resize'?surface.id:internal.id;await choose(id);await page.locator('#focus-selection').click();const view=await page.locator('#viewport').boundingBox(),point={x:view.x+view.width/2,y:view.y+view.height/2};await page.mouse.move(point.x,point.y);await page.mouse.down({button:'middle'});await page.mouse.move(point.x+15,point.y+10,{steps:3});await page.mouse.up({button:'middle'});
  const panned=await page.evaluate(()=>panelSizeEditor.camera),before=await targetNow(id),move=kind==='move'?await moveValid(id):null;
  await pointerStart(id,kind==='resize'?'#selection [data-resize="se"]':'#selection-move',move?.dx??8,move?.dy??8);
  check(kind+' after panning retains the camera rather than silently refocusing',await page.evaluate(before=>Math.abs(panelSizeEditor.camera.x-before.x)<.1&&Math.abs(panelSizeEditor.camera.y-before.y)<.1&&panelSizeEditor.camera.scale===before.scale,panned));
  check(kind+' after panning previews the requested logical result',await page.evaluate(({id,kind,width,x,y})=>{const p=panelSizeEditor,h=p.renderScene.runtime.handles.get(id),n=p.gesture.candidateDocument.nodes.find(n=>n.id===id);return kind==='resize'?Math.abs(h.size.width-width)<.1:Math.abs(n.position.x-x)<.1&&Math.abs(n.position.y-y)<.1;},{id,kind,width:before.size.width+8,x:move?move.target.x+move.dx:0,y:move?move.target.y+move.dy:0}));await pointerFinish(before.revision);
 }
 const originalScale=await page.evaluate(()=>panelSizeEditor.scale);for(let i=0;i<4;i++)await page.locator('#zoom-in').click();const zoomed=await page.evaluate(()=>panelSizeEditor.scale);check('zoom controls change display scale without changing authoring',zoomed>originalScale);await choose(internal.id);check('zoom restores east handle when the control screen height permits it',await page.locator('#selection [data-resize="e"]').isVisible());await visibleHandleHits(internal.id);
 const zoomBefore=await targetNow(surface.id);await pointerStart(surface.id,'#selection [data-resize="se"]',8,8);check('drag after camera zoom and pan uses logical coordinates',await page.evaluate(({id,width})=>Math.abs(panelSizeEditor.renderScene.runtime.handles.get(id).size.width-width)<.1,{id:surface.id,width:zoomBefore.size.width+8}));await pointerFinish(zoomBefore.revision);
 await page.locator('#fit').click();await page.screenshot({path:join(evidence,'panel-canvas-drag-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.locator('#fit').click();for(const id of ['toggle-tree','toggle-properties'])if(await page.locator('#'+id).getAttribute('aria-expanded')==='true')await page.locator('#'+id).click();const mobileAuth=await cameraAuthoring();await page.locator('#toggle-tree').click();check('mobile tree drawer opens alone',await page.locator('#tree-panel').isVisible()&&await page.locator('#toggle-properties').getAttribute('aria-expanded')==='false');await page.locator('#toggle-properties').click();check('mobile properties drawer replaces the tree drawer',await page.locator('#properties-panel').isVisible()&&await page.locator('#toggle-tree').getAttribute('aria-expanded')==='false');await page.locator('#toggle-properties').click();check('mobile drawers preserve authoring state',await sameCameraAuthoring(mobileAuth));await choose(internal.id);await visibleHandleHits(internal.id);const mobileBefore=await targetNow(internal.id),touchSelector=await resizeHandle(internal.id),touchEdge=touchSelector.match(/data-resize="([a-z]+)"/)[1],touchHandle=page.locator(touchSelector),touchBox=await touchHandle.boundingBox(),touchScale=await page.evaluate(()=>panelSizeEditor.scale),touchX=touchBox.x+touchBox.width/2,touchY=touchBox.y+touchBox.height/2,cdp=await context.newCDPSession(page);
 check('touch hits the requested visible '+touchEdge+' handle',await page.evaluate(({x,y,edge})=>document.elementFromPoint(x,y)?.closest('[data-resize]')?.dataset.resize===edge,{x:touchX,y:touchY,edge:touchEdge}));
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchX,y:touchY,id:0}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchX-20*touchScale,y:touchY,id:0}]});await page.waitForFunction(()=>panelSizeEditor.gesture.active&&panelSizeEditor.gesture.candidateDocument);
 check('mobile touch drag previews without authoring mutation',await page.evaluate(revision=>panelSizeEditor.session.revision===revision&&panelSizeEditor.renderScene!==panelSizeEditor.session.current,mobileBefore.revision));await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(revision=>panelSizeEditor.session.revision===revision+1,mobileBefore.revision);await cdp.detach();
 check('mobile touch release commits requested logical size',Math.abs((await targetNow(internal.id)).size.width-(mobileBefore.size.width-20))<.1);check('canvas editor mobile has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(evidence,'panel-canvas-drag-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});for(const id of ['toggle-tree','toggle-properties'])if(await page.locator('#'+id).getAttribute('aria-expanded')==='false')await page.locator('#'+id).click();const movedAuthoring=JSON.stringify((await active()).document);await page.locator('#mode').click();check('play mode hides every canvas editing handle',await page.locator('#selection').isHidden()&&await page.locator('#selection [data-resize]:visible').count()===0);await page.locator('#mode').click();check('play transition retains free layout and authored positions',JSON.stringify((await active()).document)===movedAuthoring);
 await page.locator('#save').click();await page.waitForFunction(()=>!panelSizeEditor.dirty);const canvasSaved=await active(),canvasDownloadEvent=page.waitForEvent('download');await page.locator('#download').click();const canvasDownload=await canvasDownloadEvent,canvasJson=JSON.parse(await readFile(await canvasDownload.path()));
 check('download retains free layout and moved positions without play state or camera',sameGeometry(canvasJson.document,canvasSaved.document)&&!['state','camera','scale','pan','navigation'].some(key=>Object.hasOwn(canvasJson,key))&&JSON.stringify(canvasJson.behavior)===JSON.stringify(variant.behavior));
 await page.reload();await ready(page);if(await page.locator('#variant').inputValue()!==variant.key){await page.locator('#variant').selectOption(variant.key);await page.waitForFunction(key=>panelSizeEditor.variant.key===key,variant.key);}check('saved free layout and moved positions reopen unchanged',sameGeometry((await active()).document,canvasSaved.document));
 console.log(JSON.stringify({phase:'canvas-gestures-verified',artifactId,checks:checks.length}));
 const parent=await context.newPage();observe(parent);await parent.goto(base+'/#panel/'+artifactId);await parent.locator('#panel-size-open').waitFor({state:'visible'});
 check('Studio preview exposes size editor entry',await parent.locator('#panel-size-open').getAttribute('href')==='#panel-size/'+artifactId);
 await parent.locator('#panel-size-open').click();await parent.waitForURL('**/#panel-size/'+artifactId);
 const frame=await (await parent.locator('#panel-size-frame').elementHandle()).contentFrame();await ready(frame);
 check('Studio entry loads the current size editor iframe',await frame.locator('#world canvas').count()===1&&await parent.locator('#panel-size-view').isVisible());
 report.workspace=await parent.evaluate(()=>{const r=document.querySelector('#panel-size-frame').getBoundingClientRect();return {editing:document.body.classList.contains('panel-editing'),iframe:{x:r.x,y:r.y,width:r.width,height:r.height},window:{width:innerWidth,height:innerHeight}};});
 check('Studio editor uses almost the full window below a compact return bar',report.workspace.editing&&report.workspace.iframe.width>=report.workspace.window.width*.94&&report.workspace.iframe.y<=72&&report.workspace.iframe.height>=report.workspace.window.height*.85);
 await frame.evaluate(()=>{window.cameraCheckApp=panelSizeEditor.app;});await parent.setViewportSize({width:390,height:844});check('expanded Studio editor remains bounded on mobile',await parent.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await parent.setViewportSize({width:1440,height:1000});check('expanding and resizing Studio preserves the mounted iframe runtime',await frame.evaluate(()=>window.cameraCheckApp===panelSizeEditor.app));for(const id of ['toggle-tree','toggle-properties'])if(await frame.locator('#'+id).getAttribute('aria-expanded')==='false')await frame.locator('#'+id).click();
 const frameState=await frame.evaluate(()=>({document:panelSizeEditor.session.document,selected:panelSizeEditor.selected}));
 const frameTarget=sizeEditTargets(frameState.document,source.ctx).find(t=>t.id===frameState.selected),nextFrame=sizeEditDocument(frameState.document,{nodeId:frameState.selected,width:frameTarget.width+20},source.ctx);
 await frame.locator('#width').fill(String(nextFrame.nodes.find(n=>n.id===frameState.selected).size.width));await frame.locator('#apply').click();await frame.waitForFunction(()=>panelSizeEditor.dirty);
 await parent.locator('#panel-size-back').click();await parent.locator('#confirm-dialog').waitFor({state:'visible'});
 check('dirty iframe departure uses in-page confirmation',await parent.locator('#confirm-title').textContent()==='离开尺寸编辑？');
 await parent.locator('#confirm-cancel').click();await parent.locator('#confirm-dialog').waitFor({state:'detached'});
 check('cancel departure preserves iframe edit and route',parent.url().endsWith('#panel-size/'+artifactId)&&await frame.evaluate(()=>panelSizeEditor.dirty)&&await parent.locator('#panel-size-view').isVisible());
 await parent.screenshot({path:join(evidence,'panel-size-studio-entry.png'),fullPage:true});
 const dialogsBefore=nativeDialogs;await parent.locator('#panel-size-back').click();await parent.locator('#confirm-dialog').waitFor({state:'visible'});await parent.locator('#confirm-accept').click();await parent.waitForURL('**/#panel/'+artifactId);await parent.locator('#panel-preview-view').waitFor({state:'visible'});
 check('accept departure returns to panel preview without native second dialog',nativeDialogs===dialogsBefore&&await parent.locator('#panel-size-frame').getAttribute('src')===null);
 const savedPreview=await (await parent.locator('#panel-frame').elementHandle()).contentFrame();await savedPreview.waitForFunction(()=>!!window.panelCopyPreview?.doc);
 check('ordinary preview reloads the saved layout rather than the discarded editor draft',sameGeometry(await savedPreview.evaluate(()=>panelCopyPreview.doc),frameState.document));
 check('ordinary saved preview has no authoring controls',await savedPreview.locator('#apply,#save,#selection').count()===0);
 if(values['small-panel']){
  let small;for(const [width,height]of [[235,166],[280,220],[320,260],[400,280],[surface.width,surface.height]]){try{sizeEditDocument(variant.document,{nodeId:surface.id,width,height},source.ctx);small={nodeId:surface.id,width,height};break;}catch{}}
  assert.ok(small,'At least the original outer panel size must be safe');await page.bringToFront();const before=(await active()).document.revision;await page.locator('#reset').click();await page.waitForFunction(revision=>panelSizeEditor.session.revision>revision,before);await apply(small);await page.locator('#focus-selection').click();const screen=await surfaceDisplay();
  check('a legally small panel can be enlarged for precise editing',screen.width>=400&&screen.height>=250);report.smallPanel={logical:{width:small.width,height:small.height},screen:{width:screen.width,height:screen.height},scale:screen.scale};await page.screenshot({path:join(evidence,'panel-camera-small-panel.png'),fullPage:true});
 }
 check('all frozen package bytes remain unchanged',[...originalFiles].every(([name,digest])=>hash(snapshot.files.get(name))===digest));
 check('unlisted source files stay inaccessible',(await page.request.get(base+'/package.json')).status()===404);
 check('no model or generation routes requested',network.length===0);check('no browser runtime warnings or errors',errors.length===0);
 report.status='passed';report.screenshots=['panel-size-desktop.png','panel-size-mobile.png','panel-size-rejected.png','panel-size-studio-entry.png','panel-canvas-drag-desktop.png','panel-canvas-drag-mobile.png','panel-camera-default-focus.png',...(report.smallPanel?['panel-camera-small-panel.png']:[])].map(file=>join(evidence,file));
 await writeFile(join(evidence,'panel-size-check.json'),json(report));console.log(json({status:'passed',checks:checks.length,modelCalls:0,evidence}));
}catch(error){report.status='failed';report.error=error.message;await writeFile(join(evidence,'panel-size-check.json'),json(report));throw error;}
finally{await browser?.close();if(server)await new Promise(accept=>server.close(accept));if(resolve(storageRoot).startsWith(resolve(tmpdir())+sep))await rm(storageRoot,{recursive:true,force:true});}
