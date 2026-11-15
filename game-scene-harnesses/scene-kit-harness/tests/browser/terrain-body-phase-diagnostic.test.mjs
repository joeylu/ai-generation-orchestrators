import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {dependency} from '../../scripts/studio-build.mjs';
import {createTerrainBodyPhaseDiagnostic,TERRAIN_RENDER_DIAGNOSTIC_GROUPS as all} from '../../src/index.mjs';
import {inspectPng} from '../../src/png.mjs';
import {bodyPhaseFixture} from '../helpers/terrain-body-phase.mjs';
import {openDiagnosticViewer,drawDiagnostic} from '../helpers/pixi-diagnostic-viewer.mjs';

test('software Pixi phases the body, shading and step-body together with CPU sampling and restores the exact original view',{timeout:120000},async t=>{
  const tempRoot=resolve(process.env.SCENE_KIT_BROWSER_TEMP_ROOT??tmpdir());mkdirSync(tempRoot,{recursive:true});
  const root=mkdtempSync(join(tempRoot,'terrain-body-phase-')),f=bodyPhaseFixture(),before=structuredClone(f.scene),
    camera={width:64,height:40,center:{x:32,y:20},scale:1},
    {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launchPersistentContext(join(root,'profile'),
      {headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  t.after(async()=>{await browser.close();const child=relative(tempRoot,resolve(root));assert(child&&!child.startsWith('..')&&!isAbsolute(child));rmSync(root,{recursive:true,force:true});});
  const page=await browser.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('data:')?r.continue():(external.push(r.request().url()),r.abort()));await openDiagnosticViewer(page);
  const initial=await drawDiagnostic(page,f.scene,f.files,camera),original=inspectPng(initial.png,{includePixels:true}).rgba;
  for(const phase of [{u:1/8,v:0},{u:0,v:-1/8}]){
    const d=createTerrainBodyPhaseDiagnostic(f.scene,{groups:all,phase}),frame=await drawDiagnostic(page,d.scene,f.files,camera),actual=inspectPng(frame.png,{includePixels:true}).rgba,expected=f.pixels(d.scene);
    assert.equal(frame.result.contentSha256,null);
    for(let i=0;i<actual.length;i++)assert(Math.abs(actual[i]-expected[i])<=1,`CPU/Pixi channel ${i}`);
    for(let y=0;y<40;y++)for(let x=0;x<64;x++)if(!f.bodyRects.some(p=>x>=p.x&&x<p.x+8&&y>=p.y&&y<p.y+8))
      assert.deepEqual(f.pixel(actual,x,y),f.pixel(original,x,y));
    for(const p of f.bodyRects)assert.notDeepEqual(f.pixel(actual,p.x+2,p.y+3),f.pixel(original,p.x+2,p.y+3));
  }
  const zero=createTerrainBodyPhaseDiagnostic(f.scene,{groups:all,phase:{u:0,v:0}}),restored=await drawDiagnostic(page,zero.scene,f.files,camera);
  assert.deepEqual(restored.png,initial.png);assert.deepEqual(f.scene,before);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
