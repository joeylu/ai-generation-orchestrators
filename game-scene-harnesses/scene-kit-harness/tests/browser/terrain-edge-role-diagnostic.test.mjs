import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {dependency} from '../../scripts/studio-build.mjs';
import {createTerrainEdgeRoleDiagnostic,TERRAIN_RENDER_DIAGNOSTIC_GROUPS as groups,TERRAIN_RENDER_DIAGNOSTIC_EDGE_ROLES as roles} from '../../src/terrain-render-diagnostic.mjs';
import {renderCoherentFrame} from '../../src/coherent-render.mjs';
import {inspectPng} from '../../src/png.mjs';
import {edgeRoleFixture} from '../helpers/terrain-edge-role.mjs';
import {openDiagnosticViewer,drawDiagnostic} from '../helpers/pixi-diagnostic-viewer.mjs';

test('software Pixi isolates one lower source role and retains native continuous coverage like CPU',{timeout:120000},async t=>{
  const tempRoot=process.env.SCENE_KIT_BROWSER_TEMP_ROOT??tmpdir();mkdirSync(tempRoot,{recursive:true});const root=mkdtempSync(join(tempRoot,'edge-role-'));
  const {scene,files}=edgeRoleFixture(),before=structuredClone(scene),{chromium}=dependency('playwright').require('playwright'),
    browser=await chromium.launchPersistentContext(join(root,'profile'),{headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  t.after(async()=>{await browser.close();rmSync(root,{recursive:true,force:true});});
  const page=await browser.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('data:')?r.continue():(external.push(r.request().url()),r.abort()));await openDiagnosticViewer(page);
  let full;
  for(const edgeRoles of [roles,roles.filter(r=>r!=='bottom.leftCorner'),['bottom.leftCorner']]){
    const d=createTerrainEdgeRoleDiagnostic(scene,{groups,edgeRoles}),draw=await drawDiagnostic(page,d.scene,files,{width:32,height:32,center:{x:16,y:16},scale:1}),
      gpu=inspectPng(draw.png,{includePixels:true}),cpu=inspectPng(renderCoherentFrame(d.scene,p=>files.get(p)),{includePixels:true});
    for(let n=0;n<gpu.rgba.length;n++)assert(Math.abs(gpu.rgba[n]-cpu.rgba[n])<=1,'native role omission must preserve coverage and order');
    if(edgeRoles===roles)full=draw.png;else assert.notDeepEqual(draw.png,full);
    assert.equal(draw.result.contentSha256,null);assert.equal(d.report.artAcceptance,'not-assessed');
  }
  assert.deepEqual(scene,before);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
