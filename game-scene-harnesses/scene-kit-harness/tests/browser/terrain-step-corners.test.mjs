import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {setupTerrainEdgeDelivery} from '../helpers/terrain-edge-delivery.mjs';
import {buildTerrainEdgeDelivery} from '../../src/terrain-edge-pipeline.mjs';
import {upgradeTerrainStepCornerKit} from '../../src/terrain-step-corner-upgrade.mjs';
import {TERRAIN_UNION_MATERIAL_PROFILE} from '../../src/terrain-union-material.mjs';
import {coherentSurfaceObservations} from '../helpers/coherent.mjs';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {loadSceneKit,readMap,contextFor} from '../../src/kit.mjs';
import {compileMap} from '../../src/compile.mjs';
import {exportSceneArchive} from '../../src/persistence.mjs';
import {inspectPng} from '../../src/png.mjs';
import {paintCoherentMesh} from '../../src/coherent-mesh-render.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../../src/terrain-edges.mjs';
import {canonicalJson} from '../../src/document.mjs';
import {hash,jsonBytes} from '../../src/generation/common.mjs';
import {scenePixels,dismissCanvasPanels} from './canvas-controls.mjs';

function jacobian(scene){
  let triangles=0,maximumVerticalScaleError=0,maximumHorizontalScaleError=0,maximumShear=0;
  const texture=scene.terrainMaterial.body.pixelSize;
  for(const owner of scene.gridTerrains??[])for(let i=0;i<owner.body.indices.length;i+=3){const m=owner.body,
    [a,b,c]=m.indices.slice(i,i+3),ax=m.positions[a*2],ay=m.positions[a*2+1],bx=m.positions[b*2],by=m.positions[b*2+1],cx=m.positions[c*2],cy=m.positions[c*2+1],
    av=m.uvs[a*2+1],bv=m.uvs[b*2+1],cv=m.uvs[c*2+1],au=m.uvs[a*2],bu=m.uvs[b*2],cu=m.uvs[c*2],den=(bx-ax)*(cy-ay)-(cx-ax)*(by-ay);
    if(Math.abs(den)<8)continue;triangles++;
    const dvdy=((bx-ax)*(cv-av)-(cx-ax)*(bv-av))/den,dvdx=((bv-av)*(cy-ay)-(cv-av)*(by-ay))/den,
      dudx=((bu-au)*(cy-ay)-(cu-au)*(by-ay))/den,dudy=((bx-ax)*(cu-au)-(cx-ax)*(bu-au))/den;
    maximumVerticalScaleError=Math.max(maximumVerticalScaleError,Math.abs(dvdy*texture.height-506/256));
    maximumHorizontalScaleError=Math.max(maximumHorizontalScaleError,Math.abs(dudx*texture.width-1010/512));maximumShear=Math.max(maximumShear,Math.abs(dvdx),Math.abs(dudy));
  }return {triangles,maximumVerticalScaleError,maximumHorizontalScaleError,maximumShear};
}

test('actual UI brush rounds both concave step directions with original surface pixels and preserves author collision',{timeout:900000},async t=>{
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const f=setupTerrainEdgeDelivery(t,{surfaceObservations:observations}),controls=f.deliveryOptions.controls;
  Object.assign(controls,{joinProfile:NEAR_OPAQUE_JOIN_PROFILE,materialDensityProfile:'reference-native-2x-v1',gridProfile:'grid-solid-union-native-v1',junctions:{},materialProfile:TERRAIN_UNION_MATERIAL_PROFILE});
  for(const side of ['left','right'])for(const part of ['wall','corner']){const item=controls[side][part];item.inboardBlend={fromX:item.innerX,toX:side==='left'?276:12};}
  buildTerrainEdgeDelivery(f.deliveryOptions);
  const legacyRoot=join(f.deliveryOptions.output,'candidate/kit'),legacyHandle=loadSceneKit(legacyRoot),initial=readMap(legacyHandle);
  Object.assign(initial,{terrainRuns:[],instances:[],assemblyInstances:[],inspectionCases:[],curveTerrains:[],bounds:{x:0,y:0,width:22,height:12},
    defaultCamera:{center:{x:704,y:384},viewport:{width:1408,height:768},scale:1}});
  const output=join(f.parent,'step-corner-upgrade'),receipt=upgradeTerrainStepCornerKit({root:legacyRoot,document:initial,output,cornerOptions:{widthWorld:32,heightWorld:12}}),
    root=join(output,'kit'),handle=loadSceneKit(root),document=JSON.parse(readFileSync(join(output,'export/scene.document.json'),'utf8')),
    oldFiles=contextFor(legacyHandle).files,newFiles=contextFor(handle).files;
  assert(receipt.allOriginalPngBytesPreserved);assert.equal(receipt.addedPngFiles,0);
  for(const [path,bytes]of oldFiles)if(path.endsWith('.png'))assert.deepEqual(newFiles.get(path),bytes,path);
  assert.equal([...newFiles.keys()].filter(p=>p.endsWith('.png')).length,[...oldFiles.keys()].filter(p=>p.endsWith('.png')).length);
  const staticRoot=await buildStudio({output:join(f.parent,'step-corner-static')}),host=await startStudio({root,staticRoot,port:0,initialDocument:document,
    workspaceRoot:join(f.parent,'step-corner-workspace'),projectName:'Synthetic concave terrain corner test'});t.after(()=>host.close());
  const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});t.after(()=>browser.close());
  const errors=[],warnings=[],external=[],stages=[];
  async function open(url){const page=await browser.newPage({viewport:{width:1680,height:1060},deviceScaleFactor:1,acceptDownloads:true});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
    await page.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():(external.push('blocked-external-origin'),route.abort()));
    await page.goto(url+'/editor');await page.waitForSelector('body[data-ready="true"]',{timeout:90000});assert.equal(page.url(),url+'/editor');assert.match(await page.title(),/Scene Kit Studio/);
    assert(await page.locator('#palette button').count()>0);assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);return page;}
  const page=await open(host.url),snapshot=()=>page.evaluate(async()=>await(await fetch('/api/state')).json()),settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))),
    visible=()=>page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height')}));
  await dismissCanvasPanels(page);await page.locator('#grid').uncheck();await page.locator('#fit').click();await page.locator('#tab-terrain').click();await page.getByRole('button',{name:'地形画刷',exact:true}).click();
  async function stroke(x1,y1,x2=x1,y2=y1){const before=await snapshot(),v=await visible(),box=await page.locator('canvas').boundingBox(),point=(x,y)=>({x:box.x+((x+.5)*64-v.x)/v.width*box.width,y:box.y+((y+.5)*64-v.y)/v.height*box.height}),a=point(x1,y1),b=point(x2,y2);
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:Math.max(6,4*Math.max(Math.abs(x2-x1),Math.abs(y2-y1)))});await page.mouse.up();
    await page.waitForFunction(rev=>Number(document.body.dataset.revision)>rev,before.revision);await page.waitForFunction(()=>!document.querySelector('[data-tool="paint"]').disabled);await settle();return snapshot();}
  const plain=doc=>{const {kitRef,...v}=doc;return v;};
  async function stage(name,state,count){assert.equal(state.scene.counts.terrainNodes,count);const legacy=compileMap(legacyHandle,{...state.document,kitRef:initial.kitRef});
    assert.deepEqual(state.scene.collisionSuggestions,legacy.collisionSuggestions,'appearance must not change original author collision');
    const bodyJacobian=jacobian(state.scene);assert(bodyJacobian.triangles>10);assert(bodyJacobian.maximumVerticalScaleError<1e-10);assert(bodyJacobian.maximumHorizontalScaleError<1e-10);assert(bodyJacobian.maximumShear<1e-10);
    stages.push({name,cells:count,authorSha256:state.scene.source.authorSha256,compiledSha256:state.scene.contentSha256,bodyJacobian});}
  for(let y=5;y<=8;y++)await stroke(6,y,17,y);const rectangle=await snapshot();await stage('base',rectangle,48);
  await stroke(10,4,13,4);const one=await snapshot();await stage('one-step',one,52);
  await stroke(11,3,12,3);const raised=await snapshot();await stage('two-step',raised,54);
  await page.locator('[data-tool="erase"]').click();await stroke(11,3);const erased=await snapshot();await stage('erased',erased,53);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(rev=>Number(document.body.dataset.revision)>rev,erased.revision);const undone=await snapshot();assert.deepEqual(undone.document,raised.document);
  await page.getByRole('button',{name:'重做',exact:true}).click();await page.waitForFunction(rev=>Number(document.body.dataset.revision)>rev,undone.revision);assert.deepEqual((await snapshot()).document,erased.document);
  await page.reload();await page.waitForSelector('body[data-ready="true"]',{timeout:90000});const reloaded=await snapshot();assert.deepEqual(reloaded.document,erased.document);
  const wait=page.waitForEvent('download',{timeout:90000});await page.locator('#download-menu>summary').click();await page.locator('#export-pack').click();const download=await wait,zipPath=join(f.parent,'step-corner-browser.zip');await download.saveAs(zipPath);const zip=readFileSync(zipPath);
  assert.deepEqual(zip,exportSceneArchive(handle,reloaded.document));assert.equal(compileMap(handle,reloaded.document).contentSha256,reloaded.scene.contentSha256);
  async function pixels(p,name){await dismissCanvasPanels(p);await p.locator('#grid').uncheck();await p.locator('[data-tool="select"]').click();await p.locator('#fit').click();for(let i=0;i<3;i++)await p.locator('#zoom-in').click();
    await p.mouse.move(900,45);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const bytes=await scenePixels(p),image=inspectPng(bytes,{includePixels:true}),camera=await p.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height')}));
    if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,name+'.png'),bytes);}return {image,camera,sha256:hash(bytes)};}
  const fixed=await pixels(page,'step-corner-after'),legacyDocument={...reloaded.document,kitRef:initial.kitRef},legacyScene=compileMap(legacyHandle,legacyDocument),
    beforeHost=await startStudio({root:legacyRoot,staticRoot,port:0,initialDocument:legacyDocument,workspaceRoot:join(f.parent,'step-corner-before'),projectName:'Synthetic original concave steps'});t.after(()=>beforeHost.close());
  const beforePage=await open(beforeHost.url),before=await pixels(beforePage,'step-corner-before');assert.deepEqual(fixed.camera,before.camera);assert.deepEqual(plain(reloaded.document),plain(legacyDocument));
  const W=fixed.image.width,H=fixed.image.height,sx=W/fixed.camera.width,sy=H/fixed.camera.height,expected=Buffer.alloc(W*H*4),owners=[...(reloaded.scene.gridTerrains??[]),...(reloaded.scene.curveTerrains??[])],cache=new Map(),material=reloaded.scene.terrainMaterial;
  for(let p=0;p<expected.length;p+=4)expected.set([29,43,59,255],p);
  const texture=source=>{if(!cache.has(source.sha256))cache.set(source.sha256,inspectPng(newFiles.get(source.path),{includePixels:true}));return cache.get(source.sha256);},
    paint=(data,source,cap=false)=>paintCoherentMesh(expected,{width:W,height:H},{...data,positions:data.positions.map((v,i)=>(v-(i%2?fixed.camera.y:fixed.camera.x))*(i%2?sy:sx))},texture(source),{cap,clampU:!!data.materialKey,clampV:cap||!!data.materialKey,opacity:data.coverageOpacity??1,topLeftRule:true});
  for(const owner of owners){paint(owner.body,material.body.source);for(const band of owner.capBands??[owner.cap])paint(band,material.cap.source,true);for(const edge of owner.edgeMeshes??[])paint(edge,edge.source);}
  for(const owner of owners)for(const corner of owner.cornerMeshes??[])paint(corner,material[corner.materialKind].source,corner.materialKind==='cap');
  let samples=0,changedCornerPixels=0,maximumOriginalColorError=0,leftChanged=0,rightChanged=0,leftWallOverlapChanged=0,rightWallOverlapChanged=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const wx=fixed.camera.x+(x+.5)/sx,wy=fixed.camera.y+(y+.5)/sy,p=(y*W+x)*4,
    left=wx>=610&&wx<640&&wy>=306&&wy<320,right=wx>896&&wx<=926&&wy>=306&&wy<320,
    leftWall=wx>=640&&wx<648&&wy>=308&&wy<320,rightWall=wx>888&&wx<=896&&wy>=308&&wy<320;if(!left&&!right&&!leftWall&&!rightWall)continue;
    if(Math.max(...[0,1,2].map(c=>Math.abs(fixed.image.rgba[p+c]-before.image.rgba[p+c])))>5){changedCornerPixels++;if(left)leftChanged++;if(right)rightChanged++;if(leftWall)leftWallOverlapChanged++;if(rightWall)rightWallOverlapChanged++;}
    if(x%2===0&&y%2===0){samples++;maximumOriginalColorError=Math.max(maximumOriginalColorError,...[0,1,2].map(c=>Math.abs(fixed.image.rgba[p+c]-expected[p+c])));}
  }
  assert(samples>50,'actual pixels must cover new concave transition paint');assert(leftChanged>20&&rightChanged>20,'both inner corner directions must show the transition in actual WebGL');
  assert(leftWallOverlapChanged>10&&rightWallOverlapChanged>10,'surface paint must continue into real wall support so the raised cap cannot end with the old straight dark strip');
  assert(maximumOriginalColorError<=6,'actual new corner pixels must match original source material through the CPU/Pixi contract');
  assert(owners.some(owner=>(owner.cornerMeshes??[]).length>0));assert(!legacyScene.gridTerrains.some(owner=>(owner.cornerMeshes??[]).length));
  await page.close();await beforePage.close();assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.deepEqual(external,[]);
  if(process.env.SCENE_KIT_SCREENSHOTS)writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS,'step-corner-browser-evidence.json'),jsonBytes({format:'ai_scene_step_corner_browser_evidence_v1',
    synthetic:true,softwareWebGL:true,BrowserAvailability:'absent',playwrightReason:'Browser plugin not available',actualUiBrush:true,stages,sourcePngsUnchanged:true,addedPngFiles:0,
    authorGeometryChanged:false,collisionChanged:false,samples,changedCornerPixels,leftChanged,rightChanged,leftWallOverlapChanged,rightWallOverlapChanged,maximumOriginalColorError,
    profile:'concave-source-surface-ramp-v1',undoRedoExact:true,reloadExact:true,browserZipEqualsCompiler:true,pageClosedBeforeConsoleHealthCheck:true,
    beforeScreenshotSha256:before.sha256,fixedScreenshotSha256:fixed.sha256,zipSha256:hash(zip),errors,warnings,externalRequests:external,generationCalls:0}));
});
