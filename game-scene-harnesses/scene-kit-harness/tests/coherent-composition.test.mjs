import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCoherentComposition,coherentDisplayPlacement} from '../src/coherent-composition.mjs';
import {seal,hash} from '../src/generation/common.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {renderCoherentFrame} from '../src/coherent-render.mjs';
import {supportsModuleRenderStyle} from '../src/render-style.mjs';
const batch={sha256:'b'.repeat(64)},target={sha256:'a'.repeat(64),instances:[{instanceId:'sky',role:'sky'},{instanceId:'front',role:'foreground'},{instanceId:'ground',role:'ground'},{instanceId:'platform',role:'platform'}]};
const row=()=>({instanceId:'front',x:-100,y:200,scale:{numerator:3,denominator:2},tint:0xb8b0b8,opacity:1});
const profile=(rows=[row()])=>seal({format:'ai_scene_coherent_composition_v1',batchSha256:batch.sha256,targetSha256:target.sha256,transforms:rows});
test('display composition keeps logical anchors within the world while preserving source pixels and intended visual positions',()=>{
  const p=profile(),r=validateCoherentComposition(p,batch,target).get('front');
  const module={pixelSize:{width:400,height:250},source:{path:'assets/front.png',sha256:'c'.repeat(64)},anchorPx:{x:2,y:2},visualOffset:{x:0,y:0}};
  const source=structuredClone({pixelSize:module.pixelSize,source:module.source}),position=coherentDisplayPlacement(r,module,{width:1024,height:576});
  assert.deepEqual(position,{x:0,y:200});assert.deepEqual(module.visualOffset,{x:-100,y:0});assert.deepEqual({pixelSize:module.pixelSize,source:module.source},source);
  assert.equal(position.x+module.visualOffset.x-module.anchorPx.x*1.5,-103);assert.equal(position.y+module.visualOffset.y-module.anchorPx.y*1.5,197);
});
test('composition refuses stale identities, terrain transforms, duplicates and unbounded or pixel-edit fields',()=>{
  const reject=p=>assert.throws(()=>validateCoherentComposition(p,batch,target));
  reject(seal({...profile(),sha256:undefined,batchSha256:'d'.repeat(64)}));
  for(const instanceId of ['ground','platform','absent'])reject(profile([{...row(),instanceId}]));
  reject(profile([row(),row()]));reject(profile([{...row(),x:4097}]));reject(profile([{...row(),scale:{numerator:5,denominator:1}}]));
  reject(profile([{...row(),alphaMask:'not-allowed'}]));assert.equal(validateCoherentComposition(null,batch,target).size,0);
});
test('an enlarged negative-offset background covers the frame without rewriting its PNG',()=>{
  const native=encodeRgbaPng(2,2,Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255])),before=hash(native);
  const scene={defaultCamera:{center:{x:2,y:2},viewport:{width:4,height:4}},layers:[{visible:true,nodes:[{kind:'sprite',position:{x:-2,y:-2},size:{width:8,height:8},source:{path:'asset.png',sha256:before},renderStyle:{tint:0xffffff,opacity:1}}]}]};
  const rendered=inspectPng(renderCoherentFrame(scene,()=>native),{includePixels:true});
  assert.deepEqual([...rendered.rgba.subarray(0,4)],[255,0,0,255]);assert.deepEqual([...rendered.rgba.subarray(60,64)],[255,255,0,255]);assert.equal(hash(native),before);
});
test('only v4 opaque backgrounds gain display scaling; terrain, transparency, tint and excessive scale stay rejected',()=>{
  const module={kind:'background',renderStyle:{scale:{numerator:2,denominator:1},tint:0xffffff,opacity:1}};
  assert.equal(supportsModuleRenderStyle(module,'ai_scene_kit_v4'),true);
  for(const kit of ['ai_scene_kit_v1','ai_scene_kit_v2','ai_scene_kit_v3'])assert.equal(supportsModuleRenderStyle(module,kit),false);
  assert.equal(supportsModuleRenderStyle({...module,kind:'terrain'},'ai_scene_kit_v4'),false);
  for(const change of [{opacity:.99},{tint:0xeeeeee},{scale:{numerator:5,denominator:1}}])
    assert.equal(supportsModuleRenderStyle({...module,renderStyle:{...module.renderStyle,...change}},'ai_scene_kit_v4'),false);
  assert.throws(()=>validateCoherentComposition(profile([{...row(),instanceId:'sky',opacity:.8}]),batch,target));
});
test('an explicit author layer order must be a full permutation of the frozen layers',()=>{
  const framedTarget={...target,layers:[{layerId:'sky'},{layerId:'valley'},{layerId:'city'}]};
  const make=layerOrder=>{const {sha256,...body}=profile();return seal({...body,layerOrder});};
  assert.equal(validateCoherentComposition(make(['sky','city','valley']),batch,framedTarget).size,1);
  for(const order of [['sky','valley'],['sky','city','city'],['sky','city','absent']])assert.throws(()=>validateCoherentComposition(make(order),batch,framedTarget));
});
test('density-aware compositions have a closed versioned sampling policy and may use identity placement',()=>{
  const p=seal({format:'ai_scene_coherent_composition_v2',batchSha256:batch.sha256,targetSha256:target.sha256,transforms:[],sourceSampling:'display-density-2x-v1'});
  assert.equal(validateCoherentComposition(p,batch,target).size,0);
  const {sha256,...body}=p;
  assert.throws(()=>validateCoherentComposition(seal({...body,sourceSampling:'arbitrary-upscale'}),batch,target));
  assert.throws(()=>validateCoherentComposition(seal({...body,alphaCleanup:true}),batch,target));
  assert.throws(()=>validateCoherentComposition(seal({...body,format:'ai_scene_coherent_composition_v1'}),batch,target));
});
