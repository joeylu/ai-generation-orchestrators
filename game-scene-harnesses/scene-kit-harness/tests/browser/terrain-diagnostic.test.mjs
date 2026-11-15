import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {dependency} from '../../scripts/studio-build.mjs';
import {createTerrainRenderDiagnostic,TERRAIN_RENDER_DIAGNOSTIC_GROUPS as all} from '../../src/terrain-render-diagnostic.mjs';
import {encodeRgbaPng,inspectPng} from '../../src/png.mjs';
import {hash} from '../../src/generation/common.mjs';
import {openDiagnosticViewer,drawDiagnostic} from '../helpers/pixi-diagnostic-viewer.mjs';

test('production Pixi consumer displays explicit diagnostic groups without exporting or duplicating the supported cap',{timeout:120000},async t=>{
  const tempRoot=process.env.SCENE_KIT_BROWSER_TEMP_ROOT??tmpdir();mkdirSync(tempRoot,{recursive:true});
  const root=mkdtempSync(join(tempRoot,'terrain-diagnostic-'));
  const files=new Map(),source=(path,color)=>{const png=encodeRgbaPng(2,2,Buffer.from(Array(4).fill(color).flat()));files.set(path,png);return {path,sha256:hash(png),byteLength:png.length};},
    body=source('body.png',[90,60,40,255]),cap=source('cap.png',[230,240,250,255]),rock=source('edge.png',[150,120,90,255]),
    quad=(x,y,w,h)=>({positions:[x,y,x+w,y,x+w,y+h,x,y+h],uvs:[0,0,1,0,1,1,0,1],indices:[0,1,2,0,2,3]}),
    patch={gridTerrainId:'test',layerId:'ground',source:{gridCells:[]},body:quad(4,4,24,20),cap:quad(4,4,24,8),
      capBands:[{...quad(4,4,24,8),coverageOpacity:.5}],topCoverBands:[{...quad(4,4,24,8),coverageOpacity:.5}],
      nativeTopCornerMeshes:[{...quad(4,3,6,10),source:cap,materialKey:'left.corner',coverageOpacity:.75}],
      edgeMeshes:[{...quad(4,12,4,12),source:rock,materialKey:'left.wall'},{...quad(8,20,16,4),source:rock,materialKey:'bottom.edge'}],cornerMeshes:[],fieldBoundaryBands:[]},
    scene={format:'ai_scene_compiled_v7',contentSha256:'a'.repeat(64),source:{authorSha256:'b'.repeat(64)},
      defaultCamera:{center:{x:16,y:16},viewport:{width:32,height:32},scale:1},layers:[{layerId:'ground',visible:true,parallax:{x:1,y:1},nodes:[]}],
      terrainMaterial:{body:{source:body},cap:{source:cap},edges:{left:{wall:{source:rock},corner:{source:cap}},right:{wall:{source:rock},corner:{source:cap}}},bottomEdges:{edge:{source:rock},leftCorner:{source:rock},rightCorner:{source:rock}}},
      gridTerrains:[patch],curveTerrains:[],mixedTerrains:[]},before=structuredClone(scene),camera={width:32,height:32,center:{x:16,y:16},scale:1};
  const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launchPersistentContext(join(root,'profile'),{headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  t.after(async()=>{await browser.close();rmSync(root,{recursive:true,force:true});});
  const page=await browser.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('data:')?r.continue():(external.push(r.request().url()),r.abort()));
  await openDiagnosticViewer(page);
  const initial=await drawDiagnostic(page,scene,files,camera),complete=createTerrainRenderDiagnostic(scene,{groups:all}),same=await drawDiagnostic(page,complete.scene,files,camera);
  assert.deepEqual(same.png,initial.png);assert.equal(same.result.format,'ai_scene_terrain_render_diagnostic_frame_v1');assert.equal(same.result.contentSha256,null);
  const surface=await drawDiagnostic(page,createTerrainRenderDiagnostic(scene,{groups:['surface']}).scene,files,camera),pixels=inspectPng(surface.png,{includePixels:true}),offset=(6*32+16)*4;
  for(const [i,value]of [130,142,155].entries())assert(Math.abs(pixels.rgba[offset+i]-value)<=1,'supported cap must draw once');
  const mask=await drawDiagnostic(page,createTerrainRenderDiagnostic(scene,{groups:['surface']}).scene,files,{...camera,alphaMask:true}),m=inspectPng(mask.png,{includePixels:true});
  assert.equal(mask.result.mode,'native-alpha-black-on-white-display-only');
  for(let c=0;c<3;c++)assert(Math.abs(m.rgba[offset+c]-128)<=1,'display-only neutral mask must retain the original half coverage');
  const bodyOnly=await drawDiagnostic(page,createTerrainRenderDiagnostic(scene,{groups:['body']}).scene,files,camera),b=inspectPng(bodyOnly.png,{includePixels:true});
  assert.deepEqual([...b.rgba.subarray(offset,offset+3)],[90,60,40]);assert.deepEqual(scene,before);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
