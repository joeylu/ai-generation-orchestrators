// Offline acceptance of the comparison surface using an explicitly supplied,
// checksum-verified consumer. Never starts generation or changes workspace state.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {studioSnapshot} from '../src/studio/catalog.mjs';
import {consumerServer} from '../src/runtime/consumer-tools.mjs';
import {readFile} from 'node:fs/promises';
const [directory,evidence]=process.argv.slice(2);if(!directory)throw Error('Usage: node scripts/studio-motion-compare-check.mjs work/consumer/directory [evidence-directory]');
const root=fileURLToPath(new URL('../',import.meta.url)),port=4214,base='http://127.0.0.1:'+port;
const snapshot=await studioSnapshot(root,{version:'0.1',name:'Motion comparison',artifacts:[{id:'comparison',name:'Verified fixture',type:'components',directory}]});
const server=consumerServer(snapshot,port,{allowFrames:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
let browser;const errors=[],checks=[];
const check=(name,condition)=>{assert.ok(condition,name);checks.push(name);};
try{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(base+'/')||/^(data:|blob:)/.test(r.request().url())?r.continue():r.abort());
 await page.goto(base+'/motion-compare.html#artifact=comparison&project=fixture');await page.waitForFunction(()=>window.motionComparison?.inspect().length===3);
 check('comparison page identity',(await page.title()).includes('三套动效对照'));
 check('three labeled real skin canvases',await page.locator('iframe').count()===3);
 const types=JSON.parse(await readFile(join(root,'fixtures/component-cases.json'),'utf8')).cases.map(c=>c.type);
 check('selector matches all loaded component cases',JSON.stringify(await page.locator('#component option').evaluateAll(nodes=>nodes.map(n=>n.value)))===JSON.stringify(types));
 const frames=page.frames().filter(f=>f.url().includes('component-canvas.html'));
 const before=await Promise.all(frames.map(f=>f.evaluate(()=>studioCanvas.items.map(({n})=>n.snapshot()))));
 for(const type of types){
  await page.selectOption('#component',type);await page.click('#play');
  await page.waitForFunction(()=>document.documentElement.dataset.demoPhase==='start');
  for(const f of frames)check(type+' actual demo action',await f.evaluate(type=>{
   const h=studioCanvas.items.find(i=>i.n.recipe.type===type).n,s=h.readState();
   switch(type){
    case 'Switch':case 'CheckBox':return s.checked===true;
    case 'RadioGroup':return s.selectedId===h.props.options[1].id;
    case 'Input':return s.value==='示例文字'&&!h.focusRing;
    case 'Select':return h.adapter.view.expanded;
    case 'Slider':return s.value===h.props.min+(h.props.max-h.props.min)*.8;
    case 'ProgressBar':return s.value===h.props.min+(h.props.max-h.props.min)*.9;
    case 'ScrollView':return s.initialOffsetY>0;
    case 'List':return s.selectedId===h.props.items[1].id;
    case 'Dialog':return s.open===false;
    case 'Tabs':return s.activeId===h.props.tabs[1].id;
    default:return h.root.visible;
   }
  },type));
  check(type+' shares three distinct active recipes',await page.evaluate(()=>new Set(motionComparison.inspect().map(s=>s.style)).size===3&&motionComparison.inspect().every(s=>s.error===null)));
  await page.waitForFunction(()=>document.documentElement.dataset.demoPhase==='complete');
  await page.waitForFunction(()=>motionComparison.inspect().every(s=>s.running===0));
 }
 assert.deepEqual(await Promise.all(frames.map(f=>f.evaluate(()=>studioCanvas.items.map(({n})=>n.snapshot())))),before,'demo does not change authoring snapshots');
 check('all actions preserve authoring snapshots',true);
 // Rapidly switch during the staged sequence; stale timers must not close a
 // newly selected component or leave transforms behind.
 await page.selectOption('#component','Select');await page.click('#play');await page.selectOption('#component','Dialog');
 await page.waitForFunction(()=>motionComparison.inspect().every(s=>s.running===0));
 for(const f of frames)check('rapid switch settles real dialog',await f.evaluate(()=>{const d=studioCanvas.items.find(i=>i.n.recipe.type==='Dialog').n;return d.readState().open&&d.adapter.view.innerView.scale.x===1;}));
 // Changed controls, focus and native input must reset between demonstrations.
 await page.selectOption('#component','Input');await page.click('#play');await page.waitForFunction(()=>document.documentElement.dataset.demoPhase==='start');await page.selectOption('#component','Text');
 for(const f of frames)check('leaving input clears focus without editing text',await f.evaluate(()=>{const n=studioCanvas.items.find(i=>i.n.recipe.type==='Input').n;return !n.focusRing?.visible;}));
 await page.selectOption('#component','Dialog');await page.waitForFunction(()=>motionComparison.inspect().every(s=>s.running===0));
 if(evidence)await page.screenshot({path:join(evidence,'motion-compare-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});check('mobile has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 for(const f of frames){await f.waitForFunction(()=>{const v=document.querySelector('#viewport'),i=studioCanvas.items.find(i=>i.n.recipe.type==='Dialog'),c=studioCanvas.camera;return c.scale>.7&&Math.abs(c.x+(i.x+i.w/2)*c.scale-v.clientWidth/2)<1&&Math.abs(c.y+(i.y+i.h/2)*c.scale-v.clientHeight/2)<1;});check('mobile retains selected control closeup',await f.evaluate(()=>{const v=document.querySelector('#viewport'),i=studioCanvas.items.find(i=>i.n.recipe.type==='Dialog'),c=studioCanvas.camera;return Math.abs(c.x+(i.x+i.w/2)*c.scale-v.clientWidth/2)<1&&Math.abs(c.y+(i.y+i.h/2)*c.scale-v.clientHeight/2)<1;}));}
 if(evidence)await page.screenshot({path:join(evidence,'motion-compare-mobile.png'),fullPage:true});
 await page.emulateMedia({reducedMotion:'reduce'});await page.click('#enter');check('reduced motion settles all columns',await page.evaluate(()=>motionComparison.inspect().every(s=>s.reducedMotion&&s.running===0)));
 check('no browser errors',errors.length===0);console.log(JSON.stringify({checks,errors,modelCalls:0},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
