import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {dependency} from '../../scripts/studio-build.mjs';
import {compileTerrainStepCorners} from '../../src/terrain-step-corners.mjs';
import {encodeRgbaPng,inspectPng} from '../../src/png.mjs';
import {hash} from '../../src/generation/common.mjs';
import {stepSurfaceFixture,rebindStepSurfaceFixture} from '../helpers/terrain-step-surface.mjs';
import {openDiagnosticViewer,drawDiagnostic} from '../helpers/pixi-diagnostic-viewer.mjs';

test('software Pixi keeps original cap sampling and only reduces ramp source-over coverage',{timeout:120000},async t=>{
  const tempRoot=process.env.SCENE_KIT_BROWSER_TEMP_ROOT??tmpdir();mkdirSync(tempRoot,{recursive:true});
  const root=mkdtempSync(join(tempRoot,'step-surface-')),input=stepSurfaceFixture(),W=128,H=72,rgba=Buffer.alloc(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)rgba.set([x*2,y*3,210,128+(x+y)%100],(y*W+x)*4);
  const cap=encodeRgbaPng(W,H,rgba),body=encodeRgbaPng(2,2,Buffer.from(new Array(4).fill([70,80,90,255]).flat())),
    ref=(path,png)=>({path,sha256:hash(png),byteLength:png.length}),capRef=ref('cap.png',cap),bodyRef=ref('body.png',body),files=new Map([['cap.png',cap],['body.png',body]]);
  input.appearance.cap.source=capRef;input.surfaceInterface.capSourceSha256=capRef.sha256;delete input.surfaceSpanEnvelope;
  // Full lip only avoids a stale old cap binding; adaptive selection is tested
  // separately with cross-owner geometry in the core regression.
  rebindStepSurfaceFixture(input);const legacy=structuredClone(input);delete legacy.surfaceBinding;delete legacy.surfaceInterface;
  const make=result=>({format:'ai_scene_terrain_render_diagnostic_frame_v1',source:{authorSha256:'b'.repeat(64)},
    defaultCamera:{center:{x:320,y:256},viewport:{width:640,height:512},scale:1},
    layers:[{layerId:'terrain',visible:true,parallax:{x:1,y:1},nodes:[]}],terrainMaterial:{body:{source:bodyRef},cap:{source:capRef}},
    gridTerrains:result.gridTerrains.map(p=>({...p,body:{positions:[],uvs:[],indices:[]},cornerMeshes:p.cornerMeshes.filter(m=>m.materialKind==='cap')})),curveTerrains:[],mixedTerrains:[]}),
    oldScene=make(compileTerrainStepCorners(legacy)),newScene=make(compileTerrainStepCorners(input)),before=Buffer.from(cap),
    {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launchPersistentContext(join(root,'profile'),{headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  t.after(async()=>{await browser.close();rmSync(root,{recursive:true,force:true});});
  const page=await browser.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('data:')?r.continue():(external.push(r.request().url()),r.abort()));await openDiagnosticViewer(page);
  const camera={width:640,height:512,center:{x:320,y:256},scale:1,alphaMask:true},a=inspectPng((await drawDiagnostic(page,oldScene,files,camera)).png,{includePixels:true}),
    b=inspectPng((await drawDiagnostic(page,newScene,files,camera)).png,{includePixels:true});let reduced=0;
  for(let i=0;i<a.rgba.length;i+=4){assert(b.rgba[i]+1>=a.rgba[i],'black-on-white Alpha cannot increase after crop');if(b.rgba[i]>a.rgba[i]+2)reduced++;}
  assert(reduced>1000);assert.deepEqual(cap,before);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
