import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import * as flow from '../../src/generation/index.mjs';
import {setupTerrainEdgeDelivery,receiveEdgeFixture} from '../helpers/terrain-edge-delivery.mjs';
import {decision} from '../helpers/generation.mjs';
import {buildTerrainEdgeDelivery} from '../../src/terrain-edge-pipeline.mjs';
import {upgradeTerrainBrushKit} from '../../src/grid-terrain-upgrade.mjs';
import {upgradeTerrainEdgeJunctionKit} from '../../src/terrain-edge-junction-upgrade.mjs';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {loadSceneKit,readMap} from '../../src/kit.mjs';
import {compileMap} from '../../src/compile.mjs';
import {exportSceneArchive} from '../../src/persistence.mjs';
import {inspectPng,encodeRgbaPng} from '../../src/png.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../../src/terrain-edges.mjs';
import {canonicalJson} from '../../src/document.mjs';
import {hash,jsonBytes} from '../../src/generation/common.mjs';
import {exerciseGridBrush} from './grid-terrain-edges-flow.mjs';
import {scenePixels,dismissCanvasPanels,centerCanvasHorizontally} from './canvas-controls.mjs';

// Source-double corner/wall colors and native landmarks make complete tail
// overlap visible in actual WebGL pixels. No real media is used or generated;
// the v4/v5 runs use exactly the same PNGs and their original alpha.
function junctionSource(bytes,item){
  const png=inspectPng(bytes,{includePixels:true,allowHiddenRgb:true}),anchors=item.repeatY?[item.repeatY.from,item.repeatY.to]:[item.wallStartY];
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
    const p=(y*png.width+x)*4;if(!png.rgba[p+3])continue;
    const offset=Math.round(18*Math.sin((x-item.boundaryX)*Math.PI/48)),valley=anchors.some(anchor=>Math.abs(y-anchor-offset)<=4),
      color=valley?[24,20,16]:item.repeatY?[90,45,25]:[200,80,40];
    png.rgba.set(color,p);
  }
  return encodeRgbaPng(png.width,png.height,png.rgba);
}

test('complete native alpha overlaps retain corner tails on real grid and curve pixels without gaps or changed source PNGs',{timeout:360000},async t=>{
  const f=setupTerrainEdgeDelivery(t,{receiveEdges:false}),controls=f.deliveryOptions.controls;controls.joinProfile=NEAR_OPAQUE_JOIN_PROFILE;
  for(const side of ['left','right'])for(const part of ['wall','corner']){
    const item=controls[side][part];item.inboardBlend={fromX:item.innerX,toX:side==='left'?276:12};
    if(part==='wall')item.repeatY={from:96,to:360};
  }
  flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('junction.double.compute',f.batch.sha256,'approve-compute'));
  for(const sha of f.batch.planSha256s){
    const role=flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole,[side]=role.split('-'),part=role.endsWith('wall')?'wall':'corner';
    receiveEdgeFixture(f.workflow,sha,junctionSource(f.raws.get(role),controls[side][part]));
  }
  buildTerrainEdgeDelivery(f.deliveryOptions);
  const edgeRoot=join(f.deliveryOptions.output,'candidate/kit'),initial=readMap(loadSceneKit(edgeRoot)),familyId=initial.curveTerrains[0].familyId;
  initial.terrainRuns=[];initial.instances=[];initial.assemblyInstances=[];initial.inspectionCases=[];initial.bounds={x:0,y:0,width:20,height:12};
  initial.curveTerrains=[{curveId:'curve.junction',familyId,profile:'sideview-height-curve-v1',baseY:640,
    points:[{x:64,y:192,slope:0},{x:256,y:192,slope:0}]}];
  const gridRoot=join(f.parent,'grid-upgrade');upgradeTerrainBrushKit({root:edgeRoot,document:initial,output:gridRoot});
  const legacyRoot=join(gridRoot,'kit'),legacyHandle=loadSceneKit(legacyRoot),v4Document=JSON.parse(readFileSync(join(gridRoot,'export/scene.document.json'),'utf8')),
    fixedRoot=join(f.parent,'junction-upgrade'),receipt=upgradeTerrainEdgeJunctionKit({root:legacyRoot,document:v4Document,output:fixedRoot}),
    root=join(fixedRoot,'kit'),handle=loadSceneKit(root),fixedDocument=JSON.parse(readFileSync(join(fixedRoot,'export/scene.document.json'),'utf8'));
  assert.equal(receipt.allOriginalPngBytesPreserved,true);
  const staticRoot=await buildStudio({output:join(f.parent,'junction-static')}),host=await startStudio({root,staticRoot,port:0,
    initialDocument:fixedDocument,workspaceRoot:join(f.parent,'fixed-workspace'),projectName:'Synthetic native junction test'});t.after(()=>host.close());
  const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});t.after(()=>browser.close());
  const errors=[],warnings=[],external=[],edgeRequests=[];
  async function open(url){
    const page=await browser.newPage({viewport:{width:1680,height:1060},deviceScaleFactor:1,acceptDownloads:true});
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
    page.on('response',response=>{if(response.url().includes('/_terrain-edge-'))edgeRequests.push({origin:url,path:new URL(response.url()).pathname,status:response.status()});});
    await page.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():(external.push('blocked-external-origin'),route.abort()));
    await page.goto(url+'/editor');await page.waitForSelector('body[data-ready="true"]',{timeout:90000});
    assert.equal(page.url(),url+'/editor');assert.match(await page.title(),/Scene Kit Studio/);assert(await page.locator('#palette button').count()>0);
    assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);return page;
  }
  async function pixels(page,name){
    await dismissCanvasPanels(page);await page.locator('#grid').uncheck();await page.locator('[data-tool="select"]').click();await page.locator('#fit').click();
    await centerCanvasHorizontally(page,480);for(let i=0;i<4;i++)await page.locator('#zoom-in').click();
    await page.mouse.move(900,45);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const bytes=await scenePixels(page),image=inspectPng(bytes,{includePixels:true}),camera=await page.locator('#minimap rect').last().evaluate(e=>
      ({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height')}));
    if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,name+'.png'),bytes);}
    return {image,camera,sha256:hash(bytes)};
  }
  const page=await open(host.url),stages=[];
  const result=await exerciseGridBrush(page,{hostUrl:host.url,left:6,right:13,top:3,bottom:9,extensionLeft:9,extensionRight:12,onStage:async(name,state)=>{
    assert.equal(state.scene.terrainMaterial.edges.format,'ai_scene_terrain_edges_v5');
    assert(state.scene.gridTerrains.some(patch=>patch.source.gridCells.length>=56));
    assert(state.scene.curveTerrains.some(curve=>curve.edgeMeshes?.length));
    stages.push({name,authorSha256:state.scene.source.authorSha256,compiledSha256:state.scene.contentSha256,
      coveredCells:state.scene.gridTerrains.reduce((n,p)=>n+p.source.gridCells.length,0)});
  }});
  const zipFile=join(f.parent,'browser-junction.zip');await result.download.saveAs(zipFile);const zip=readFileSync(zipFile);
  assert.deepEqual(zip,exportSceneArchive(handle,result.reloaded.document));assert.equal(compileMap(handle,result.reloaded.document).contentSha256,result.reloaded.scene.contentSha256);
  const fixed=await pixels(page,'junction-v5'),legacyDocument=structuredClone(result.reloaded.document);legacyDocument.kitRef=v4Document.kitRef;
  const beforeHost=await startStudio({root:legacyRoot,staticRoot,port:0,initialDocument:legacyDocument,
    workspaceRoot:join(f.parent,'legacy-workspace'),projectName:'Synthetic unchanged-source v4 comparison'});t.after(()=>beforeHost.close());
  const beforePage=await open(beforeHost.url),before=await pixels(beforePage,'junction-v4');assert.deepEqual(fixed.camera,before.camera);
  assert.equal(fixed.image.width,before.image.width);assert.equal(fixed.image.height,before.image.height);
  let changedGridPixels=0,changedCurvePixels=0,changedGridRepeatPixels=0,changedCurveRepeatPixels=0,
    collarSamples=0,backgroundLeaks=0,nativeCornerTailPixelsGrid=0,nativeCornerTailPixelsCurve=0;
  const joins=[];for(const top of [64,192])for(let y=top+24;y<640;y+=22)joins.push(y);
  const repeatJoins=[];for(let y=192+24+22;y<500;y+=22)repeatJoins.push(y);
  for(let y=0;y<fixed.image.height;y++)for(let x=0;x<fixed.image.width;x++){
    const wx=fixed.camera.x+(x+.5)/fixed.image.width*fixed.camera.width,wy=fixed.camera.y+(y+.5)/fixed.image.height*fixed.camera.height,
      p=(y*fixed.image.width+x)*4,diff=Math.max(...[0,1,2].map(c=>Math.abs(fixed.image.rgba[p+c]-before.image.rgba[p+c])));
    if(diff>8&&joins.some(join=>Math.abs(wy-join)<=6.5)){
      if((wx>=376&&wx<=396)||(wx>=884&&wx<=904))changedGridPixels++;
      if(wx>=244&&wx<=264)changedCurvePixels++;
    }
    if(diff>8&&repeatJoins.some(join=>Math.abs(wy-join)<=6.5)){
      if((wx>=376&&wx<=396)||(wx>=884&&wx<=904))changedGridRepeatPixels++;
      if(wx>=244&&wx<=264)changedCurveRepeatPixels++;
    }
    if(wy>218&&wy<221&&fixed.image.rgba[p]===200&&fixed.image.rgba[p+1]===80&&fixed.image.rgba[p+2]===40
      &&before.image.rgba[p]!==200){
      if(wx>387&&wx<391)nativeCornerTailPixelsGrid++;
      if(wx>249&&wx<253)nativeCornerTailPixelsCurve++;
    }
    if(wx>390.5&&wx<391.5&&wy>200&&wy<500&&joins.some(join=>Math.abs(wy-join)<2)){
      collarSamples++;if(fixed.image.rgba[p]===29&&fixed.image.rgba[p+1]===43&&fixed.image.rgba[p+2]===59)backgroundLeaks++;
    }
  }
  assert(changedGridPixels>10,'complete native overlaps must change visible grid seam pixels');
  assert(changedCurvePixels>10,'the same source-bound transition must reach visible curve-side pixels');
  assert(changedGridRepeatPixels>10,'wall-repeat changes must be visible independently of the first corner tail on the grid');
  assert(changedCurveRepeatPixels>10,'wall-repeat changes must also be visible below the corner on the curve');
  assert(nativeCornerTailPixelsGrid>4,'the grid must display original opaque corner-tail pixels below the old horizontal cut');
  assert(nativeCornerTailPixelsCurve>4,'the curve side must retain the same complete native corner tail');
  assert(collarSamples>10);assert.equal(backgroundLeaks,0,'native-alpha overlapped pieces must not leave background cracks at the inner collar');
  await page.close();await beforePage.close();assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.deepEqual(external,[]);
  assert(edgeRequests.length>=8);assert(edgeRequests.every(request=>request.status===200));assert.deepEqual(stages.map(stage=>stage.coveredCells),[56,64,62]);
  if(process.env.SCENE_KIT_SCREENSHOTS)writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,'junction-browser-evidence.json'),jsonBytes({
    format:'ai_scene_native_junction_browser_evidence_v1',synthetic:true,softwareWebGL:true,BrowserAvailability:'absent',playwrightReason:'Browser plugin not available',
    actualUiBrush:true,undoRedoExact:true,reloadExact:true,browserZipEqualsCompiler:true,pageClosedBeforeConsoleHealthCheck:true,
    sourcePngUnchanged:true,sourceAlphaFixture:255,stages,changedGridPixels,changedCurvePixels,changedGridRepeatPixels,changedCurveRepeatPixels,
    nativeCornerTailPixelsGrid,nativeCornerTailPixelsCurve,collarSamples,backgroundLeaks,
    beforeScreenshotSha256:before.sha256,fixedScreenshotSha256:fixed.sha256,zipSha256:hash(zip),errors,warnings,externalRequests:external,generationCalls:0}));
});
