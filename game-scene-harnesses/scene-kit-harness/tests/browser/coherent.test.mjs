import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as pipeline from '../../src/coherent-pipeline.mjs';
import {captureCoherentStudio} from '../../src/coherent-studio.mjs';
import {reviewCoherentStudioRecomposition,assertCoherentStudioRecomposition} from '../../src/coherent-recomposition-review.mjs';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {coherentBrief,coherentAnalysis,referencePng,sourcePng,coherentSurfaceObservations} from '../helpers/coherent.mjs';
import {decision} from '../helpers/generation.mjs';
import {seal} from '../../src/generation/common.mjs';
test('fresh coherent fixture reaches actual Pixi Studio capture and browser ZIP equality without real generation',{timeout:300000},async t=>{
  const parent=mkdtempSync(join(tmpdir(),'coherent-browser-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));const root=join(parent,'project'),delivery=join(parent,'delivery');
  pipeline.initCoherentPipeline(root,coherentBrief('Industrial canal city'),{purpose:'synthetic-simulation',finalReviewPolicy:'studio-recomposition-required-v1'});let computes=0,images=0;
  const result=await pipeline.driveCoherentPipeline(root,{delivery,
    imageAdapter:{preflight:async()=>{},generate:async i=>{images++;return i.request.task==='reference'?referencePng():sourcePng(i.request.output.alpha==='transparent',17);}},
    planner:{analyze:async({request})=>coherentAnalysis({sha256:request.planSha256},request.rawSha256,request.requirements)},
    operator:{reviewDesign:async s=>({spec:decision('spec',s.design.specSha256),style:decision('style',s.design.styleSha256)}),
      approveCompute:async s=>decision('compute.'+(++computes),s.targetSha256,'approve-compute'),reviewReference:async a=>decision('reference',a.packet.packetSha256),
      calibrateSurface:async()=>({observations:coherentSurfaceObservations()})}});
  assert(result.delivery);assert.equal(images,7);
  const readiness=JSON.parse(readFileSync(join(delivery,'candidate/readiness.json'))),framed=join(parent,'framed-delivery');
  const composition=seal({format:'ai_scene_coherent_composition_v2',sourceSampling:'display-density-2x-v1',batchSha256:result.delivery.sourceBatchSha256,targetSha256:readiness.targetSha256,
    transforms:[{instanceId:'sky.actual',x:-64,y:-36,scale:{numerator:2,denominator:1},tint:0xffffff,opacity:1},
      {instanceId:'front.left',x:-10,y:100,scale:{numerator:3,denominator:2},tint:0xb8b0b8,opacity:1}],
    layerOrder:['sky','landmark','ground','platform','front']});
  pipeline.deliverCoherentPipeline(root,framed,{composition});
  const catalog=dir=>JSON.parse(readFileSync(join(dir,'candidate/kit/catalog.json'))).modules;
  const platform=catalog(framed).find(m=>m.terrainSkin);assert(platform.terrainSkin.surfacePx.right-platform.terrainSkin.surfacePx.left>=128);
  assert(catalog(framed).find(m=>m.assetId==='scene.front.left').pixelSize.width>catalog(delivery).find(m=>m.assetId==='scene.front.left').pixelSize.width);
  const {chromium}=dependency('playwright').require('playwright'),output=join(parent,'studio-review');
  let captured;
  try { captured=await captureCoherentStudio(root,framed,output,{chromium,startStudio,buildStudio:()=>buildStudio({output:join(parent,'static')}),
    channel:process.env.SCENE_KIT_BROWSER_CHANNEL}); }
  catch (error) {
    try { console.error('capture diagnostic:',readFileSync(join(output,'capture-failed.json'),'utf8')); } catch {}
    throw error;
  }
  assert.equal(captured.actualStudioFrame,true);assert.equal(captured.browserZipEqualsCli,true);assert.equal(captured.editorVisibilityDoesNotChangeMap,true);assert.equal(captured.artAcceptance,'not-assessed');
  assert.deepEqual(captured.errors,[]);assert.deepEqual(captured.warnings,[]);
  assert.deepEqual(readFileSync(join(output,'browser-scene-kit.zip')),readFileSync(join(framed,'scene-kit.zip')));assert.equal(images,7);
  const observations=[['background','depth'],['background','composition'],['background','source-content'],
    ['midground','composition'],['midground','source-content'],['foreground','composition'],['foreground','source-content'],
    ['midground','joins'],['foreground','brush']].map(([area,check],i)=>({observationId:`o${i}`,area,check,
      referenceRegion:[0,0,1,1],captureRegion:[0,0,1,1],referenceFinding:'Synthetic reference',captureFinding:'Synthetic capture',verdict:'match'}));
  const review=reviewCoherentStudioRecomposition(root,framed,output,observations);
  assert.equal(review.status,'reviewed');assert.equal(review.humanArtAcceptance,'not-assessed');
  assertCoherentStudioRecomposition(root,framed,output,observations,review);
  const framedReport=JSON.parse(readFileSync(join(framed,'delivery.json'))),art=decision('final.art',framedReport.sha256);
  assert.throws(()=>pipeline.reviewCoherentDelivery(root,framed,art));
  const otherReport=JSON.parse(readFileSync(join(delivery,'delivery.json')));
  assert.throws(()=>pipeline.reviewCoherentDelivery(root,delivery,decision('other.art',otherReport.sha256),{captureDirectory:output,observations,recompositionReport:review}));
  const rejected=pipeline.reviewCoherentDelivery(root,delivery,decision('reject.art',otherReport.sha256,'reject'));
  assert.equal(rejected.receipt.decision,'reject');assert.equal(rejected.finalReviewPolicy,'studio-recomposition-required-v1');assert.equal(rejected.recompositionReviewSha256,undefined);
  observations[3].verdict='mismatch';
  assert.throws(()=>assertCoherentStudioRecomposition(root,framed,output,observations,review));
  const blocked=reviewCoherentStudioRecomposition(root,framed,output,observations);assert.equal(blocked.status,'blocked');
  assert.throws(()=>pipeline.reviewCoherentDelivery(root,framed,art,{captureDirectory:output,observations,recompositionReport:review}));
  assert.throws(()=>pipeline.reviewCoherentDelivery(root,framed,art,{captureDirectory:output,observations,recompositionReport:blocked}));
  observations[3].verdict='match';
  const accepted=pipeline.reviewCoherentDelivery(root,framed,art,{captureDirectory:output,observations,recompositionReport:review});
  assert.equal(accepted.recompositionReviewSha256,review.sha256);assert.equal(accepted.finalReviewPolicy,'studio-recomposition-required-v1');
});
