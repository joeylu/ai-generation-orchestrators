import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {dependency} from '../../scripts/studio-build.mjs';
import {compileTerrainStepCorners} from '../../src/terrain-step-corners.mjs';
import {buildTerrainStepSurface,TERRAIN_STEP_LINEAR_SURFACE_PROFILE} from '../../src/terrain-step-surface.mjs';
import {encodeRgbaPng,inspectPng} from '../../src/png.mjs';
import {hash} from '../../src/generation/common.mjs';
import {paintCoherentMesh} from '../../src/coherent-mesh-render.mjs';
import {stepSurfaceFixture,rebindStepSurfaceFixture} from '../helpers/terrain-step-surface.mjs';
import {openDiagnosticViewer,drawDiagnostic} from '../helpers/pixi-diagnostic-viewer.mjs';

test('software Pixi draws continuous native-alpha fade in both directions and restores legacy pixels after disposal',{timeout:120000},async t=>{
  const tempRoot=process.env.SCENE_KIT_BROWSER_TEMP_ROOT??tmpdir();mkdirSync(tempRoot,{recursive:true});const root=mkdtempSync(join(tempRoot,'step-linear-')),
    f=stepSurfaceFixture({adaptive:false}),rgba=Buffer.from(Array.from({length:128*72},(_,i)=>[(i%128)*2,Math.floor(i/128)*3,210,128]).flat()),png=encodeRgbaPng(128,72,rgba),
    cap={path:'cap.png',sha256:hash(png),byteLength:png.length},bodyPng=encodeRgbaPng(2,2,Buffer.from(new Array(4).fill([50,60,70,255]).flat())),body={path:'body.png',sha256:hash(bodyPng),byteLength:bodyPng.length},
    files=new Map([['cap.png',png],['body.png',bodyPng]]);
  f.appearance.cap.source=cap;f.surfaceInterface.capSourceSha256=cap.sha256;rebindStepSurfaceFixture(f);
  const old=compileTerrainStepCorners(f);f.surfaceBinding=buildTerrainStepSurface({appearance:f.appearance,surfaceInterface:f.surfaceInterface,stepCorners:f.profile,profile:TERRAIN_STEP_LINEAR_SURFACE_PROFILE});
  const fresh=compileTerrainStepCorners(f),camera={width:640,height:512,center:{x:320,y:256},scale:1,alphaMask:true},
    make=(result,linear)=>({format:linear?'ai_scene_compiled_v8':'ai_scene_compiled_v7',source:{authorSha256:'b'.repeat(64)},contentSha256:'a'.repeat(64),
      defaultCamera:{center:camera.center,viewport:{width:640,height:512},scale:1},layers:[{layerId:'terrain',visible:true,parallax:{x:1,y:1},nodes:[]}],
      terrainMaterial:{body:{source:body},cap:{source:cap},...(linear?{stepSurface:f.surfaceBinding}:{})},
      gridTerrains:result.gridTerrains.map(p=>({...p,body:{positions:[],uvs:[],indices:[]},cornerMeshes:p.cornerMeshes.filter(m=>m.materialKind==='cap')})),curveTerrains:[],mixedTerrains:[]}),
    oldScene=make(old,false),newScene=make(fresh,true),{chromium}=dependency('playwright').require('playwright'),
    browser=await chromium.launchPersistentContext(join(root,'profile'),{headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  t.after(async()=>{await browser.close();rmSync(root,{recursive:true,force:true});});const page=await browser.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('data:')?r.continue():(external.push(r.request().url()),r.abort()));await openDiagnosticViewer(page);
  const first=await drawDiagnostic(page,oldScene,files,camera),image=inspectPng((await drawDiagnostic(page,newScene,files,camera)).png,{includePixels:true});
  for(let dx=0;dx<8;dx++)for(const x of [192+dx,383-dx]){
    const expected=Math.round(255-128*(1-(dx+.5)/8));for(let c=0;c<3;c++)assert(Math.abs(image.rgba[(118*640+x)*4+c]-expected)<=1,'fade must interpolate the endpoint opacity rather than repeat a column mean');
  }
  const shifted=inspectPng((await drawDiagnostic(page,newScene,files,{...camera,center:{x:320.25,y:256.2}})).png,{includePixels:true}),rowOpacity=1-8.5/24;
  for(let dx=0;dx<8;dx++)for(const [x,distance]of [[192+dx,dx+.75],[383-dx,dx+.25]]){
    const expected=Math.round(255-128*rowOpacity*(1-distance/8));
    for(let c=0;c<3;c++)assert(Math.abs(shifted.rgba[(122*640+x)*4+c]-expected)<=1,'camera movement must preserve world fade and native row coverage');
  }
  const colored=inspectPng((await drawDiagnostic(page,newScene,files,{...camera,alphaMask:false})).png,{includePixels:true}),expectedPixels=Buffer.alloc(640*512*4),texture=inspectPng(png,{includePixels:true});
  for(let i=0;i<expectedPixels.length;i+=4)expectedPixels.set([29,43,59,255],i);
  for(const m of newScene.gridTerrains[0].cornerMeshes)paintCoherentMesh(expectedPixels,{width:640,height:512},m,texture,{cap:true,opacity:m.coverageOpacity??1,topLeftRule:true});
  for(let dx=0;dx<8;dx++)for(const x of [192+dx,383-dx])for(let c=0;c<3;c++)
    assert(Math.abs(colored.rgba[(118*640+x)*4+c]-expectedPixels[(118*640+x)*4+c])<=1,'native repeated UVs and premultiplied RGB must match CPU sampling');
  await assert.rejects(()=>drawDiagnostic(page,{...newScene,format:'ai_scene_compiled_v7'},files,camera),/Unsupported vertex coverage contract/);
  const restored=await drawDiagnostic(page,oldScene,files,camera);assert.deepEqual(restored.png,first.png);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
