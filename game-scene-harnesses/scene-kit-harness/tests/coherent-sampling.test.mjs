import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {coherentSamplingSize,coherentSamplingStyle,COHERENT_SAMPLING} from '../src/coherent-sampling.mjs';
import {seal,hash} from '../src/generation/common.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {loadSceneKit,readMap} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';

test('sampling stores enough native detail for world scale, preserves uniform fit and never upscales a source',()=>{
  const fit={width:131,height:46},crop={width:2039,height:716};
  const size=coherentSamplingSize(crop,fit,2);
  assert.equal(size.width*fit.height,size.height*fit.width);
  assert(size.width>=fit.width*4&&size.width<=crop.width&&size.height<=crop.height);
  const style=coherentSamplingStyle({scale:{numerator:2,denominator:1},tint:0xffffff,opacity:1},size.factor);
  assert(style.scale.numerator/style.scale.denominator<=.5);
  assert.equal(size.width*style.scale.numerator/style.scale.denominator,fit.width*2);
  const sky=coherentSamplingSize({width:1672,height:941},{width:1024,height:576},1.25,{margin:0});
  assert.deepEqual({width:sky.width,height:sky.height},{width:1664,height:936});
  const limited=coherentSamplingSize({width:131,height:46},fit,4);
  assert.deepEqual({width:limited.width,height:limited.height},fit);
  const bounded=coherentSamplingSize({width:4096,height:4096},{width:100,height:100},4);
  assert(bounded.width+4<=4096&&bounded.height+4<=4096);
});

function platformPng(){
  const width=1024,height=512,rgba=Buffer.alloc(width*height*4);
  for(let y=180;y<300;y++)for(let x=100;x<924;x++){
    const v=Math.floor(x/12)%2?220:35;
    rgba.set([v,80,50,y===180?160:255],(y*width+x)*4);
  }
  rgba.set([210,40,10,1],0);rgba.set([210,40,10,1],rgba.length-4);
  return encodeRgbaPng(width,height,rgba);
}

test('a thin platform with distant one-bit Alpha speckles keeps detail and exact grid width; old recipes still replay',{timeout:180000},t=>{
  const f=setupCoherent(t),batch=flow.freezeCoherentSources(f.workflow,f.options),rawPlatform=platformPng();
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('sampling.sources',batch.sha256,'approve-compute'));
  for(const sha of batch.planSha256s){
    const plan=flow.getGenerationPlan(f.workflow,sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);
    flow.recordSubmission(f.workflow,ticket);flow.receiveResult(f.workflow,ticket,plan.instanceBinding.role==='platform'?rawPlatform:sourcePng(plan.target.alpha==='transparent',27));
  }
  const base={batchSha256:batch.sha256,targetSha256:f.target.sha256,transforms:[{instanceId:'front.left',x:-12,y:92,scale:{numerator:3,denominator:1},tint:0xffffff,opacity:1}]};
  const legacy=seal({format:'ai_scene_coherent_composition_v1',...base}),modern=seal({format:'ai_scene_coherent_composition_v2',...base,sourceSampling:COHERENT_SAMPLING});
  const oldDir=join(f.parent,'legacy'),newDir=join(f.parent,'density');
  flow.buildCoherentCandidate(f.workflow,batch.sha256,'sampling.kit',oldDir,legacy);
  flow.buildCoherentCandidate(f.workflow,batch.sha256,'sampling.kit',newDir,modern);
  flow.verifyCoherentCandidate(f.workflow,batch.sha256,'sampling.kit',oldDir,legacy);
  flow.verifyCoherentCandidate(f.workflow,batch.sha256,'sampling.kit',newDir,modern);
  const read=(dir,p)=>JSON.parse(readFileSync(join(dir,p),'utf8')),old=read(oldDir,'kit/catalog.json').modules,next=read(newDir,'kit/catalog.json').modules;
  const p=next.find(m=>m.assetId==='scene.platform.actual'),before=old.find(m=>m.assetId===p.assetId);
  assert(before.terrainSkin.surfacePx.right-before.terrainSkin.surfacePx.left<64);
  const span=p.terrainSkin.surfacePx.right-p.terrainSkin.surfacePx.left;
  assert(span>=128);assert.equal(span*p.renderStyle.scale.numerator/p.renderStyle.scale.denominator,64);
  assert(p.renderStyle.scale.numerator/p.renderStyle.scale.denominator<=.5);
  assert(p.pixelSize.width>before.pixelSize.width*2);
  assert.equal(hash(readFileSync(join(newDir,'source/platform.actual.png'))),hash(rawPlatform));
  const derived=inspectPng(readFileSync(join(newDir,'kit',p.source.path)),{includePixels:true});
  assert(derived.rgba.some((v,i)=>i%4===3&&v>1&&v<255));
  for(let i=0;i<derived.rgba.length;i+=4)if(!derived.rgba[i+3])assert.deepEqual([...derived.rgba.subarray(i,i+3)],[0,0,0]);
  const oldMap=read(oldDir,'kit/maps/default.scene.json'),newMap=read(newDir,'kit/maps/default.scene.json');
  assert.deepEqual(newMap.instances,oldMap.instances);assert.deepEqual(newMap.assemblyInstances,oldMap.assemblyInstances);
  const a=old.find(m=>m.assetId==='scene.front.left'),b=next.find(m=>m.assetId===a.assetId);
  const aw=(a.pixelSize.width-4)*a.renderStyle.scale.numerator/a.renderStyle.scale.denominator,
    bw=(b.pixelSize.width-4)*b.renderStyle.scale.numerator/b.renderStyle.scale.denominator;
  assert.equal(aw,bw);assert.equal(b.renderStyle.tint,0xffffff);assert.equal(b.renderStyle.opacity,1);
  const handle=loadSceneKit(join(newDir,'kit')),scene=compileMap(handle,readMap(handle));
  assert(scene.layers.flatMap(l=>l.nodes).some(n=>n.assetId===p.assetId));
});
