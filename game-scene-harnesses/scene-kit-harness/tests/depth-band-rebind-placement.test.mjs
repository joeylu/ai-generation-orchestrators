import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../src/generation/index.mjs';
import {createBackgroundBandPlacement,validateBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {seal,unseal,hash} from '../src/generation/common.mjs';
import {setupCoherent} from './helpers/coherent.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';
import {checkDepthBandEvidence} from '../src/verified-depth-pair-variant.mjs';

const band=()=>({format:'ai_scene_background_band_v1',profile:'background-band-v1',camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
function png(){const w=512,h=256,rgba=Buffer.alloc(w*h*4);for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++)if(y>24+x%11)rgba.set([50,80,110,252],(y*w+x)*4);return encodeRgbaPng(w,h,rgba);}
function fixture(t,changed){const f=setupCoherent(t,undefined,undefined,{transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),subjects:b.requirements.subjects.map(s=>s.subjectId==='landmark'?{...s,role:'backdrop'}:s)})}),
  transformAnalysis:a=>{const v=unseal(a),item=v.instances.find(x=>x.instanceId==='landmark.actual');item.instanceId='far.actual';if(changed)item.anchor.x+=1;return seal(v);}});
  const scopes=flow.withBackgroundBandScopes(f.brief.requirements,flow.createLayerSourceScopes(f.brief.requirements),[{subjectId:'landmark',backgroundBand:band()}]);
  f.batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes});f.sha=f.batch.planSha256s.find(s=>flow.getGenerationPlan(f.workflow,s).recipe.assetId==='far.actual');return f;}
test('a checked rebind retains its new band scope and supports full-native placement',{timeout:300000},t=>{
  const source=fixture(t,false),target=fixture(t,true),raw=png();
  flow.authorizeReferenceAssetBatch(source.workflow,source.batch.sha256,decision('source.compute',source.batch.sha256,'approve-compute'));receiveEdgeFixture(source.workflow,source.sha,raw);
  const plan=flow.getGenerationPlan(target.workflow,target.sha),options={sourceWorkflow:source.workflow,sourcePlanSha256:source.sha,targetPlanSha256:target.sha,targetSha256:plan.recipe.targetSha256,scopeSha256:plan.sourceScope.definition.sha256};
  const proposal=flow.proposeCoherentRebind(target.workflow,options).proposal;
  const out=flow.commitCoherentRebind(target.workflow,{...options,proposal,rebindId:'depth.rebind',parentBatchSha256:target.batch.sha256,batchId:'depth.rebound',receipt:decision('depth.review',proposal.sha256)});
  const rebound=flow.getGenerationPlan(target.workflow,out.record.sha256),result=flow.getGenerationResult(target.workflow,rebound.sha256);
  assert.equal(rebound.format,'ai_scene_coherent_rebind_v1');assert.equal(result.result.rawSha256,hash(raw));
  const evidence=rebound.sourceEvidence,report={batchSha256:out.batch.sha256,sourceEvidence:[{assetId:'far.actual',planSha256:rebound.sha256,rawSha256:hash(raw)}]},checked={plan:rebound,result:result.result,report,evidence,sky:evidence,raw,batchSha256:out.batch.sha256,asset:'far.actual',role:'backdrop'};
  checkDepthBandEvidence(checked);
  assert.throws(()=>checkDepthBandEvidence({...checked,report:{...report,batchSha256:'0'.repeat(64)}}));
  assert.throws(()=>checkDepthBandEvidence({...checked,report:{...report,sourceEvidence:[{...report.sourceEvidence[0],planSha256:source.sha}]}}));
  assert.throws(()=>checkDepthBandEvidence({...checked,raw:Buffer.from('tampered')}));
  const altered=unseal(evidence);assert.throws(()=>checkDepthBandEvidence({...checked,evidence:seal({...altered,source:{...altered.source,referenceRawSha256:'0'.repeat(64)}})}));
  assert.throws(()=>checkDepthBandEvidence({...checked,evidence:seal({...altered,source:{...altered.source,assetId:'other.actual'}})}));
  const placement=createBackgroundBandPlacement({plan:rebound,raw,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0},target:target.target});
  assert.equal(validateBackgroundBandPlacement(placement,{plan:rebound,raw,target:target.target}).geometry,'finite-full-frame-and-alpha8-range-pass');
  assert.throws(()=>validateBackgroundBandPlacement(placement,{plan:rebound,raw:Buffer.from('wrong'),target:target.target}));
});
