import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {setupTerrainEdgeDelivery} from '../helpers/terrain-edge-delivery.mjs';
import {buildTerrainEdgeDelivery} from '../../src/terrain-edge-pipeline.mjs';
import {upgradeTerrainBrushKit} from '../../src/grid-terrain-upgrade.mjs';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {loadSceneKit,readMap} from '../../src/kit.mjs';
import {compileMap} from '../../src/compile.mjs';
import {exportSceneArchive} from '../../src/persistence.mjs';
import {inspectPng} from '../../src/png.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../../src/terrain-edges.mjs';
import {canonicalJson} from '../../src/document.mjs';
import {hash,jsonBytes} from '../../src/generation/common.mjs';
import {exerciseGridBrush} from './grid-terrain-edges-flow.mjs';
import {scenePixels} from './canvas-controls.mjs';

test('real brush, vertical extension and eraser render native grid edges, preserve open silhouette and persist exact exports',{timeout:300000},async t=>{
  const fixture=setupTerrainEdgeDelivery(t),controls=fixture.deliveryOptions.controls;controls.joinProfile=NEAR_OPAQUE_JOIN_PROFILE;
  for(const side of ['left','right'])for(const part of ['wall','corner']){
    const item=controls[side][part];item.inboardBlend={fromX:item.innerX,toX:side==='left'?276:12};
  }
  buildTerrainEdgeDelivery(fixture.deliveryOptions);
  const legacyRoot=join(fixture.deliveryOptions.output,'candidate/kit'),legacy=loadSceneKit(legacyRoot),document=readMap(legacy);
  document.terrainRuns=[];document.instances=[];document.assemblyInstances=[];document.curveTerrains=[];document.inspectionCases=[];
  document.bounds={x:0,y:0,width:20,height:12};
  const upgradeRoot=join(fixture.parent,'grid-upgrade');upgradeTerrainBrushKit({root:legacyRoot,document,output:upgradeRoot});
  const root=join(upgradeRoot,'kit'),handle=loadSceneKit(root),initialDocument=JSON.parse(readFileSync(join(upgradeRoot,'export/scene.document.json'),'utf8'));
  assert.equal(compileMap(handle,initialDocument).terrainMaterial.edges.format,'ai_scene_terrain_edges_v4');
  const staticRoot=await buildStudio({output:join(fixture.parent,'brush-static')}),workspaceRoot=join(fixture.parent,'brush-workspace'),
    host=await startStudio({root,staticRoot,port:0,initialDocument,workspaceRoot,projectName:'Synthetic brush edge test'});t.after(()=>host.close());
  const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1680,height:1060},deviceScaleFactor:1,acceptDownloads:true}),errors=[],warnings=[],external=[],edgeRequests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
  page.on('response',response=>{if(response.url().includes('/_terrain-edge-'))edgeRequests.push({path:new URL(response.url()).pathname,status:response.status()});});
  await page.route('**/*',route=>new URL(route.request().url()).origin===host.url?route.continue():(external.push('blocked-external-origin'),route.abort()));
  await page.goto(host.url+'/editor');await page.waitForSelector('body[data-ready="true"]',{timeout:90000});
  assert.equal(page.url(),host.url+'/editor');assert.match(await page.title(),/Scene Kit Studio/);
  assert(await page.locator('#palette button').count()>0);assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);
  const stages=[],pixelsEvidence=[];
  const result=await exerciseGridBrush(page,{hostUrl:host.url,left:6,right:13,extensionLeft:9,extensionRight:12,onStage:async(name,state)=>{
    assert(state.scene.gridTerrains?.length>0,'UI-painted cells must enter the continuous grid renderer');
    const patches=state.scene.gridTerrains,covered=patches.flatMap(patch=>patch.source.gridCells),meshes=patches.flatMap(patch=>patch.edgeMeshes??[]);
    assert.equal(patches.length,1,'one connected brush solid must not become one isolated appearance mesh per tile');
    assert(covered.length>0);assert(meshes.some(mesh=>mesh.side==='left'&&mesh.part==='wall'));
    assert(meshes.some(mesh=>mesh.side==='right'&&mesh.part==='wall'));assert(meshes.some(mesh=>mesh.part==='corner'));
    assert(patches.every(patch=>patch.body.positions.length&&Array.isArray(patch.cap.positions)));assert(patches.some(patch=>patch.cap.positions.length>0));
    await page.mouse.move(1000,45);const bytes=await scenePixels(page),image=inspectPng(bytes,{includePixels:true}),counts=new Map();
    for(let p=0;p<image.rgba.length;p+=4){const key=[...image.rgba.subarray(p,p+3)].join(',');counts.set(key,(counts.get(key)??0)+1);}
    for(const color of ['140,75,35','160,75,35','140,90,35','160,90,35'])assert((counts.get(color)??0)>8,`${name}: native ${color} must reach actual software WebGL`);
    if(name==='01-rectangle'){
      assert.deepEqual(patches[0].surfaceSpans,[{from:{x:6*64,y:3*64},to:{x:14*64,y:3*64}}],
        'only the exposed top is a surface strip; internal row joins must not get extra caps');
      const visible=await page.locator('#minimap rect').last().evaluate(element=>({x:+element.getAttribute('x'),y:+element.getAttribute('y'),width:+element.getAttribute('width'),height:+element.getAttribute('height')}));
      let backgroundInsideLogicalSide=0;
      for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
        const wx=visible.x+(x+.5)/image.width*visible.width,wy=visible.y+(y+.5)/image.height*visible.height;
        if(wy<3*64+50||wy>8*64-10||!((wx>6*64&&wx<6*64+2)||(wx<14*64&&wx>14*64-2)))continue;
        const p=(y*image.width+x)*4;if(image.rgba[p]===29&&image.rgba[p+1]===43&&image.rgba[p+2]===59)backgroundInsideLogicalSide++;
      }
      assert(backgroundInsideLogicalSide>2,'suppressed old grid tiles must not fill native-alpha recesses with a straight wall');
      pixelsEvidence.push({backgroundInsideLogicalSide});
    }
    stages.push({name,gridTerrains:patches.length,coveredCells:covered.length,edgeMeshes:meshes.length,pixelCounts:Object.fromEntries(['140,75,35','160,75,35','140,90,35','160,90,35'].map(color=>[color,counts.get(color)])),screenshotSha256:hash(bytes)});
    if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,'synthetic-'+name+'.png'),bytes);}
  }});
  const file=join(fixture.parent,'brush-export.zip');await result.download.saveAs(file);const zip=readFileSync(file),compiled=compileMap(handle,result.reloaded.document);
  assert.deepEqual(zip,exportSceneArchive(handle,result.reloaded.document));assert.equal(compiled.contentSha256,result.reloaded.scene.contentSha256);
  assert.deepEqual(stages.map(stage=>stage.coveredCells),[40,48,46]);assert.equal(new Set(edgeRequests.map(request=>request.path)).size,4);assert(edgeRequests.every(request=>request.status===200));
  const saved=JSON.parse(readFileSync(join(workspaceRoot,'workspace.json'),'utf8'));
  assert.equal(canonicalJson(saved.projects[0].maps[0].document),canonicalJson(result.reloaded.document));
  await page.close();
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.deepEqual(external,[]);
  if(process.env.SCENE_KIT_SCREENSHOTS)writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,'synthetic-grid-brush-evidence.json'),jsonBytes({
    format:'ai_scene_grid_brush_browser_evidence_v1',synthetic:true,actualUiBrush:true,softwareWebGL:true,BrowserAvailability:'absent',playwrightReason:'Browser plugin not available',
    stages,pixelsEvidence,undoRedoExact:true,reloadExact:true,browserZipEqualsCompiler:true,pageClosedBeforeConsoleHealthCheck:true,zipSha256:hash(zip),edgeRequests,errors,warnings,externalRequests:external,generationCalls:0}));
});
