// Offline regression: the fixture server has no model adapter or external compute path.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {parseArgs} from 'node:util';
import {buildStudioFixture} from './studio-fixture-build.mjs';
const {positionals,values}=parseArgs({allowPositionals:true,options:{'fixture-config':{type:'string'}}});
if(positionals.length>3)throw Error('Use [port] [screenshot] [consumer] [--fixture-config work/<fixture.json>]');
const root=fileURLToPath(new URL('../',import.meta.url)),port=Number(positionals[0]||4212),base='http://127.0.0.1:'+port;
const fixtureConfig=values['fixture-config']??(await buildStudioFixture()).configPath;
const screenshot=positionals[1]??join(tmpdir(),'ui-chain-custom-panel-studio.png'),candidate=positionals[2];
const server=spawn(process.execPath,['scripts/studio-ux-fixture.mjs',String(port),...(candidate?[candidate]:[]),'--fixture-config',fixtureConfig],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
const report=join(dirname(fixtureConfig),'ux-browser-check.json'),browserDirectory=join(dirname(fixtureConfig),'ux-browser'),draftFile=join(browserDirectory,'draft.json');
let browser,serverError='';server.stderr.on('data',bytes=>{serverError+=bytes.toString();});const checks=[],errors=[];const check=(id,value=true)=>{assert.ok(value,id);checks.push(id);};
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture server timeout'+(serverError?': '+serverError:''))),60000);server.once('error',reject);server.once('exit',()=>reject(Error('Fixture server exited'+(serverError?': '+serverError:''))));server.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1.25,serviceWorkers:'block'});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(base+'/')||/^(data:|blob:)/.test(r.request().url())?r.continue():r.abort());
 await page.goto(base+'/#generate-panel');await page.getByText('还没有可用组件',{exact:true}).waitFor();check('empty panel chooser blocks generation',await page.locator('#panel-prepare').isDisabled());
 await page.locator('#panel-group option[value="settings"]').waitFor({state:'attached'});check('five reference families plus inventory and custom',await page.locator('#panel-group option').count()===7);
 const presetIds=[];for(const group of await page.locator('#panel-group option').evaluateAll(nodes=>nodes.map(n=>n.value).filter(id=>id!=='custom'))){await page.locator('#panel-group').selectOption(group);for(const id of await page.locator('#panel-kind option').evaluateAll(nodes=>nodes.map(n=>n.value))){if(await page.locator('#panel-kind').isVisible())await page.locator('#panel-kind').selectOption(id);presetIds.push(id);check(id+' has preset guidance',(await page.locator('#panel-preset-description').textContent()).length>10);}}check('eight SDK states plus a dedicated inventory preset',presetIds.length===9&&presetIds.filter(id=>id.startsWith('sdk-')).length===8&&presetIds.includes('inventory'));await page.locator('#panel-group').selectOption('inventory');check('inventory accepts an AI brief with explicit grid controls',await page.locator('#panel-request').getAttribute('maxlength')==='4000'&&(await page.locator('#panel-request-label').textContent())==='面板需求'&&await page.locator('#inventory-grid-fields').isVisible());await page.locator('#panel-group').selectOption('settings');
 await page.locator('#panel-projects a').click();await page.locator('.style-card').last().waitFor();check('six real style previews',await page.locator('.style-card img').count()===6);
 await page.locator('.style-card[data-id="pixel-cartoon"]').click();await page.locator('#reference-preview').waitFor({state:'visible'});check('selected reference preview decoded',await page.locator('#reference-preview').evaluate(img=>img.naturalWidth>0));
 check('new projects default to material generation',await page.locator('#material-generation').isChecked());await page.locator('#material-generation').uncheck();check('four-sheet option shows the old 30 component scope',(await page.locator('#project-output-summary').textContent()).includes('30 个通用部件')&&!(await page.locator('#project-message').textContent()).includes('材质图集'));await page.locator('#material-generation').check();check('five-sheet option distinguishes components and materials',(await page.locator('#project-output-summary').textContent()).includes('30 个基础部件 + 3 个材质'));
 await page.locator('#draft-name').fill('离线 UX 回归');await page.locator('#draft-description').fill('保持像素风格。');
 let nativeDialogs=0;page.on('dialog',async d=>{nativeDialogs++;await d.dismiss();});
 await page.locator('#prepare-plan').click();await page.locator('#confirm-dialog').waitFor({state:'visible'});
 check('batch confirmation is an in-page dialog',await page.locator('#confirm-title').textContent()==='生成「离线 UX 回归」的组件库？');
 check('confirmation describes the five-sheet 30+3 scope and hides digest in details',(await page.locator('.confirm-facts').textContent()).includes('4 张组件图集 + 1 张材质图集')&&(await page.locator('.confirm-facts').textContent()).includes('30 个基础部件 + 3 个材质')&&(await page.locator('.confirm-facts').textContent()).includes('每张调用一次')&&!(await page.locator('#confirm-dialog details').getAttribute('open')));
 check('cancel receives initial keyboard focus',await page.locator('#confirm-cancel').evaluate(n=>n===document.activeElement));
 await page.screenshot({path:join(dirname(screenshot),'studio-confirm-desktop.png'),fullPage:true});
 await page.locator('#confirm-cancel').click();await page.waitForURL('**/#project/offline-ux-project');await page.getByRole('button',{name:'生成五张图集',exact:true}).waitFor();
 let counts=await(await page.request.get(base+'/fixture-counts.json')).json();check('cancel submits no model or local task',counts.fullCalls===0&&counts.localCalls===0);
 await page.getByRole('button',{name:'生成五张图集',exact:true}).click();await page.locator('#confirm-dialog').waitFor({state:'visible'});await page.keyboard.press('Escape');await page.locator('#confirm-dialog').waitFor({state:'detached'});check('Escape cancels without losing the project',await page.locator('#progress-title').textContent()==='离线 UX 回归');
 await page.getByRole('button',{name:'生成五张图集',exact:true}).click();await page.locator('#confirm-dialog').waitFor({state:'visible'});await page.waitForTimeout(5200);check('polling does not dismiss a pending confirmation',await page.locator('#confirm-dialog').isVisible());
 await page.locator('#confirm-accept').click();await page.getByRole('heading',{name:'正在生成图集',exact:true}).waitFor();
 check('five atlas states including material and received count are visible',await page.locator('#atlas-grid .atlas-meta').count()===5&&(await page.locator('#atlas-grid').textContent()).includes('S05 · 材质图集')&&await page.locator('#progress-stats progress').count()===2);
 check('submitted model calls use waiting indicators, not a fabricated percent',await page.locator('#atlas-grid .spinner').count()>0&&!(await page.locator('#atlas-grid').textContent()).includes('%'));
 await page.waitForTimeout(2700);await page.locator('#refresh-project').click();await page.locator('#local-progress').waitFor({state:'visible'});
 check('local processing marks the actual pending step',await page.locator('#local-step-list li[data-state="active"]').count()===1&&await page.locator('#local-step-list li[data-state="done"]').count()>0);
 check('local processing description no longer asks for generation confirmation',(await page.locator('#progress-message').textContent()).includes('正在本机拆分与检查'));
 await page.screenshot({path:join(dirname(screenshot),'studio-progress-desktop.png'),fullPage:true});
 await page.waitForURL('**/#library',{timeout:25000});
 counts=await(await page.request.get(base+'/fixture-counts.json')).json();check('one batch then one automatic split',counts.fullCalls===1&&counts.localCalls===1);check('completion returns to project library',await page.locator('#project-list .project-card').count()===1);
 await page.getByRole('link',{name:'图集与记录',exact:true}).click();await page.locator('#atlas-grid img').last().waitFor();check('five received atlas previews',await page.locator('#atlas-grid img').count()===5);
 check('completed project has five verified local steps',await page.locator('#local-step-list li[data-state="done"]').count()===5);
 await page.getByRole('button',{name:'放大 S01 原图',exact:true}).click();check('full atlas preview opens',await page.locator('#image-dialog').isVisible());await page.locator('#close-image').click();
 await page.getByRole('link',{name:'打开全局组件画布',exact:true}).click();const frame=page.frames().find(f=>f.url().includes('component-canvas.html'));await page.frameLocator('#component-frame').locator('#component-list button').last().waitFor();
 let canvasFrame=page.frames().find(f=>f.url().includes('component-canvas.html'));check('all 16 interactive components',await canvasFrame.locator('#component-list button').count()===16);

 await page.waitForFunction(()=>document.querySelector('#component-motion-style')?.disabled===false);
 check('component library exposes all four motion styles',await page.locator('#component-motion-style option').count()===4);
 const componentStates=await canvasFrame.evaluate(()=>JSON.stringify(studioCanvas.items.map(i=>i.n.readState()))),componentLayout=await canvasFrame.evaluate(()=>JSON.stringify(studioCanvas.items.map(i=>({x:i.n.root.x,y:i.n.root.y,size:i.n.size}))));
 for(const style of ['playful','premium','corporate','original']){
  await page.locator('#component-motion-style').selectOption(style);await page.waitForFunction(s=>studioComponentMotion.inspect()?.style===s&&studioComponentMotion.inspect().running===0,style);
  check('all components keep their values and layout with '+style,componentStates===await canvasFrame.evaluate(()=>JSON.stringify(studioCanvas.items.map(i=>i.n.readState())))&&componentLayout===await canvasFrame.evaluate(()=>JSON.stringify(studioCanvas.items.map(i=>({x:i.n.root.x,y:i.n.root.y,size:i.n.size})))));
 }
 await page.locator('#component-motion-style').selectOption('playful');await page.waitForFunction(()=>studioComponentMotion.inspect()?.style==='playful'&&studioComponentMotion.inspect().running===0);
 await page.locator('#component-motion-replay').click();check('all 16 top-level components animate on replay',await page.evaluate(()=>{const win=document.querySelector('#component-frame').contentWindow;return win.studioCanvas.items.every(({n})=>n.root.alpha<1||n.adapter.view.motionProgress<1)&&studioComponentMotion.inspect().running>=16;}));await page.waitForFunction(()=>studioComponentMotion.inspect().running===0);
 await page.screenshot({path:join(dirname(screenshot),'studio-component-motion-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});check('component motion controls fit mobile',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(dirname(screenshot),'studio-component-motion-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#component-motion-replay').click();check('component motion respects reduced motion',await page.evaluate(()=>studioComponentMotion.inspect().running===0));await page.emulateMedia({reducedMotion:'no-preference'});
 const componentDownload=page.waitForEvent('download');await page.locator('#component-motion-export').click();await (await componentDownload).saveAs(join(dirname(screenshot),'component-motion-fixture.json'));
 await page.reload();await page.waitForFunction(()=>studioComponentMotion.inspect()?.style==='playful'&&studioComponentMotion.inspect().running===0);check('component motion survives reload',await page.locator('#component-motion-style').inputValue()==='playful');canvasFrame=page.frames().find(f=>f.url().includes('component-canvas.html'));
 await canvasFrame.locator('#one').click();
 check('100 percent means logical scene size on high DPI screens',await canvasFrame.evaluate(()=>{const c=harness.app.canvas,r=c.getBoundingClientRect();return Math.abs(r.width-1440)<1&&Math.abs(r.height-1120)<1&&harness.app.screen.width===1440&&harness.app.screen.height===1120;}));
 await canvasFrame.locator('#plus').click();await canvasFrame.locator('#plus').click();
 await canvasFrame.waitForFunction(()=>{const texts=[];const walk=n=>{if(n.visible===false||n.renderable===false||n.alpha===0)return;if(typeof n.text==='string'&&n.text&&n._autoResolution)texts.push(n);for(const c of n.children??[])walk(c);};walk(harness.app.stage);return texts.length>=16&&texts.every(t=>t.resolution>=studioCanvas.camera.scale*devicePixelRatio);});
 check('zoom rerasterizes glyphs at displayed device density');
 check('zoom backing pixels cover physical screen pixels',await canvasFrame.evaluate(()=>{const c=harness.app.canvas,r=c.getBoundingClientRect();return c.width>=Math.floor(r.width*devicePixelRatio)&&c.height>=Math.floor(r.height*devicePixelRatio)&&harness.app.screen.width===1440;}));
 await page.screenshot({path:join(dirname(screenshot),'studio-zoom-desktop.png'),fullPage:true});
 await canvasFrame.getByRole('button',{name:'T07 Slider',exact:true}).click();check('component locate zooms',await canvasFrame.locator('#zoom').textContent()==='140%');
 const camera=await canvasFrame.evaluate(()=>studioCanvas.camera);let box=await page.locator('#component-frame').boundingBox();
 const point=await canvasFrame.evaluate(()=>{const n=studioCanvas.items.find(i=>i.sample.type==='Slider').n;const b=n.adapter.view.bg.getBounds(),r=harness.app.canvas.getBoundingClientRect(),s=r.width/harness.app.screen.width;return {x:r.left+(b.x+b.width*.4)*s,y:r.top+(b.y+b.height/2)*s,dx:b.width*.25*s};});
 await page.mouse.move(box.x+point.x,box.y+point.y);await page.mouse.down();await page.mouse.move(box.x+point.x+point.dx,box.y+point.y,{steps:8});await page.mouse.up();
 const slider=await canvasFrame.evaluate(()=>studioCanvas.items.find(i=>i.sample.type==='Slider').n.readState());check('slider remains interactive under camera',slider.value!==40);assert.deepEqual(await canvasFrame.evaluate(()=>studioCanvas.camera),camera);check('slider drag does not pan canvas');
 await canvasFrame.getByRole('button',{name:'T05 Input',exact:true}).click();box=await page.locator('#component-frame').boundingBox();const ib=await canvasFrame.evaluate(()=>{const b=studioCanvas.items.find(i=>i.sample.type==='Input').n.root.getBounds(),r=harness.app.canvas.getBoundingClientRect(),s=r.width/harness.app.screen.width;return{x:r.left+(b.x+b.width/2)*s,y:r.top+(b.y+b.height/2)*s};});await page.mouse.click(box.x+ib.x,box.y+ib.y);await canvasFrame.locator('input').fill('居中测试');await canvasFrame.locator('input').press('Enter');check('input editing survives camera scaling',(await canvasFrame.evaluate(()=>studioCanvas.items.find(i=>i.sample.type==='Input').n.readState())).value==='居中测试');

 const componentPoint=async(type,row)=>{box=await page.locator('#component-frame').boundingBox();return canvasFrame.evaluate(({type,row})=>{const n=studioCanvas.items.find(i=>i.sample.type===type).n,view=row===undefined?n.root:(n.adapter.rows??n.adapter.view.rows)[row],b=view.getBounds(),r=harness.app.canvas.getBoundingClientRect(),s=r.width/harness.app.screen.width;return{x:r.left+(b.x+b.width/2)*s,y:r.top+(b.y+b.height/2)*s};},{type,row});};
 if(candidate){
  await canvasFrame.getByRole('button',{name:'T12 Tabs',exact:true}).click();
  check('Tabs has a skin-backed padded content viewport',await canvasFrame.evaluate(()=>{const n=studioCanvas.items.find(i=>i.sample.type==='Tabs').n,a=n.adapter;return a.background.texture===harness.skin.texture('skin.surface.content')&&a.background.eventMode==='none'&&a.switcher.x>=harness.skin.profile.padding&&a.switcher.mask===a.contentMask;}));
  const tabPoint=await componentPoint('Tabs',1);await page.mouse.click(box.x+tabPoint.x,box.y+tabPoint.y);check('Tabs changes page above its content surface',(await canvasFrame.evaluate(()=>studioCanvas.items.find(i=>i.sample.type==='Tabs').n.readState())).activeId==='b');
  await page.screenshot({path:join(dirname(screenshot),'studio-tabs-desktop.png'),fullPage:true});
 }
 await canvasFrame.getByRole('button',{name:'T06 Select',exact:true}).click();let cp=await componentPoint('Select');await page.mouse.click(box.x+cp.x,box.y+cp.y);await canvasFrame.waitForFunction(()=>harness.runtime.overlay.selects.size===1&&studioCanvas.items.find(i=>i.sample.type==='Select').n.adapter.view.motionProgress===1);cp=await componentPoint('Select',1);await page.mouse.click(box.x+cp.x,box.y+cp.y);check('select popup receives clicks outside closed control',(await canvasFrame.evaluate(()=>studioCanvas.items.find(i=>i.sample.type==='Select').n.readState())).selectedId==='b');
 await canvasFrame.getByRole('button',{name:'T09 ScrollView',exact:true}).click();cp=await componentPoint('ScrollView');const scrollCamera=await canvasFrame.evaluate(()=>studioCanvas.camera);await page.mouse.move(box.x+cp.x,box.y+cp.y);await page.mouse.wheel(0,250);await canvasFrame.waitForFunction(()=>studioCanvas.items.find(i=>i.sample.type==='ScrollView').n.readState().initialOffsetY>0);check('scroll wheel reaches ScrollView');assert.deepEqual(await canvasFrame.evaluate(()=>studioCanvas.camera),scrollCamera);check('ScrollView wheel does not zoom camera');
 await canvasFrame.locator('#hand').click();const vp=await canvasFrame.locator('#viewport').boundingBox();await page.mouse.move(vp.x+vp.width/2,vp.y+vp.height/2);await page.mouse.down();await page.mouse.move(vp.x+vp.width/2+80,vp.y+vp.height/2+35,{steps:6});await page.mouse.up();check('explicit hand tool pans camera',(await canvasFrame.evaluate(()=>studioCanvas.camera)).x!==scrollCamera.x);await canvasFrame.locator('#hand').click();await canvasFrame.locator('#fit').click();check('fit restores overview',(await canvasFrame.evaluate(()=>studioCanvas.camera)).scale<=1);
 check('returning to overview releases enlarged backing pixels',await canvasFrame.evaluate(()=>harness.app.renderer.resolution<=1.25));
 check('standalone preview text is light on the dark canvas',await canvasFrame.evaluate(()=>{const rows=studioCanvas.contrast.refresh().filter(x=>studioCanvas.readability?x.role==='host-background':x.background==='canvas');return rows.length>0&&rows.every(x=>String(x.fill).toLowerCase()==='#f5f7ff');}));
 check('surface text uses verified role ink or legacy sampled contrast',await canvasFrame.evaluate(()=>{const rows=studioCanvas.contrast.refresh();if(!studioCanvas.readability)return rows.some(x=>x.background!=='canvas'&&x.fill==='#111827'&&x.ratio>=4.5);const onSurface=rows.filter(x=>x.role!=='host-background');return onSurface.length>0&&onSurface.every(x=>x.fill===harness.skin.profile.textColors[x.role]);}));
 const closeDialog=async()=>{
  await page.waitForFunction(()=>studioComponentMotion.inspect()?.running===0);
  await canvasFrame.waitForFunction(()=>studioCanvas.items.find(i=>i.sample.type==='Dialog').n.adapter.view.motionProgress===1);
  const point=await canvasFrame.evaluate(()=>{const n=studioCanvas.items.find(i=>i.sample.type==='Dialog').n,b=n.adapter.buttons[0].getBounds(),r=harness.app.canvas.getBoundingClientRect(),s=r.width/harness.app.screen.width;return{x:r.left+(b.x+b.width/2)*s,y:r.top+(b.y+b.height/2)*s};});
  const frameBox=await page.locator('#component-frame').boundingBox();await page.mouse.click(frameBox.x+point.x,frameBox.y+point.y);
  await canvasFrame.waitForFunction(()=>!studioCanvas.items.find(i=>i.sample.type==='Dialog').n.readState().open);
  await page.waitForFunction(()=>studioComponentMotion.inspect()?.running===0);
  await canvasFrame.getByRole('button',{name:'重新打开 T11 弹窗',exact:true}).waitFor({state:'visible'});
 };
 const dialogEvents=()=>canvasFrame.evaluate(()=>{const n=studioCanvas.items.find(i=>i.sample.type==='Dialog').n;return harness.events.filter(e=>e.nodeId===n.id).map(e=>e.event);});
 const otherStates=()=>canvasFrame.evaluate(()=>studioCanvas.items.filter(i=>i.sample.type!=='Dialog').map(i=>({type:i.sample.type,state:i.n.readState()})));
 await canvasFrame.getByRole('button',{name:'T11 Dialog',exact:true}).click();
 const dialogCamera=await canvasFrame.evaluate(()=>studioCanvas.camera),unchangedStates=await otherStates();
 await closeDialog();assert.deepEqual(await dialogEvents(),['action','closed']);check('confirm closes Dialog once and shows inline recovery');
 await page.screenshot({path:join(dirname(screenshot),'studio-dialog-closed-desktop.png'),fullPage:true});
 await canvasFrame.locator('#hand').click();await canvasFrame.getByRole('button',{name:'重新打开 T11 弹窗',exact:true}).click();
 check('inline reopen works with hand tool active',await canvasFrame.evaluate(()=>studioCanvas.items.find(i=>i.sample.type==='Dialog').n.readState().open));
 assert.deepEqual(await canvasFrame.evaluate(()=>studioCanvas.camera),dialogCamera);assert.deepEqual(await otherStates(),unchangedStates);assert.deepEqual(await dialogEvents(),['action','closed']);check('reopen preserves camera, other controls and emits no synthetic action');
 await canvasFrame.locator('#hand').click();await closeDialog();await canvasFrame.getByRole('button',{name:'T11 Dialog',exact:true}).click();
 check('sidebar also reopens a closed Dialog',await canvasFrame.evaluate(()=>studioCanvas.items.find(i=>i.sample.type==='Dialog').n.readState().open));
 await closeDialog();await canvasFrame.getByRole('button',{name:'重新打开 T11 弹窗',exact:true}).focus();await page.keyboard.press('Enter');
 await canvasFrame.locator('.dialog-recovery').waitFor({state:'hidden'});assert.deepEqual(await dialogEvents(),['action','closed','action','closed','action','closed']);check('keyboard reopen and repeated confirms keep exactly one close per action');
 await page.setViewportSize({width:390,height:844});await canvasFrame.getByRole('button',{name:'T05 Input',exact:true}).click();
 check('mobile component canvas keeps dense pixels and logical sizing',await canvasFrame.evaluate(()=>{const c=harness.app.canvas,r=c.getBoundingClientRect();return c.style.width==='1440px'&&c.width>=Math.floor(r.width*devicePixelRatio)&&document.documentElement.scrollWidth<=innerWidth;}));
 await page.screenshot({path:join(dirname(screenshot),'studio-zoom-canvas-mobile.png'),fullPage:true});
 await canvasFrame.getByRole('button',{name:'T11 Dialog',exact:true}).click();await closeDialog();
 check('mobile closed Dialog offers a visible reachable recovery',await canvasFrame.getByRole('button',{name:'重新打开 T11 弹窗',exact:true}).evaluate(b=>{const r=b.getBoundingClientRect(),v=document.querySelector('#viewport').getBoundingClientRect();return r.left>=v.left&&r.right<=v.right&&r.top>=v.top&&r.bottom<=v.bottom;}));
 await page.screenshot({path:join(dirname(screenshot),'studio-dialog-closed-mobile.png'),fullPage:true});
 await canvasFrame.getByRole('button',{name:'重新打开 T11 弹窗',exact:true}).click();check('mobile Dialog can reopen',await canvasFrame.evaluate(()=>studioCanvas.items.find(i=>i.sample.type==='Dialog').n.readState().open));
 if(candidate){
  await canvasFrame.getByRole('button',{name:'T12 Tabs',exact:true}).click();const frameBox=await page.locator('#component-frame').boundingBox(),tabPoint=await componentPoint('Tabs',0);await page.mouse.click(frameBox.x+tabPoint.x,frameBox.y+tabPoint.y);
  check('Tabs surface and page switch remain usable on mobile',(await canvasFrame.evaluate(()=>studioCanvas.items.find(i=>i.sample.type==='Tabs').n.readState())).activeId==='a');
  await page.screenshot({path:join(dirname(screenshot),'studio-tabs-mobile.png'),fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('#use-components').click();await page.waitForURL('**/#generate-panel');await page.waitForFunction(()=>studioComponentMotion.inspect()===undefined);check('leaving component canvas disposes motion');check('canvas carries selected component version',(await page.locator('#selected-project').textContent()).includes('ffffffffffff'));
 check('canvas selection required before generation',await page.locator('#panel-prepare').isDisabled());await page.locator('#panel-request').fill('');await page.locator('#panel-orientation').selectOption('portrait');await page.locator('#panel-prepare').click();await page.locator('#confirm-dialog').waitFor({state:'visible'});check('panel confirmation binds chosen component and one call',(await page.locator('.confirm-facts').textContent()).includes('ffffffffffff')&&(await page.locator('.confirm-facts').textContent()).includes('1 次模型调用')&&(await page.locator('.confirm-facts').textContent()).includes('竖版 9:16'));await page.locator('#confirm-accept').click();await page.locator('#panel-jobs .step-list').waitFor();check('panel generation shows its three stages',await page.locator('#panel-jobs .step-list li').count()===3);await page.waitForURL('**/#panel/**',{timeout:20000});check('successful panel automatically opens preview',page.url().includes('/#panel/'));check('selected preset allows empty supplementary request');
 await page.locator('#panel-preview-view').getByRole('link',{name:'← 面板作品库',exact:true}).click();await page.locator('#panel-list article').waitFor();check('panel has separate library',await page.locator('#panel-list article').count()===1);
 await page.getByRole('button',{name:'删除面板',exact:true}).click();await page.locator('#confirm-cancel').click();check('cancel delete keeps panel',await page.locator('#panel-list article').count()===1);
 await page.getByRole('button',{name:'删除面板',exact:true}).click();await page.locator('#confirm-accept').click();await page.getByText('还没有面板作品',{exact:true}).waitFor();
 await page.locator('#panel-library-filter').selectOption('trash');await page.getByRole('button',{name:'恢复面板',exact:true}).waitFor();check('trash has restore but no play or model action',await page.locator('#panel-list a').count()===0&&await page.locator('#panel-list button').count()===1);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(dirname(screenshot),'studio-trash-mobile.png'),fullPage:true});check('trash mobile does not overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});
 await page.reload();await page.locator('#panel-library-filter').selectOption('trash');await page.getByRole('button',{name:'恢复面板',exact:true}).waitFor();check('deleted panel persists across refresh',await page.locator('#panel-list article').count()===1);
 await page.getByRole('button',{name:'恢复面板',exact:true}).click();await page.getByText('回收站为空',{exact:true}).waitFor();await page.locator('#panel-library-filter').selectOption('active');await page.getByRole('link',{name:'打开面板',exact:true}).waitFor();check('restored same panel without duplicate',await page.locator('#panel-list article').count()===1);
await page.goto(base+'/#panel/missing-offline-panel');await page.waitForURL('**/#panels');check('missing panel route returns to the library instead of a stale page',await page.locator('#panels-view').isVisible()&&await page.locator('#notice').textContent()==='该面板已不可用，请在作品库中刷新或重新选择。');await page.getByRole('link',{name:'打开面板',exact:true}).click();check('opening another route clears missing-panel notice',await page.locator('#notice').isHidden());await page.locator('#panel-preview-original').click();
 await page.waitForFunction(()=>{const c=document.querySelector('#panel-frame').contentDocument?.querySelector('canvas');return c&&c.height>c.width;},null,{timeout:30000});check('portrait preference waits for runtime readiness');check('panel pins component version',(await page.locator('#panel-source').textContent()).includes('ffffffffffff'));

 await page.waitForFunction(()=>document.querySelector('#panel-motion-style')&&!document.querySelector('#panel-motion-style').disabled);
 check('four motion schemes available',await page.locator('#panel-motion-style option').count()===4);
 const motionFrame=()=>page.frames().find(f=>f.url().includes('/preview.html'));
 const originalState=await motionFrame().evaluate(()=>JSON.stringify(settingsPreview.state)),originalDocument=await motionFrame().evaluate(()=>JSON.stringify(settingsPreview.scene.document));
 for(const style of ['playful','premium','corporate']){
  await page.locator('#panel-motion-style').selectOption(style);await page.waitForFunction(style=>studioPanelMotion.inspect()?.style===style,style);
  await page.locator('#panel-motion-replay').click();check(style+' entrance uses actual scheduler',await page.evaluate(()=>studioPanelMotion.inspect().running>0));
  await page.waitForFunction(()=>studioPanelMotion.inspect().running===0);
  check(style+' settles without changing state or document',originalState===await motionFrame().evaluate(()=>JSON.stringify(settingsPreview.state))&&originalDocument===await motionFrame().evaluate(()=>JSON.stringify(settingsPreview.scene.document)));
 }
 await page.locator('#panel-motion-style').selectOption('playful');await page.waitForFunction(()=>studioPanelMotion.inspect()?.style==='playful'&&studioPanelMotion.inspect().running===0);
 await page.locator('#panel-frame').scrollIntoViewIfNeeded();const panelBox=await page.locator('#panel-frame').boundingBox();const switchPoint=await motionFrame().evaluate(()=>{const r=settingsPreview.scene.runtime;r.flush();const h=[...r.handles.values()].find(h=>h.recipe.type==='Switch'),p=h.adapter.view.toGlobal({x:r.skin.profile.markSize,y:r.skin.profile.markSize/2}),c=settingsPreview.app.canvas.getBoundingClientRect(),s=c.width/settingsPreview.app.screen.width;return {id:h.id,x:c.left+p.x*s,y:c.top+p.y*s,checked:h.readState().checked};});
 await page.mouse.click(panelBox.x+switchPoint.x,panelBox.y+switchPoint.y);check('motion preserves real switch interaction',await motionFrame().evaluate(({id,checked})=>settingsPreview.scene.runtime.handles.get(id).readState().checked!==checked,switchPoint));
 await page.mouse.move(5,5);await page.waitForFunction(()=>studioPanelMotion.inspect().running===0);
 const motionDownload=page.waitForEvent('download');await page.locator('#panel-motion-export').click();const motionFile=await motionDownload;await motionFile.saveAs(join(dirname(screenshot),'panel-motion-fixture.json'));check('motion config exports separately',motionFile.suggestedFilename().endsWith('.motion.json'));
 await page.reload();await page.waitForFunction(()=>studioPanelMotion.inspect()?.style==='playful');check('motion selection survives refresh',await page.locator('#panel-motion-style').inputValue()==='playful');
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#panel-motion-replay').click();check('reduced motion cancels animation',await page.evaluate(()=>studioPanelMotion.inspect().reducedMotion&&studioPanelMotion.inspect().running===0));await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('#panel-motion-style').selectOption('original');await page.waitForFunction(()=>studioPanelMotion.inspect()?.style==='original');await page.locator('#panel-motion-replay').click();check('original removes all animation',await page.evaluate(()=>studioPanelMotion.inspect().running===0));
 await page.screenshot({path:join(dirname(screenshot),'studio-motion-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});check('motion controls fit mobile',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(dirname(screenshot),'studio-motion-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
 await mkdir(browserDirectory,{recursive:true});await page.screenshot({path:join(dirname(screenshot),'fixture-panel.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/#library');await page.locator('#project-list article').waitFor();check('mobile has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(dirname(screenshot),'studio-library-mobile.png'),fullPage:true});
 await page.locator('#new-project').click();await page.getByRole('button',{name:'自定义风格',exact:true}).click();await page.locator('#reference-file').setInputFiles('assets/studio-styles/anime-cel.png');await page.locator('#reference-preview').waitFor({state:'visible'});check('custom reference upload preview',await page.locator('#reference-preview').evaluate(i=>i.naturalWidth>0));await page.locator('#draft-name').fill('可携带草稿');
 await page.locator('#project-editor details summary').click();const downloading=page.waitForEvent('download');await page.locator('#save-project').click();const d=await downloading;await d.saveAs(draftFile);await page.locator('#open-project').setInputFiles(draftFile);await page.getByText('项目草稿已恢复，尚未提交模型。',{exact:true}).waitFor();check('custom draft export and import roundtrip',await page.locator('#draft-name').inputValue()==='可携带草稿');
 await page.goto(base+'/#generate-panel');await page.locator('#panel-group').selectOption('custom');await page.locator('#panel-orientation').selectOption('portrait');
 await page.getByRole('button',{name:'选择这套组件',exact:true}).first().click();await page.locator('#panel-request').fill('   ');
 check('custom hides SDK state and requires a nonempty brief',await page.locator('#panel-state-field').isHidden()&&await page.locator('#panel-prepare').isDisabled());
 const customBrief='玩家资料：昵称输入、公开资料开关和保存按钮。';await page.locator('#panel-request').fill(customBrief);check('custom brief enables generation',await page.locator('#panel-prepare').isEnabled());
 await page.locator('#panel-group').selectOption('settings');check('preset switch preserves authored brief',await page.locator('#panel-request').inputValue()===customBrief);await page.locator('#panel-group').selectOption('custom');
 check('custom mobile has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:1440,height:1000});
 const prepared=page.waitForRequest(r=>r.url()===base+'/pipeline/panel-prepare');await page.locator('#panel-prepare').click();await page.locator('#confirm-dialog').waitFor({state:'visible'});await page.locator('#confirm-cancel').click();
 const customPayload=(await prepared).postDataJSON();check('custom submits own kind, selected ratio and unmodified brief',customPayload.kind==='custom'&&customPayload.orientation==='portrait'&&customPayload.text===customBrief);
 await page.getByRole('button',{name:'确认生成这份面板',exact:true}).waitFor();check('cancel leaves custom plan reviewable without calling model',(await page.locator('#panel-message').textContent()).includes('尚未调用模型'));
 await page.screenshot({path:screenshot,fullPage:true});
 check('unlisted server files stay inaccessible',(await page.request.get(base+'/package.json')).status()===404);check('no browser runtime errors',errors.length===0);
 counts=await(await page.request.get(base+'/fixture-counts.json')).json();check('exactly one model batch, one split and one panel in double',counts.fullCalls===1&&counts.localCalls===1&&counts.panelCalls===1);
 check('no native confirmation dialogs',nativeDialogs===0);
 // Clarification uses a legacy task without silently converting its preset or creating a sibling.
 const originalJob={id:'legacy-panel',kind:'settings',text:'原始设置面板',status:'needs-input',sha256:'old-sha',skinVersion:'f'.repeat(64),questions:[{question:'是否接受程序预设布局？'}]};
 const clarifyProject={id:'clarify-project',generationId:'clarify-generation',name:'补充需求回归',phase:'components-ready',skin:{version:'f'.repeat(64),thumbnails:[]},panels:[originalJob]};
 const clarifyPayloads=[];let clarifyCalls=0;
 await page.route(base+'/library.json',r=>r.fulfill({json:{projects:[clarifyProject],truncated:false}}));
 await page.route(base+'/pipeline/**',r=>{
  const data=r.request().postDataJSON();
  if(r.request().url().endsWith('/panel-prepare')){
   clarifyPayloads.push(data);const job={...originalJob,status:'prepared',revision:2,orientation:data.orientation,canvasSelection:true,history:[originalJob],text:originalJob.text+'\n补充：'+data.text,sha256:'new-sha'};delete job.questions;clarifyProject.panels=[job];return r.fulfill({json:job});
  }
  if(r.request().url().endsWith('/panel-start')){assert.equal(data.panelId,'legacy-panel');assert.equal(data.confirmed,'new-sha');clarifyCalls++;clarifyProject.panels[0].status='running';return r.fulfill({json:{status:'started'}});}
  throw Error('Unexpected clarification request');
 });
 await page.goto(base+'/#generate-panel');await page.reload();await page.getByRole('button',{name:'选择这套组件',exact:true}).click();
 await page.locator('#panel-orientation').selectOption('portrait');
 const response='接受程序预设布局，标题改为偏好设置。';await page.locator('#panel-request').fill(response);
 await page.getByRole('button',{name:'补充需求',exact:true}).click();const reply=page.getByRole('textbox',{name:'补充回答',exact:true});
 check('supplement does not overwrite top draft',await page.locator('#panel-request').inputValue()===response&&await reply.inputValue()===response);
 await reply.fill('');check('clarification answer required',await page.getByRole('button',{name:'保存补充并继续',exact:true}).isDisabled());await reply.fill(response);
 await page.waitForTimeout(5500);check('polling preserves clarification focus and draft',await reply.inputValue()===response&&await reply.evaluate(n=>n===document.activeElement));
 await page.screenshot({path:join(dirname(screenshot),'studio-clarification-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await reply.scrollIntoViewIfNeeded();check('clarification mobile fits viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:join(dirname(screenshot),'studio-clarification-mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'保存补充并继续',exact:true}).click();await page.locator('#confirm-dialog').waitFor({state:'visible'});check('continuation confirms a new call explicitly',(await page.locator('#confirm-title').textContent()).includes('补充回答'));
 await page.locator('#confirm-cancel').click();await page.getByRole('button',{name:'确认生成这份面板',exact:true}).waitFor();
 check('same legacy task gets answer and parent binding',clarifyPayloads.length===1&&clarifyPayloads[0].text===response&&clarifyPayloads[0].panelId==='legacy-panel'&&clarifyPayloads[0].parentSha256==='old-sha'&&clarifyPayloads[0].kind==='settings'&&clarifyPayloads[0].orientation==='portrait');
 check('cancel keeps one reviewable revision with zero submissions',clarifyCalls===0&&await page.locator('#panel-jobs article').count()===1&&(await page.locator('#panel-jobs').textContent()).includes('本任务第 2 版'));
 await page.reload();await page.getByRole('button',{name:'选择这套组件',exact:true}).click();await page.getByRole('button',{name:'确认生成这份面板',exact:true}).click();await page.locator('#confirm-accept').click();
 await page.waitForFunction(()=>document.querySelector('#panel-jobs')?.textContent.includes('正在生成面板'));check('saved continuation survives reload and submits once',clarifyCalls===1);
 await page.goto(base+'/#panels');await page.getByRole('button',{name:'删除面板',exact:true}).waitFor();check('running panel cannot be deleted in UI',await page.getByRole('button',{name:'删除面板',exact:true}).isDisabled());clarifyProject.panels[0].status='ready';clarifyProject.panels[0].artifact={id:'completed-elsewhere'};await page.getByRole('link',{name:'打开面板',exact:true}).waitFor({timeout:15000});check('finishing after leaving generation does not steal navigation',page.url().endsWith('/#panels'));check('clarification browser errors absent',errors.length===0);await page.unroute(base+'/library.json');await page.unroute(base+'/pipeline/**');
 // A running tab must reconnect its controls when the server assigns a new generation ID.
 const retryProject={id:'reconnect-project',generationId:'before-restart',name:'重启后补图回归',batchSha256:'b'.repeat(64),current:true,phase:'not-started',generationRunning:false,panels:[],state:{fresh:false,operation:'idle',nodes:['S01','S02','S03','S04'].map(sheetId=>({sheetId,status:sheetId==='S01'?'indeterminate':'received',outcomeRecorded:true}))}};
 retryProject.state.nodes[0].diagnostic={code:'image-request-connection-failed',label:'生图连接失败',detail:'生图请求连接失败，未返回图片。请检查网络或代理，稍后仅补本张；不会自动重投。',finishedAt:'2026-10-14T11:49:42Z'};
 retryProject.state.nodes[0].submittedAt='2026-10-14T11:49:16Z';
 let prepareError=false,statusError=false,retryCalls=0;const preparedIds=[];
 await page.route(base+'/library.json',r=>r.fulfill({json:{projects:[retryProject],truncated:false}}));
 await page.route(base+'/generation/**',r=>{
  const action=r.request().url().split('/').at(-1),data=r.request().postDataJSON();
  if(data.id!==retryProject.generationId)return r.fulfill({status:409,json:{code:'GENERATION_STATE_EXPIRED',message:'服务已重启，请重新操作。本次请求未提交生成。'}});
  if(action==='status')return statusError?r.fulfill({status:503,json:{message:'离线模拟：状态暂不可读'}}):r.fulfill({json:retryProject.state});
  if(action==='recover'){const n=retryProject.state.nodes[0];n.status='received';n.recovered=true;delete n.diagnostic;return r.fulfill({json:{...retryProject.state,recoveryResults:[{sheetId:'S01',recovered:true}],providerCalls:0}});}
  if(action==='supplement-prepare'){
   preparedIds.push(data.id);if(prepareError)return r.fulfill({status:409,json:{message:'离线模拟：准备失败，未提交模型。'}});
   return r.fulfill({json:{sheetId:'S01',planSha256:'c'.repeat(64),token:'current-token'}});
  }
  if(action==='supplement-start'){
   assert.deepEqual(data,{id:retryProject.generationId,sheetId:'S01',confirmed:'c'.repeat(64),token:'current-token'});retryCalls++;
   retryProject.generationRunning=true;retryProject.state.operation='running';retryProject.state.nodes[0].outcomeRecorded=false;
   return r.fulfill({json:{operation:'running'}});
  }
  throw Error('Unexpected reconnect test action');
 });
 await page.goto(base+'/#project/reconnect-project');await page.reload();await page.getByRole('button',{name:'仅补生成 S01',exact:true}).waitFor();
 check('failed atlas shows the safe cause and next action',await page.locator('#atlas-grid .atlas-card').first().getByText('生图连接失败',{exact:true}).count()===2&&(await page.locator('#atlas-grid .atlas-card').first().textContent()).includes('请检查网络或代理'));
 check('terminal failure freezes elapsed time',await page.locator('#atlas-grid .elapsed').first().textContent()==='用时 26 秒');
 await page.screenshot({path:join(dirname(screenshot),'studio-diagnostic-desktop.png'),fullPage:true});
 retryProject.generationId='after-restart';await page.locator('#refresh-project').click();
 await page.getByRole('button',{name:'仅补生成 S01',exact:true}).click();await page.locator('#confirm-dialog').waitFor();
 check('refreshed project binds supplement controls to the new generation ID',preparedIds.at(-1)==='after-restart');
 await page.locator('#confirm-cancel').click();check('reconnect cancel has no model call',retryCalls===0);
 await page.getByRole('button',{name:'仅补生成 S01',exact:true}).click();await page.locator('#confirm-dialog').waitFor();
 retryProject.generationId='restart-during-confirmation';await page.evaluate(()=>window.dispatchEvent(new Event('studio-status-changed')));
 await page.locator('#confirm-dialog').waitFor({state:'detached'});check('server identity change cancels the stale confirmation without resubmission',retryCalls===0);
 prepareError=true;statusError=true;await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'仅补生成 S01',exact:true}).click();await page.getByText('离线模拟：准备失败，未提交模型。',{exact:true}).waitFor();
 check('failed preparation and status read restore the button label and enabled state',await page.getByRole('button',{name:'仅补生成 S01',exact:true}).isEnabled()&&await page.getByRole('button',{name:'正在准备补图…',exact:true}).count()===0);
 check('mobile failure remains readable without horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:join(dirname(screenshot),'studio-reconnect-mobile.png'),fullPage:true});
 prepareError=false;statusError=false;retryProject.generationId='restart-before-poll';
 await page.getByRole('button',{name:'仅补生成 S01',exact:true}).click();await page.locator('#notice').filter({hasText:'服务已重启'}).waitFor();
 await page.getByRole('button',{name:'仅补生成 S01',exact:true}).waitFor();
 check('expired identity triggers a status refresh instead of replaying generation',retryCalls===0);
 await page.getByRole('button',{name:'仅补生成 S01',exact:true}).click();await page.locator('#confirm-dialog').waitFor();
 check('next user action uses the latest identity',preparedIds.at(-1)==='restart-before-poll');
 await page.locator('#confirm-accept').click();await page.waitForFunction(()=>document.querySelector('#atlas-grid .atlas-card')?.dataset.state==='active');
 check('fresh confirmation submits the supplement exactly once',retryCalls===1);
 check('new in-flight supplement does not retain the old failure label',!(await page.locator('#atlas-grid .atlas-card').first().textContent()).includes('生图连接失败'));
 retryProject.generationRunning=false;retryProject.state.operation='finished';retryProject.state.nodes[0].outcomeRecorded=true;retryProject.state.nodes[0].diagnostic={code:'returned-image-needs-check',label:'历史图片待核验',detail:'此前补图已保存图片，请先检查并恢复，无需再次生成。'};
 await page.locator('#refresh-project').click();await page.locator('#atlas-grid .atlas-card').first().getByText('历史图片待核验',{exact:true}).first().waitFor();
 check('historical image recovery hint replaces the latest connection error',!(await page.locator('#atlas-grid .atlas-card').first().textContent()).includes('连接失败'));
 await page.getByRole('button',{name:'检查并恢复已返回图片（不生成）',exact:true}).click();await page.locator('#refresh-project').click();await page.locator('#atlas-grid .atlas-card').first().getByText('已恢复接收',{exact:true}).first().waitFor();
 check('historical recovery updates the received count without another model call',retryCalls===1&&await page.locator('#progress-stats progress').first().getAttribute('value')==='4');
 await page.screenshot({path:join(dirname(screenshot),'studio-history-recovery-mobile.png'),fullPage:true});
 check('reconnect path has no runtime errors or native dialogs',errors.length===0&&nativeDialogs===0);
 await writeFile(report,JSON.stringify({status:'passed',mode:'offline-test-doubles',fixtureConfig,realModelCalls:0,checks,errors},null,2));console.log('Report: '+report);console.log('Studio UX: '+checks.length+' checks passed; real model calls 0');
}catch(error){await writeFile(report,JSON.stringify({status:'failed',mode:'offline-test-doubles',fixtureConfig,realModelCalls:0,checks,errors,failure:error.message},null,2));console.error('Report: '+report);throw error;}finally{await browser?.close();server.kill();}
