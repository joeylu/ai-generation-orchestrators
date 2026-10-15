// Offline motion acceptance: real verified previews, memory-only selection API.
// No generation controller, model adapter or authoring-file writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {studioSnapshot} from '../src/studio/catalog.mjs';
import {studioStyles} from '../src/studio/styles.mjs';
import {studioPanelPresets} from '../src/studio/panel-presets.mjs';
import {studioServer} from '../src/studio/tasks.mjs';
import {motionSelection} from '../src/panel/motion-profile.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),port=4213,base='http://127.0.0.1:'+port;
const snapshot=await studioSnapshot(root,JSON.parse(await readFile(join(root,'work/studio/project.json'))));
await studioStyles(root,snapshot);studioPanelPresets(snapshot);
const item=snapshot.items.find(x=>x.id==='actions');assert.ok(item);
const job={id:'motion-fixture',sha256:'fixture',status:'ready',artifact:{id:item.id}},project={id:'motion-project',generationId:'offline',name:'动效离线验证',panels:[job]};
const server=studioServer(snapshot,port,async()=>[],null,null,null,null,{async action(action,data){assert.equal(action,'panel-motion');assert.equal(data.expectedSha256,job.sha256);job.motion=motionSelection(data.style);return {motion:job.motion};}},async()=>({projects:[project]}));
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
let browser;const errors=[],checks=[];function check(label,value){assert.ok(value,label);checks.push(label);}
try{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1.25});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(base+'/')||/^(data:|blob:)/.test(r.request().url())?r.continue():r.abort());
 await page.goto(base+'/#panel/actions');await page.waitForFunction(()=>document.querySelector('#panel-motion-style')?.disabled===false);
 const frame=page.frames().find(f=>f.url().endsWith('preview.html'));assert.ok(frame);
 const style=async value=>{await page.locator('#panel-motion-style').selectOption(value);await page.waitForFunction(s=>studioPanelMotion.inspect()?.style===s&&studioPanelMotion.inspect().running===0,value);};
 await style('playful');check('action preview attaches shared scheduler',await page.evaluate(()=>studioPanelMotion.inspect().error===null));
 await frame.locator('#form').click();await page.waitForFunction(()=>studioPanelMotion.inspect().running===0);
 check('new scene binds all live targets',await page.evaluate(()=>studioPanelMotion.inspect().targets.length===document.querySelector('#panel-frame').contentWindow.actionPreview.scene.runtime.handles.size));
 const point=await frame.evaluate(()=>{const h=[...actionPreview.scene.runtime.handles.values()].find(h=>h.recipe.type==='Button'),b=h.root.getBounds(),r=actionPreview.app.canvas.getBoundingClientRect(),s=r.width/actionPreview.app.screen.width;return{id:h.id,x:r.left+(b.x+b.width/2)*s,y:r.top+(b.y+b.height/2)*s};});
 const box=await page.locator('#panel-frame').boundingBox();await page.mouse.move(box.x+point.x,box.y+point.y);await page.mouse.down();
 await page.waitForFunction(id=>studioPanelMotion.inspect().targets.find(t=>t.id===id)?.scale<0.98,point.id);
 check('native button press visibly scales actual Pixi node',await frame.evaluate(id=>actionPreview.scene.runtime.handles.get(id).root.scale.x<0.98,point.id));
 await page.mouse.move(5,5);await page.mouse.up();await page.waitForFunction(()=>studioPanelMotion.inspect().running===0);
 check('release restores exact transforms',await frame.evaluate(()=>[...actionPreview.scene.runtime.handles.values()].every(h=>h.root.scale.x===1&&h.root.scale.y===1&&h.root.pivot.x===0&&h.root.pivot.y===0)));
 const state=await frame.evaluate(()=>JSON.stringify(actionPreview.state));
 for(const value of ['premium','corporate','original','playful'])await style(value);
 check('style changes preserve action form values',await frame.evaluate(()=>JSON.stringify(actionPreview.state))===state);
 await frame.locator('#reopen').click();await page.waitForFunction(()=>studioPanelMotion.inspect().running===0);check('reopen has no destroyed target errors',await page.evaluate(()=>studioPanelMotion.inspect().error===null));
 await frame.evaluate(id=>actionPreview.scene.runtime.handles.get(id).setEnabled(false),point.id);
 await page.waitForFunction(()=>studioPanelMotion.inspect().running===0);
 check('disabled controls retain disabled alpha',await frame.evaluate(id=>{const h=actionPreview.scene.runtime.handles.get(id);return h.root.scale.x===1&&h.root.alpha===actionPreview.scene.runtime.skin.profile.disabledAlpha;},point.id));
 if(process.argv[2]){
  await page.screenshot({path:join(process.argv[2],'studio-motion-actions.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});check('mobile controls stay inside viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(process.argv[2],'studio-motion-actions-mobile.png'),fullPage:true});
 }
 await page.goto(base+'/#panels');check('leaving preview tears down motion',await page.evaluate(()=>studioPanelMotion.inspect()===undefined));
 assert.deepEqual(errors,[]);check('no browser runtime errors',true);console.log(JSON.stringify({checks,errors,modelCalls:0},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
