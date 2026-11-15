import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import * as flow from '../src/generation/index.mjs';
import {reviewBandGuide} from '../src/generation/band-guide-review.mjs';
import {previewBandCompositionGuide} from '../src/generation/band-composition-guide.mjs';
import {createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {createBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {seal,unseal,hash} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';

const band=()=>({format:'ai_scene_background_band_v3',profile:'background-band-coverage-v3',guidanceProfile:'normalized-three-cut-coverage-v1',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(flow.BACKGROUND_BAND_COVERAGE_BUDGET),camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const guide=referenceRawSha256=>{const b=band(),spec={format:'ai_scene_band_composition_guide_spec_v1',referenceRawSha256,scale:[.5,.5],translation:{x:[-100,0],y:[-80,8]},features:[{featureId:'peak',description:'synthetic peak',native:{x:[.3,.4],y:[.3,.4]},target:{x:[0,256],y:[0,144]}},{featureId:'tower',description:'synthetic tower',native:{x:[.5,.6],y:[.3,.4]},target:{x:[0,256],y:[0,144]}}]};return {spec,decision:decision('guide.review',previewBandCompositionGuide({band:b,role:'valley',spec}).proposal.sha256)};};
const relations=sha=>({format:'ai_scene_band_feature_relations_v1',referenceRawSha256:sha,features:[{featureId:'peak',description:'synthetic peak'},{featureId:'tower',description:'synthetic tower'}],relations:[{from:'peak',to:'tower',axis:'x',min:.12,max:.2}]});
const transformBrief=b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,{subjectId:'rear',role:'valley',layerId:'landmark',content:'A synthetic band.',count:{min:1,max:1},placementHint:'wide'}]})});
const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic band.'}]});
function rawBand(){const w=512,h=256,rgba=Buffer.alloc(w*h*4);for(let x=0;x<w;x++)for(let y=12+Math.floor((Math.sin(x/40)+1)*8);y<h;y++)rgba.set([45+x%120,80+y%90,111,254],(y*w+x)*4);return encodeRgbaPng(w,h,rgba);}
function setup(t,hasGuide,hasRelations){const f=setupCoherent(t,'Band guide gate synthetic',undefined,{transformBrief,transformAnalysis}),ref=hash(f.raw);
 const override={subjectId:'rear',parentRole:'far',content:'A synthetic valley band.',exclusions:[],backgroundBand:band(),...(hasGuide?{bandCompositionGuide:guide(ref)}:{}),...(hasRelations?{bandFeatureRelations:relations(ref)}:{})},scopes=flow.createLayerSourceScopes(f.brief.requirements,[override]),batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes});
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('guide.gate.compute',batch.sha256,'approve-compute'));
 for(const [i,sha]of batch.planSha256s.entries()){const p=flow.getGenerationPlan(f.workflow,sha);receiveEdgeFixture(f.workflow,sha,p.recipe.assetId==='rear.actual'?rawBand():sourcePng(p.target.alpha==='transparent',i+10));}
 const sha=batch.planSha256s.find(s=>flow.getGenerationPlan(f.workflow,s).recipe.assetId==='rear.actual'),plan=flow.getGenerationPlan(f.workflow,sha),result=flow.getGenerationResult(f.workflow,sha),material=flow.getGenerationResult(f.workflow,batch.planSha256s[0]).bytes,measure=coherentSurfaceObservations();measure.rockFeaturePairs[0].source.toX=160;
 const mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations:measure}),placement=createBackgroundBandPlacement({plan,raw:result.bytes,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0}});
 return {...f,batch,sha,plan,result,composition:createMeasuredCoherentComposition(batch,f.target,mapping,{bandPlacements:[placement]})};}
const guideObs=()=>[{featureId:'peak',x:[.35,.35],y:[.35,.35]},{featureId:'tower',x:[.5,.5],y:[.35,.35]}];
const relationObs=guideObs;
test('candidate guide gate requires exact workflow-reviewed image and complete observations',{timeout:300000},t=>{
 const f=setup(t,true,true),before=flow.inspectWorkflow(f.workflow),obs=guideObs(),report=flow.reviewCoherentBandGuide(f.workflow,f.sha,obs),row={planSha256:f.sha,observations:obs,report},rel=[{planSha256:f.sha,observations:obs,report:flow.reviewCoherentBandRelations(f.workflow,f.sha,obs)}];assert.equal(report.status,'reviewed');
 const build=(name,rows)=>flow.buildCoherentCandidate(f.workflow,f.batch.sha256,'guide.fixture',join(f.parent,name),f.composition,rel,rows);
 assert.throws(()=>build('absent',null));assert.equal(existsSync(join(f.parent,'absent')),false);
 for(const [name,observations,want] of [['missing',[],'missing'],['uncertain',[{...obs[0],x:[.25,.35]},obs[1]],'uncertain'],['violated',[{...obs[0],x:[.6,.7]},obs[1]],'violated']]){const r=flow.reviewCoherentBandGuide(f.workflow,f.sha,observations);assert.equal(r.status,'blocked');assert.equal(r.findings[0].status,want);assert.throws(()=>build('blocked-'+name,[{...row,observations,report:r}]));}
 assert.throws(()=>build('stale',[{...row,observations:[]} ]));assert.throws(()=>build('wrong-plan',[{...row,planSha256:'0'.repeat(64)}]));
 assert.throws(()=>reviewBandGuide({plan:f.plan,technical:f.result.result.technical,rawBytes:sourcePng(true,29),observations:obs}));
 const root=join(f.parent,'candidate'),bundle=build('candidate',[row]);assert.equal(flow.verifyCoherentCandidate(f.workflow,f.batch.sha256,'guide.fixture',root,f.composition).bundleSha256,bundle.sha256);
 const file=join(root,'evidence/band-guide-reviews.json'),saved=readFileSync(file);try{writeFileSync(file,JSON.stringify([{...row,observations:[]}]));assert.throws(()=>flow.verifyCoherentCandidate(f.workflow,f.batch.sha256,'guide.fixture',root,f.composition));}finally{writeFileSync(file,saved);}
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
test('guide and feature relations are independent requirements, while unconstrained sources stay compatible',{timeout:300000},t=>{
 const f=setup(t,true,true),gobs=guideObs(),robs=relationObs(),guides=[{planSha256:f.sha,observations:gobs,report:flow.reviewCoherentBandGuide(f.workflow,f.sha,gobs)}],relRows=[{planSha256:f.sha,observations:robs,report:flow.reviewCoherentBandRelations(f.workflow,f.sha,robs)}];
 assert.throws(()=>flow.checkCoherentCandidateRelations(f.workflow,f.batch.sha256,null,guides,f.composition));assert.throws(()=>flow.checkCoherentCandidateRelations(f.workflow,f.batch.sha256,relRows,null,f.composition));assert.equal(flow.checkCoherentCandidateRelations(f.workflow,f.batch.sha256,relRows,guides,f.composition).status,'checked');
 const alternate=[{featureId:'peak',x:[.2,.2],y:[.35,.35]},{featureId:'tower',x:[.36,.36],y:[.35,.35]}],inconsistent=[{planSha256:f.sha,observations:alternate,report:flow.reviewCoherentBandRelations(f.workflow,f.sha,alternate)}];assert.equal(inconsistent[0].report.status,'reviewed');assert.throws(()=>flow.checkCoherentCandidateRelations(f.workflow,f.batch.sha256,inconsistent,guides,f.composition));
 const reversed=[...robs].reverse(),ordered=[{planSha256:f.sha,observations:reversed,report:flow.reviewCoherentBandRelations(f.workflow,f.sha,reversed)}];assert.equal(flow.checkCoherentCandidateRelations(f.workflow,f.batch.sha256,ordered,guides,f.composition).status,'checked');
 const legacy=setup(t,false,false);assert.equal(flow.checkCoherentCandidateRelations(legacy.workflow,legacy.batch.sha256).status,'checked');
 const ref=hash(legacy.raw),g=guide(ref),r=relations(ref),scope=override=>flow.createLayerSourceScopes(legacy.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'A synthetic valley band.',exclusions:[],backgroundBand:band(),...override}]);
 assert.throws(()=>flow.previewCoherentSources(legacy.workflow,{...legacy.options,batchId:'guide.only.bad',sourceScopes:scope({bandCompositionGuide:g})}));
 const mismatch=structuredClone(r);mismatch.features[0].description='different feature description';assert.throws(()=>flow.previewCoherentSources(legacy.workflow,{...legacy.options,batchId:'guide.mismatch.bad',sourceScopes:scope({bandCompositionGuide:g,bandFeatureRelations:mismatch})}));
});
test('guide CLI records reviewed and blocked results without mutating the workflow',{timeout:120000},t=>{
 const f=setup(t,true,true),before=flow.inspectWorkflow(f.workflow),script=join(process.cwd(),'game-scene-harnesses/scene-kit-harness/scripts/coherent.mjs');
 for(const [name,obs,expected,exit]of [['good',guideObs(),'reviewed',0],['bad',[{...guideObs()[0],x:[.6,.7]},guideObs()[1]],'blocked',2]]){
  const input=join(f.parent,name+'-guide-observations.json'),output=join(f.parent,name+'-guide-review.json');writeFileSync(input,JSON.stringify(obs));
  const call=spawnSync(process.execPath,[script,'band-guide-review','--root',f.root,'--source',f.sha,'--observations',input,'--out',output],{encoding:'utf8'});
  assert.equal(call.status,exit,call.stderr);const review=JSON.parse(readFileSync(output));assert.equal(review.status,expected);assert.equal(review.humanArtAcceptance,'not-assessed');assert.equal(review.planSha256,f.sha);
 }
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
