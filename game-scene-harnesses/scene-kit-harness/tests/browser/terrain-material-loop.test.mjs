import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {setupTerrainEdgeDelivery} from '../helpers/terrain-edge-delivery.mjs';
import {buildTerrainEdgeDelivery} from '../../src/terrain-edge-pipeline.mjs';
import {upgradeTerrainMaterialLoopKit} from '../../src/terrain-material-loop-upgrade.mjs';
import {TERRAIN_UNION_MATERIAL_PROFILE} from '../../src/terrain-union-material.mjs';
import {TERRAIN_MATERIAL_LOOP_PROFILE} from '../../src/terrain-material-loop.mjs';
import {coherentSurfaceObservations} from '../helpers/coherent.mjs';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {loadSceneKit,readMap,contextFor} from '../../src/kit.mjs';
import {compileMap} from '../../src/compile.mjs';
import {exportSceneArchive} from '../../src/persistence.mjs';
import {inspectPng} from '../../src/png.mjs';
import {paintCoherentMesh} from '../../src/coherent-mesh-render.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../../src/terrain-edges.mjs';
import {hash,jsonBytes} from '../../src/generation/common.mjs';
import {exerciseGridBrush} from './grid-terrain-edges-flow.mjs';
import {scenePixels,dismissCanvasPanels,centerCanvasHorizontally} from './canvas-controls.mjs';

function sharedVertexSpan(scene){
  const positions=new Map();
  for(const patch of scene.gridTerrains??[])for(let i=0;i<patch.body.positions.length;i+=2){
    const key=patch.body.positions.slice(i,i+2).join(','),value=patch.body.uvs[i+1];
    if(!positions.has(key))positions.set(key,[]);positions.get(key).push(value);
  }
  let shared=0,maximum=0;
  for(const values of positions.values())if(values.length>1){shared++;maximum=Math.max(maximum,Math.max(...values)-Math.min(...values));}
  return {shared,maximum};
}

function bodyJacobian(scene){
  let triangles=0,maximumVerticalScaleError=0,maximumHorizontalScaleError=0,maximumHorizontalShear=0;
  const texture=scene.terrainMaterial.body.pixelSize;
  for(const patch of scene.gridTerrains??[]){const data=patch.body;
    for(let i=0;i<data.indices.length;i+=3){
      const [a,b,c]=data.indices.slice(i,i+3),ax=data.positions[a*2],ay=data.positions[a*2+1],
        bx=data.positions[b*2],by=data.positions[b*2+1],cx=data.positions[c*2],cy=data.positions[c*2+1],
        av=data.uvs[a*2+1],bv=data.uvs[b*2+1],cv=data.uvs[c*2+1],
        au=data.uvs[a*2],bu=data.uvs[b*2],cu=data.uvs[c*2],den=(bx-ax)*(cy-ay)-(cx-ax)*(by-ay);
      // Ignore subpixel slivers; final world UVs must be derived directly from
      // the final clipped positions rather than independently quantized.
      if(Math.abs(den)<8)continue;
      triangles++;const dvdy=((bx-ax)*(cv-av)-(cx-ax)*(bv-av))/den,
        dvdx=((bv-av)*(cy-ay)-(cv-av)*(by-ay))/den,
        dudx=((bu-au)*(cy-ay)-(cu-au)*(by-ay))/den,dudy=((bx-ax)*(cu-au)-(cx-ax)*(bu-au))/den;
      maximumVerticalScaleError=Math.max(maximumVerticalScaleError,Math.abs(dvdy*texture.height-506/256));
      maximumHorizontalScaleError=Math.max(maximumHorizontalScaleError,Math.abs(dudx*texture.width-1010/512));
      maximumHorizontalShear=Math.max(maximumHorizontalShear,Math.abs(dvdx),Math.abs(dudy));
    }
  }
  return {triangles,maximumVerticalScaleError,maximumHorizontalScaleError,maximumHorizontalShear};
}

test('source-pixel body loop reaches the actual tall UI brush without changing native rock density or source colors',{timeout:900000},async t=>{
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const f=setupTerrainEdgeDelivery(t,{surfaceObservations:observations}),controls=f.deliveryOptions.controls;controls.joinProfile=NEAR_OPAQUE_JOIN_PROFILE;
  controls.materialDensityProfile='reference-native-2x-v1';controls.gridProfile='grid-solid-union-native-v1';controls.junctions={};controls.materialProfile=TERRAIN_UNION_MATERIAL_PROFILE;
  for(const side of ['left','right'])for(const part of ['wall','corner']){
    const item=controls[side][part];item.inboardBlend={fromX:item.innerX,toX:side==='left'?276:12};
  }
  buildTerrainEdgeDelivery(f.deliveryOptions);
  const edgeRoot=join(f.deliveryOptions.output,'candidate/kit'),initial=readMap(loadSceneKit(edgeRoot));
  initial.terrainRuns=[];initial.instances=[];initial.assemblyInstances=[];initial.inspectionCases=[];
  initial.curveTerrains=[];initial.bounds={x:0,y:0,width:20,height:16};
  initial.defaultCamera={center:{x:640,y:512},viewport:{width:1280,height:1024},scale:1};
  const legacyRoot=edgeRoot,legacyHandle=loadSceneKit(legacyRoot),legacyDocument=initial,
    fixedRoot=join(f.parent,'loop-upgrade'),receipt=upgradeTerrainMaterialLoopKit({root:legacyRoot,document:legacyDocument,output:fixedRoot,
      loopOptions:{usableRows:384,overlapRows:96,phaseCount:3}}),
    root=join(fixedRoot,'kit'),handle=loadSceneKit(root),fixedDocument=JSON.parse(readFileSync(join(fixedRoot,'export/scene.document.json'),'utf8'));
  assert.equal(receipt.allOriginalPngBytesPreserved,true);
  const oldFiles=contextFor(legacyHandle).files,newFiles=contextFor(handle).files;
  for(const [path,bytes]of oldFiles)if(path.endsWith('.png'))assert.deepEqual(newFiles.get(path),bytes,path);
  assert.equal([...newFiles.keys()].filter(path=>path.endsWith('.png')).length,[...oldFiles.keys()].filter(path=>path.endsWith('.png')).length+1);
  const staticRoot=await buildStudio({output:join(f.parent,'loop-static')}),host=await startStudio({root,staticRoot,port:0,
    initialDocument:fixedDocument,workspaceRoot:join(f.parent,'fixed-workspace'),projectName:'Synthetic tall terrain body loop test'});t.after(()=>host.close());
  const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});t.after(()=>browser.close());
  const errors=[],warnings=[],external=[];
  async function open(url){
    const page=await browser.newPage({viewport:{width:1680,height:1060},deviceScaleFactor:1,acceptDownloads:true});
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
    await page.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():(external.push('blocked-external-origin'),route.abort()));
    await page.goto(url+'/editor');await page.waitForSelector('body[data-ready="true"]',{timeout:90000});
    assert.equal(page.url(),url+'/editor');assert.match(await page.title(),/Scene Kit Studio/);assert(await page.locator('#palette button').count()>0);
    assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);return page;
  }
  async function pixels(page,name){
    await dismissCanvasPanels(page);await page.locator('#grid').uncheck();await page.locator('[data-tool="select"]').click();await page.locator('#fit').click();
    await centerCanvasHorizontally(page,640);for(let i=0;i<4;i++)await page.locator('#zoom-in').click();
    await page.mouse.move(900,45);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const bytes=await scenePixels(page),image=inspectPng(bytes,{includePixels:true}),camera=await page.locator('#minimap rect').last().evaluate(e=>
      ({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height')}));
    if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,name+'.png'),bytes);}
    return {image,camera,sha256:hash(bytes)};
  }
  const page=await open(host.url),stages=[];
  const result=await exerciseGridBrush(page,{hostUrl:host.url,left:6,right:13,top:3,bottom:12,extensionLeft:9,extensionRight:12,onStage:async(name,state)=>{
    assert.equal(state.scene.terrainMaterial.edges.format,'ai_scene_terrain_edges_v6');
    assert.equal(state.scene.terrainMaterial.edges.materialProfile,'union-world-body-local-surface-v1');
    assert.equal(state.scene.terrainMaterial.format,'ai_scene_continuous_terrain_appearance_v7');
    assert.equal(state.scene.terrainMaterial.bodyLoopProfile,TERRAIN_MATERIAL_LOOP_PROFILE);
    assert.equal(state.scene.terrainMaterial.body.pixelSize.height,864);
    const continuity=sharedVertexSpan(state.scene);assert(continuity.shared>20);assert(continuity.maximum<1e-10,'one world coordinate must use one material V across old and raised columns');
    const jacobian=bodyJacobian(state.scene);assert(jacobian.triangles>20);
    assert(jacobian.maximumVerticalScaleError<1e-10,'visible body triangles must retain native vertical scale: '+JSON.stringify(jacobian));
    assert(jacobian.maximumHorizontalScaleError<1e-10,'visible body triangles must retain native horizontal scale: '+JSON.stringify(jacobian));
    assert(jacobian.maximumHorizontalShear<1e-10,'world material must not shear rock details across the raised step: '+JSON.stringify(jacobian));
    stages.push({name,authorSha256:state.scene.source.authorSha256,compiledSha256:state.scene.contentSha256,
      coveredCells:state.scene.gridTerrains.reduce((n,p)=>n+p.source.gridCells.length,0),sharedVertexContinuity:continuity,bodyJacobian:jacobian});
  }});
  const zipFile=join(f.parent,'browser-material-loop.zip');await result.download.saveAs(zipFile);const zip=readFileSync(zipFile);
  assert.deepEqual(zip,exportSceneArchive(handle,result.reloaded.document));assert.equal(compileMap(handle,result.reloaded.document).contentSha256,result.reloaded.scene.contentSha256);
  const fixed=await pixels(page,'material-loop-after'),legacyFinal=structuredClone(result.reloaded.document);legacyFinal.kitRef=legacyDocument.kitRef;
  const legacyScene=compileMap(legacyHandle,legacyFinal),legacyContinuity=sharedVertexSpan(legacyScene);assert(legacyContinuity.maximum<1e-10,'the previous v6 world-coordinate fix must remain independently valid');
  const beforeHost=await startStudio({root:legacyRoot,staticRoot,port:0,initialDocument:legacyFinal,
    workspaceRoot:join(f.parent,'legacy-workspace'),projectName:'Synthetic original repeat body comparison'});t.after(()=>beforeHost.close());
  const beforePage=await open(beforeHost.url),before=await pixels(beforePage,'material-loop-before');assert.deepEqual(fixed.camera,before.camera);
  assert.equal(fixed.image.width,before.image.width);assert.equal(fixed.image.height,before.image.height);
  const texture=inspectPng(contextFor(handle).files.get(result.reloaded.scene.terrainMaterial.body.source.path),{includePixels:true}),
    expected=Buffer.alloc(fixed.image.width*fixed.image.height*4),sx=fixed.image.width/fixed.camera.width,sy=fixed.image.height/fixed.camera.height;
  for(const patch of result.reloaded.scene.gridTerrains){
    const data={...patch.body,positions:patch.body.positions.map((value,index)=>(value-(index%2?fixed.camera.y:fixed.camera.x))*(index%2?sy:sx))};
    paintCoherentMesh(expected,{width:fixed.image.width,height:fixed.image.height},data,texture);
  }
  let samples=0,changedNearSharedEdge=0,maximumOriginalColorError=0;
  for(let y=0;y<fixed.image.height;y++)for(let x=0;x<fixed.image.width;x++){
    const wx=fixed.camera.x+(x+.5)/sx,wy=fixed.camera.y+(y+.5)/sy,p=(y*fixed.image.width+x)*4;
    if(wx<565||wx>588||wy<260||wy>445)continue;
    if(Math.max(...[0,1,2].map(c=>Math.abs(fixed.image.rgba[p+c]-before.image.rgba[p+c])))>5)changedNearSharedEdge++;
    if(x%3===0&&y%3===0){samples++;maximumOriginalColorError=Math.max(maximumOriginalColorError,...[0,1,2].map(c=>Math.abs(fixed.image.rgba[p+c]-expected[p+c])));}
  }
  assert(samples>100,'actual WebGL must display the body on both sides below the raised step');
  assert(changedNearSharedEdge>100,'the new loop must change visible body pixels under the raised step instead of staying unused in the asset package');
  assert(maximumOriginalColorError<=6,'actual WebGL must sample original source color, without tint or blurred seam overlay');
  await page.close();await beforePage.close();assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.deepEqual(external,[]);
  assert.deepEqual(stages.map(stage=>stage.coveredCells),[80,88,86]);
  if(process.env.SCENE_KIT_SCREENSHOTS)writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,'material-loop-browser-evidence.json'),jsonBytes({
    format:'ai_scene_material_loop_browser_evidence_v1',synthetic:true,softwareWebGL:true,BrowserAvailability:'absent',playwrightReason:'Browser plugin not available',
    actualUiBrush:true,undoRedoExact:true,reloadExact:true,browserZipEqualsCompiler:true,pageClosedBeforeConsoleHealthCheck:true,
    originalPngsUnchanged:true,addedDerivedPngFiles:1,materialProfile:TERRAIN_MATERIAL_LOOP_PROFILE,stages,legacyContinuity,samples,changedNearSharedEdge,maximumOriginalColorError,
    beforeScreenshotSha256:before.sha256,fixedScreenshotSha256:fixed.sha256,zipSha256:hash(zip),errors,warnings,externalRequests:external,generationCalls:0}));
});
