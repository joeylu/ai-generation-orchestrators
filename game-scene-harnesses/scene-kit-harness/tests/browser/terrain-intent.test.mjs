import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setupTerrainEdgeDelivery} from '../helpers/terrain-edge-delivery.mjs';
import {createIntentTerrainProfile} from '../../src/terrain-intent.mjs';
import {upgradeSharedTerrainFieldKit} from '../../src/shared-terrain-upgrade.mjs';
import {loadSceneKit,readMap,contextFor} from '../../src/kit.mjs';
import {digest} from '../../src/generation/common.mjs';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {inspectPng} from '../../src/png.mjs';
import {dismissCanvasPanels,scenePixels} from './canvas-controls.mjs';

test('rigid intent uses actual shared geometry in the palette, a new UI stroke, undo and reload',{timeout:360000},async t=>{
  const f=setupTerrainEdgeDelivery(t,{receiveEdges:false}),handle=loadSceneKit(f.baseKitRoot),ctx=contextFor(handle),document=readMap(handle);
  for(const key of ['terrainRuns','instances','assemblyInstances','inspectionCases','curveTerrains','terrainConnections','instanceTransforms'])document[key]=[];
  document.bounds={x:0,y:0,width:12,height:6};document.defaultCamera={center:{x:384,y:192},viewport:{width:768,height:384},scale:1};
  document.terrainRuns=[{x:0,y:5,length:1,familyId:ctx.rules.familyId}];
  const intent={profile:'reference-terrain-intent-v1',contour:'rigid-manufactured',notes:'Synthetic straight constructed ledge.'},
    settings={profile:'intent-bound-shared-terrain-v1',terrainIntentSha256:digest(intent),outline:{maximumInsetWorld:0,sampleStepWorld:8,wavelengthWorld:64,seed:731},capEndRow:16,fadeRows:0},
    profile=createIntentTerrainProfile(intent,settings,ctx.kit.terrainAppearance),output=join(f.parent,'intent-kit');
  upgradeSharedTerrainFieldKit({root:f.baseKitRoot,document,profile,output});
  const staticRoot=await buildStudio({output:join(f.parent,'static')}),host=await startStudio({root:join(output,'kit'),staticRoot,workspaceRoot:join(f.parent,'workspace'),projectName:'Synthetic straight terrain intent'});
  t.after(()=>host.close());const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1}),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===host.url?route.continue():(external.push(route.request().url()),route.abort()));
  await page.goto(host.url+'/editor');await page.waitForSelector('body[data-ready="true"]',{timeout:90000});
  const state=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),initial=await state();
  await page.getByRole('button',{name:'画刷',exact:true}).click();const card=page.getByRole('button',{name:'地形画刷',exact:true});
  assert.match(await card.locator('img').getAttribute('src'),/_terrain-brush-flat\.png$/);await card.click();
  await page.locator('#canvas-options>summary').click();await page.locator('#brush-preview>summary').click();await page.waitForFunction(()=>document.querySelectorAll('#brush-tiles figure').length===4);
  assert.deepEqual(await page.locator('#brush-tiles figcaption').allTextContents(),['连续地面','阶梯','开口','凹角']);await dismissCanvasPanels(page);await page.locator('#grid').uncheck();
  const geometry=async()=>({rect:await page.locator('canvas').boundingBox(),view:await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height')}))});
  const g=await geometry(),screen=(x,y)=>({x:g.rect.x+(x-g.view.x)/g.view.width*g.rect.width,y:g.rect.y+(y-g.view.y)/g.view.height*g.rect.height}),a=screen(160,160),b=screen(480,160);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:16});await page.mouse.up();await page.waitForFunction(n=>+document.body.dataset.revision>n,initial.revision);
  const painted=await state();assert.equal(painted.history.undoDepth,1);assert.equal(painted.scene.terrainSharedField.profileSha256,profile.sha256);assert(painted.scene.gridTerrains.length>0);
  await page.getByRole('button',{name:'选择 V',exact:true}).click();await page.mouse.move(1000,50);
  const bytes=await scenePixels(page),png=inspectPng(bytes,{includePixels:true}),camera=await geometry(),worldPixel=(x,y)=>({x:(x-camera.view.x)/camera.view.width*png.width,y:(y-camera.view.y)/camera.view.height*png.height});
  const ys=[];for(let x=144;x<496;x+=8){const p=worldPixel(x,128),bg=worldPixel(x,118),base=(Math.round(bg.y)*png.width+Math.round(bg.x))*4;let found=-1;
    for(let y=Math.floor(p.y)-3;y<=Math.ceil(p.y)+5;y++){const n=(y*png.width+Math.round(p.x))*4;if([0,1,2].some(c=>Math.abs(png.rgba[n+c]-png.rgba[base+c])>12)){found=y;break;}}assert(found>=0);ys.push(found);}
  assert(Math.max(...ys)-Math.min(...ys)<=1,'software WebGL flat top must not reproduce a repeated tile ripple');
  await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(n=>+document.body.dataset.revision>n,painted.revision);assert.equal((await state()).scene.contentSha256,initial.scene.contentSha256);
  const undo=await state();await page.getByRole('button',{name:'重做',exact:true}).click();await page.waitForFunction(n=>+document.body.dataset.revision>n,undo.revision);assert.equal((await state()).scene.contentSha256,painted.scene.contentSha256);
  await page.reload();await page.waitForSelector('body[data-ready="true"]');assert.equal((await state()).scene.contentSha256,painted.scene.contentSha256);
  if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,'rigid-intent-canvas.png'),bytes);await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'rigid-intent-studio.png')});}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
