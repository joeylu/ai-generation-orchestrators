import assert from 'node:assert/strict';
import {join} from 'node:path';
import {setupCoherent,sourcePng} from './coherent.mjs';
import {decision} from './generation.mjs';
import {galleryRaster,gallerySourceRaster,galleryBrief,galleryAnalysis,galleryOverrides,galleryObservations} from './reference-gallery.mjs';
import * as flow from '../../src/generation/index.mjs';
import {createCoherentComposition} from '../../src/coherent-composition.mjs';
import {loadSceneKit,readMap} from '../../src/kit.mjs';

export function galleryCandidate(t,{lowerBacking=true}={}){
 const f=setupCoherent(t,'Synthetic gallery recomposition',undefined,{referenceBytes:galleryRaster().png,transformBrief:galleryBrief,transformAnalysis:galleryAnalysis});
 const sourceScopes=flow.createLayerSourceScopes(f.brief.requirements,galleryOverrides);
 const coverage=flow.checkReferenceObservationCoverage({...galleryObservations,referenceBytes:f.raw,requirements:f.brief.requirements,sourceScopes});
 assert.equal(coverage.status,'pass');
 const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes});
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('gallery.fixture.compute',batch.sha256,'approve-compute'));
 const rawSources=new Map();
 for(const sha of batch.planSha256s){
  const p=flow.getGenerationPlan(f.workflow,sha),raw=p.recipe.assetId==='coherent.material'?sourcePng(false,9):gallerySourceRaster(p.recipe.assetId.replace(/\.actual$/,''),{lowerBacking}).png;
  rawSources.set(p.recipe.assetId,raw);const {request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);
  assert.equal(flow.receiveResult(f.workflow,ticket,raw).technical.status,'pass');
 }
 // The floor at y=120 is off the 64px grid. Use the existing author-curve
 // contract; a rounded grid top at y=128 would leave an artificial contact gap.
 const composition=createCoherentComposition(batch,f.target,{contacts:[]});
 const candidateId='gallery.fixture.candidate',output=join(f.parent,'candidate');
 const bundle=flow.buildCoherentCandidate(f.workflow,batch.sha256,candidateId,output,composition);
 flow.verifyCoherentCandidate(f.workflow,batch.sha256,candidateId,output,composition);
 const handle=loadSceneKit(join(output,'kit')),document=readMap(handle);
 return {...f,batch,composition,candidateId,output,bundle,handle,document,rawSources,coverage};
}
