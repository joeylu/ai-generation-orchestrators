import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {loadSceneKit} from '../../src/kit.mjs';
import {connectedMap} from '../helpers/mixed.mjs';
import {fixtureRoot} from '../helpers/generation.mjs';
import {scenePixels} from './canvas-controls.mjs';

test('released terrain and assembly previews stay at the drop position until the one edit settles', {timeout:120000}, async t=>{
  const temp=mkdtempSync(join(tmpdir(),'scene-transform-handoff-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const d=connectedMap(loadSceneKit(fixtureRoot));d.assemblyInstances=[{instanceId:'piece',presetId:'platform.small',layerId:'environment',column:34,row:3}];
  d.curveTerrains.push({curveId:'free',familyId:'terrain.primary',profile:'sideview-height-curve-v1',baseY:576,points:[{x:1408,y:448,slope:0},{x:1664,y:320,slope:0},{x:1920,y:448,slope:0}]});
  const staticRoot=await buildStudio({output:join(temp,'static')}),host=await startStudio({root:fixtureRoot,staticRoot,initialDocument:d});t.after(()=>host.close());
  const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
  await page.route('**/*',r=>new URL(r.request().url()).origin===host.url?r.continue():(external.push(r.request().url()),r.abort()));
  await page.goto(host.url);await page.waitForSelector('body[data-ready="true"]');
  assert.match(await page.title(),/Scene Kit Studio/);assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);
  const snap=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),sha=b=>createHash('sha256').update(b).digest('hex');
  const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  async function point(x,y){const b=await page.locator('canvas').boundingBox(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),w:+e.getAttribute('width'),h:+e.getAttribute('height')}));return{x:b.x+(x-v.x)/v.w*b.width,y:b.y+(y-v.y)/v.h*b.height};}
  async function begin(x,y,dx,dy){const a=await point(x,y),b=await point(x+dx,y+dy);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await frames();}
  for(const [id,x,y,dx,dy]of [['free',1664,420,-37,-21],['mixed.hill',100,500,128,-64],['piece',2208,224,64,0]]){
    await page.locator(`[data-instance-id="${id}"]`).dblclick();await page.getByRole('button',{name:'选择 V',exact:true}).click();
    const before=await snap();await begin(x,y,dx,dy);const held=await scenePixels(page);
    let release,seen;const gate=new Promise(r=>release=r),requested=new Promise(r=>seen=r);let requests=0;
    const handler=async route=>{requests++;seen();await gate;await route.continue();};await page.route(host.url+'/api/edit',handler);
    try{
      await page.mouse.up();await requested;await frames();const waiting=await scenePixels(page);
      if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,`handoff-${id}-held.png`),held);writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,`handoff-${id}-waiting.png`),waiting);}
      assert.equal(sha(waiting),sha(held),`${id} bounced back before its edit response`);
      assert.deepEqual((await snap()).document,before.document);assert.deepEqual((await snap()).history,before.history);
      // Losing focus after release must not discard a request already being submitted.
      await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await frames();assert.equal(sha(await scenePixels(page)),sha(held));
      release();await page.waitForFunction(r=>+document.body.dataset.revision>r,before.revision);await page.waitForFunction(()=>!document.querySelector('[data-tool="select"]').disabled);
      assert.equal(requests,1);assert.equal((await snap()).history.undoDepth,before.history.undoDepth+1);
    }finally{release();await page.unroute(host.url+'/api/edit',handler);}
    const changed=await snap();await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(r=>+document.body.dataset.revision>r,changed.revision);assert.deepEqual((await snap()).document,before.document);
  }
  // Invalid movement also keeps its last preview while validation is pending,
  // then makes one deliberate rollback after rejection, without a history entry.
  await page.locator('[data-instance-id="free"]').dblclick();await page.getByRole('button',{name:'选择 V',exact:true}).click();const a=await point(1664,420);await page.mouse.click(a.x,a.y);await frames();
  const before=await snap(),original=sha(await scenePixels(page));await begin(1664,420,0,40);const held=sha(await scenePixels(page));let release,seen;
  const gate=new Promise(r=>release=r),requested=new Promise(r=>seen=r),handler=async route=>{seen();await gate;await route.continue();};await page.route(host.url+'/api/edit',handler);
  try{await page.mouse.up();await requested;await frames();assert.equal(sha(await scenePixels(page)),held);release();await page.waitForFunction(()=>document.querySelector('#status').dataset.error==='true');await page.waitForFunction(()=>!document.querySelector('[data-tool="select"]').disabled);await frames();assert.equal(sha(await scenePixels(page)),original);assert.deepEqual((await snap()).document,before.document);assert.deepEqual((await snap()).history,before.history);}
  finally{release();await page.unroute(host.url+'/api/edit',handler);}
  const expected=errors.filter(e=>e.includes('422 (Unprocessable Entity)'));assert.equal(expected.length,1);assert.deepEqual(errors.filter(e=>!expected.includes(e)),[]);assert.deepEqual(external,[]);
});
