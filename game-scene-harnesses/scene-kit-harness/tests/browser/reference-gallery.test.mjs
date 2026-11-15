import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {galleryCandidate} from '../helpers/gallery-candidate.mjs';
import {contextFor} from '../../src/kit.mjs';
import {createEditor} from '../../src/editor.mjs';
import {exportSceneArchive} from '../../src/persistence.mjs';
import {inspectPng} from '../../src/png.mjs';
import {hash} from '../../src/generation/common.mjs';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';

test('gallery responsibilities survive actual Pixi rendering, independent edits, undo and browser export',{timeout:180000},async t=>{
 const f=galleryCandidate(t),baseline=createEditor(f.handle,f.document).getDocument();
 const sources=[...contextFor(f.handle).files].map(([path,bytes])=>({path,sha256:hash(bytes)}));
 const staticRoot=await buildStudio({output:join(f.parent,'static')});
 const host=await startStudio({root:join(f.output,'kit'),staticRoot,initialDocument:baseline});
 const {chromium}=dependency('playwright').require('playwright'),errors=[],external=[];let browser;
 try{
  browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL,
   args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});
  const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
  await page.route('**/*',route=>new URL(route.request().url()).origin===host.url?route.continue():(external.push('blocked-external-origin'),route.abort()));
  const state=async()=>{const r=await page.request.get(host.url+'/api/state');assert.equal(r.status(),200);return r.json();};
  const edit=async(action,extra={})=>{const current=await state(),r=await page.request.post(host.url+'/api/edit',{
   headers:{Origin:host.url},data:{revision:current.revision,action,...extra}});assert.equal(r.status(),200);return r.json();};
  const capture=async()=>{
   await page.goto(host.url+'/editor');await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
   await page.locator('#grid').uncheck();await page.locator('#home').click();await page.locator('#preview').click();
   await page.locator('.canvas-caption').evaluate(e=>e.style.visibility='hidden');
   const rect=await page.locator('canvas').boundingBox(),scale=Math.min(rect.width/256,rect.height/144);
   return inspectPng(await page.screenshot({clip:{x:rect.x+(rect.width-256*scale)/2,y:rect.y+(rect.height-144*scale)/2,width:256*scale,height:144*scale}}),{includePixels:true,allowHiddenRgb:true});
  };
  // Known synthetic colors are relation probes, not automatic vision or a
  // pixel-exact acceptance policy for user artwork.
  const pixel=(image,x,y)=>{const px=Math.floor((x+.5)*image.width/256),py=Math.floor((y+.5)*image.height/144),offset=(py*image.width+px)*4;return [...image.rgba.subarray(offset,offset+4)];};
  const original=await capture(),initial=await state();assert.deepEqual(initial.document,baseline);
  assert.deepEqual(pixel(original,70,104),[167,159,125,255]); // lower garden
  assert.deepEqual(pixel(original,175,114),[178,112,67,255]); // crate covers sill
  assert.deepEqual(pixel(original,206,90),[75,67,64,255]); // column covers crate
  assert.deepEqual(pixel(original,197,116),[75,67,64,255]); // complete column foot
  assert.notDeepEqual(pixel(original,70,123),[161,197,215,255]); // actual floor, no grid gap
  const moved=await edit('commands',{commands:[{type:'move-instance',instanceId:'crate.actual',x:120,y:78}]});
  const expected=structuredClone(baseline);expected.instances.find(i=>i.instanceId==='crate.actual').x=120;assert.deepEqual(moved.document,expected);
  const exposed=await capture();assert.deepEqual(pixel(exposed,175,114),[117,98,82,255]);assert.deepEqual(pixel(exposed,206,90),[75,67,64,255]);
  assert.deepEqual((await edit('undo')).document,baseline);
  await edit('commands',{commands:[{type:'remove-instance',instanceId:'column.actual'}]});
  assert.deepEqual(pixel(await capture(),206,90),[178,112,67,255]);
  assert.deepEqual((await edit('undo')).document,baseline);
  assert.deepEqual((await capture()).rgba,original.rgba);
  const final=await state();assert.equal(final.scene.source.authorSha256,initial.scene.source.authorSha256);
  const archive=await page.request.get(host.url+'/api/export?revision='+final.revision);assert.equal(archive.status(),200);
  assert.deepEqual(await archive.body(),exportSceneArchive(f.handle,baseline));
  for(const source of sources)assert.equal(hash(readFileSync(join(f.output,'kit',source.path))),source.sha256);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }finally{await browser?.close();await host.close();}
});
