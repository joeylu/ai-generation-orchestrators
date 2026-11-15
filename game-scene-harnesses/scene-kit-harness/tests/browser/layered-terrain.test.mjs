import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {loadSceneKit} from '../../src/kit.mjs';
import {connectedMap} from '../helpers/mixed.mjs';
import {fixtureRoot} from '../helpers/generation.mjs';
import {readStoredArchive} from '../../src/archive.mjs';

test('preset drag uses actual curve solids; upper platforms save/reopen/export and conflicts stop before submission', {timeout:150000},async t=>{
  const temp=mkdtempSync(join(tmpdir(),'scene-layered-browser-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const initialDocument=connectedMap(loadSceneKit(fixtureRoot)),staticRoot=await buildStudio({output:join(temp,'static')});
  const workspaceRoot=join(temp,'workspace'),host=await startStudio({root:fixtureRoot,staticRoot,initialDocument,workspaceRoot,projectName:'Layered fixture'});t.after(()=>host.close());
  const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[],edits=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});page.on('request',r=>{if(r.url()===host.url+'/api/edit')edits.push(r.postDataJSON());});
  await page.route('**/*',r=>new URL(r.request().url()).origin===host.url?r.continue():(external.push(r.request().url()),r.abort()));
  await page.goto(host.url+'/editor');await page.waitForSelector('body[data-ready="true"]');assert.match(await page.title(),/Scene Kit Studio/);assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);
  const snap=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),revision=r=>page.waitForFunction(v=>+document.body.dataset.revision>v,r);
  async function point(x,y){const b=await page.locator('canvas').boundingBox(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),w:+e.getAttribute('width'),h:+e.getAttribute('height')}));return{x:b.x+(x-v.x)/v.w*b.width,y:b.y+(y-v.y)/v.h*b.height};}
  async function startDrop(x,y){await page.locator('#tab-presets').click();const b=await page.getByRole('button',{name:'放置组合 platform.small',exact:true}).boundingBox(),p=await point(x,y);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+15,b.y+b.height/2,{steps:4});await page.mouse.move(p.x,p.y,{steps:12});}
  const before=await snap();await startDrop(450,370);assert.equal(await page.locator('#canvas-host').getAttribute('data-drop-valid'),'false');assert.match(await page.locator('.canvas-drop-hint').innerText(),/实体重叠/);await page.mouse.up();assert.deepEqual((await snap()).document,before.document);assert.deepEqual((await snap()).history,before.history);assert.equal(edits.length,0);
  await startDrop(450,80);assert.equal(await page.locator('#canvas-host').getAttribute('data-drop-valid'),'true');await page.mouse.up();await revision(before.revision);
  const placed=await snap();assert.equal(placed.document.format,'ai_scene_document_v6');assert.equal(placed.scene.format,'ai_scene_compiled_v7');assert.equal(placed.history.undoDepth,before.history.undoDepth+1);assert.equal(edits.length,1);assert.equal(edits[0].commands[0].type,'enable-layered-terrain');assert.equal(placed.document.assemblyInstances.length,1);assert.deepEqual(placed.document.curveTerrains,before.document.curveTerrains);assert.deepEqual(placed.document.terrainConnections,before.document.terrainConnections);assert.equal(placed.scene.mixedTerrains.length,1);
  const saved=JSON.parse(readFileSync(join(workspaceRoot,'workspace.json')));assert.equal(saved.projects[0].maps[0].document.format,'ai_scene_document_v6');
  await page.getByRole('button',{name:'撤销',exact:true}).click();await revision(placed.revision);assert.deepEqual((await snap()).document,before.document);const undone=await snap();await page.getByRole('button',{name:'重做',exact:true}).click();await revision(undone.revision);assert.deepEqual((await snap()).document,placed.document);
  await page.reload();await page.waitForSelector('body[data-ready="true"]');assert.deepEqual((await snap()).document,placed.document);
  const event=page.waitForEvent('download');await page.locator('#download-menu>summary').click();await page.locator('#export-pack').click();const download=await event,path=join(temp,'layered.zip');await download.saveAs(path);const files=readStoredArchive(readFileSync(path));assert.equal(JSON.parse(files.get('scene.document.json')).format,'ai_scene_document_v6');assert.equal(JSON.parse(files.get('scene.compiled.json')).terrainCoexistence.profile,'layered-terrain-solids-v1');
  if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'layered-platform-above-curve.png')});}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
