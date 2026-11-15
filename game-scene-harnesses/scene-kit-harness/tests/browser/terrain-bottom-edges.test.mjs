import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import * as flow from '../../src/generation/index.mjs';
import {setupBottomDelivery,bottomSideControls,freezeBottomDeliverySources} from '../helpers/terrain-bottom-delivery.mjs';
import {buildTerrainEdgeDelivery} from '../../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,readMap} from '../../src/kit.mjs';
import {compileMap} from '../../src/compile.mjs';
import {canonicalMap} from '../../src/document.mjs';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {dismissCanvasPanels,scenePixels} from './canvas-controls.mjs';
import {hash,jsonBytes} from '../../src/generation/common.mjs';

test('native bottom textures participate in actual Pixi brush, hole, undo, redo and export rendering',{timeout:600000},async t=>{
 const f=setupBottomDelivery(t,{receiveSides:false}),controls=bottomSideControls(f),
  {batch,bottom}=freezeBottomDeliverySources(f,flow.TERRAIN_PERIMETER_ROLES,'browser.perimeter'),
  output=join(f.parent,'perimeter'),options={...f.deliveryOptions,batchSha256:batch.sha256,controls:{...controls,bottom:bottom.controls},output};
 buildTerrainEdgeDelivery(options);
 const root=join(output,'candidate/kit'),handle=loadSceneKit(root),map=readMap(handle);
 map.instances=[];map.assemblyInstances=[];map.curveTerrains=[];map.inspectionCases=[];
 map.bounds={x:0,y:0,width:16,height:9};map.defaultCamera={center:{x:512,y:288},viewport:{width:1024,height:576},scale:1};
 map.terrainRuns=Array.from({length:5},(_,i)=>({familyId:'terrain.primary',x:2,y:i+2,length:10}));
 const initialScene=compileMap(handle,map),staticRoot=await buildStudio({output:join(f.parent,'bottom-static')}),
  host=await startStudio({root,staticRoot,port:0,initialDocument:map});t.after(()=>host.close());
 const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launch({headless:true,
  channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1680,height:1060},deviceScaleFactor:1}),errors=[],warnings=[],external=[],bottomRequests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
 page.on('response',r=>{if(r.url().includes('_terrain-bottom-'))bottomRequests.push({path:new URL(r.url()).pathname,status:r.status()});});
 await page.route('**/*',r=>new URL(r.request().url()).origin===host.url?r.continue():(external.push('blocked'),r.abort()));
 await page.goto(host.url+'/editor');await page.waitForSelector('body[data-ready="true"]',{timeout:90000});
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const state=()=>page.evaluate(async()=>await(await fetch('/api/state')).json());
 const initial=await state();assert.equal(initial.scene.contentSha256,initialScene.contentSha256);
 assert.deepEqual(initial.document,canonicalMap(map));assert.equal(initial.kitMaterial.bottomEdges.profile,'native-horizontal-bottom-union-v1');
 assert.equal(new Set(bottomRequests.map(r=>r.path)).size,3);assert(bottomRequests.every(r=>r.status===200));
 await dismissCanvasPanels(page);await page.locator('#grid').uncheck();await page.locator('#home').click();await settle();
 async function stroke(tool,x0,y0,x1=x0,y1=y0){
  await dismissCanvasPanels(page);await page.locator('#tab-terrain').click();
  await page.getByRole('button',{name:tool==='erase'?'擦除 E':'地形画刷',exact:true}).click();
  const before=await state(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height')})),
   b=await page.locator('canvas').boundingBox(),p=(x,y)=>({x:b.x+((x+.5)*64-v.x)*b.width/v.width,y:b.y+((y+.5)*64-v.y)*b.height/v.height}),a=p(x0,y0),z=p(x1,y1);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(z.x,z.y,{steps:Math.max(8,Math.abs(x1-x0)*4,Math.abs(y1-y0)*4)});await page.mouse.up();
  await page.waitForFunction(rev=>+document.body.dataset.revision>rev,before.revision);await settle();
  const after=await state();assert.equal(after.revision,before.revision+1,'one gesture remains one core command');
  assert.equal(page.locator('#status')?await page.locator('#status').getAttribute('data-error'):'false','false');return after;
 }
 const hole=await stroke('erase',5,4,8,4);
 assert.equal(hole.scene.counts.terrainNodes,initial.scene.counts.terrainNodes-4);
 assert(hole.scene.terrainBottomEdgePlacement.placed.some(p=>p.y===256&&p.fromX===320&&p.toX===576),'new hole ceiling must receive native bottom trim');
 assert(hole.scene.gridTerrains.flatMap(p=>p.edgeMeshes??[]).some(m=>m.materialKey==='bottom.edge'));
 const raised=await stroke('paint',5,1,8,1);assert.equal(raised.scene.counts.terrainNodes,initial.scene.counts.terrainNodes);
 for(const s of [hole,raised])for(const patch of [...s.scene.gridTerrains,...s.scene.curveTerrains]){
  const H=s.kitMaterial.bodyPeriod.height.numerator/s.kitMaterial.bodyPeriod.height.denominator,O=s.kitMaterial.bodyOriginWorldY.numerator/s.kitMaterial.bodyOriginWorldY.denominator;
  for(let i=0;i<patch.body.positions.length;i+=2){assert(Math.abs(patch.body.uvs[i]-patch.body.positions[i]/512)<1e-8);assert(Math.abs(patch.body.uvs[i+1]-(patch.body.positions[i+1]-O)/H)<1e-8);}
 }
 const undoRevision=raised.revision;await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(r=>+document.body.dataset.revision>r,undoRevision);
 const undone=await state();assert.deepEqual(undone.document,hole.document);assert.equal(undone.scene.contentSha256,hole.scene.contentSha256);
 await page.getByRole('button',{name:'重做',exact:true}).click();await page.waitForFunction(r=>+document.body.dataset.revision>r,undone.revision);
 const redone=await state();assert.deepEqual(redone.document,raised.document);assert.equal(redone.scene.contentSha256,raised.scene.contentSha256);
 await page.reload();await page.waitForSelector('body[data-ready="true"]',{timeout:90000});const reloaded=await state();assert.deepEqual(reloaded.document,raised.document);
 await dismissCanvasPanels(page);await page.locator('#grid').uncheck();await settle();const scenePng=await scenePixels(page);
 assert(scenePng.length>10000,'actual software-WebGL frame must render');
 const zipResponse=await page.request.get(host.url+'/api/export?revision='+reloaded.revision);assert.equal(zipResponse.status(),200);
 assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.deepEqual(external,[]);
 if(process.env.SCENE_KIT_SCREENSHOTS){
  const dir=process.env.SCENE_KIT_SCREENSHOTS;mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'bottom-brush-synthetic.png'),scenePng);
  writeFileSync(join(dir,'bottom-studio-synthetic.png'),await page.screenshot());
  writeFileSync(join(dir,'browser-proof.json'),jsonBytes({format:'scene_terrain_bottom_browser_test_v1',synthetic:true,softwareWebGL:true,
   bottomRequests,initialCompiled:initial.scene.contentSha256,holeCompiled:hole.scene.contentSha256,raisedCompiled:raised.scene.contentSha256,
   actualPointerStrokes:2,undoRedo:true,reload:true,scenePngSha256:hash(scenePng),errors,warnings,external,generationCalls:0}));
 }
});
