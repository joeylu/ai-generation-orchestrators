import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {previewRegisteredMasterGuide,describeRegisteredMasterGuide,registeredMasterEditPlan,REGISTERED_MASTER_EDIT_ROLE,REGISTERED_LOCAL_EDIT_ROLE} from '../src/generation/registered-layout-master.mjs';
import {previewBandCompositionGuide} from '../src/generation/band-composition-guide.mjs';
import {assessCoherentSource,coherentSourceExtraInputs,verifyCoherentSourceExtraInputs} from '../src/generation/coherent-source.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {join} from 'node:path';
import {loadSceneKit,readMap} from '../src/kit.mjs';
import {createBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {createFeatureCoherentComposition} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {assertCandidateBandGuideReviews} from '../src/generation/band-feature-relation-gate.mjs';
import {BACKGROUND_BAND_COVERAGE_BUDGET} from '../src/generation/background-band-coverage-guide.mjs';
import {createReferenceStructure} from '../src/reference-feature-layout.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
const b=()=>({format:'ai_scene_background_band_v4',profile:'background-band-open-depth-v4',guidanceProfile:'open-valley-irregular-coverage-v3',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(BACKGROUND_BAND_COVERAGE_BUDGET),camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const features=[{featureId:'one',description:'First source feature',target:{x:80,y:50},toleranceWorld:4},{featureId:'two',description:'Second source feature',target:{x:160,y:70},toleranceWorld:4}];
test('continuous v3 depthscape preserves owned atmospheric paint without changing v4 semantics',()=>{const v=values(Buffer.from('synthetic reference')),band=b(),compiled=seal({compiler:'synthetic',sourceScope:{},request:{prompt:'',images:[]}}),make=band=>{const proposal=previewRegisteredMasterGuide({band,role:'valley',spec:v.spec,masterBytes:v.raw}).proposal;return registeredMasterEditPlan(compiled,{role:'valley',backgroundBand:band,content:'Synthetic continuous depthscape.',exclusions:[],bandCompositionGuide:{spec:v.spec,decision:decision('synthetic.guide',proposal.sha256)}});},old=make(band);assert.match(old.request.prompt,/never fill an actual void with an opaque atmosphere sheet/);const continuous={...band,format:'ai_scene_background_band_v3',profile:'background-band-coverage-v3',guidanceProfile:'normalized-three-cut-coverage-v1'},next=make(continuous);assert.match(next.request.prompt,/CONTINUOUS MIDDLE\/REAR DEPTHSCAPE/);assert.match(next.request.prompt,/not an instruction to erase/);assert.match(next.compiler,/continuous-depthscape-v3/);assert.doesNotMatch(next.request.prompt,/never fill an actual void with an opaque atmosphere sheet/);assert.deepEqual(make(band),old);});
function values(ref){const raw=sourcePng(false,3),structure=createReferenceStructure({referenceRawSha256:hash(ref),viewport:{width:256,height:144},assets:[{instanceId:'rear.actual',subjectId:'rear',features,checks:[{checkId:'only.owned',description:'Only the requested synthetic group.'}]}]}),spec={format:'ai_scene_band_master_edit_spec_v1',referenceRawSha256:hash(ref),referenceStructureSha256:structure.sha256,referenceViewport:{width:256,height:144},master:{artifact:{sha256:hash(raw),byteLength:raw.length,pixelSize:{width:1024,height:512}},positionWorld:{x:-96,y:-36},sourceToWorld:{numerator:1,denominator:2}},features:features.map(f=>({featureId:f.featureId,description:f.description,native:{x:[(f.target.x+96-1)/512,(f.target.x+96+1)/512],y:[(f.target.y+36-1)/256,(f.target.y+36+1)/256]},target:{x:[f.target.x-4,f.target.x+4],y:[f.target.y-4,f.target.y+4]}}))};return {raw,spec,structure};}
function setup(t){return setupCoherent(t,'Registered master fixture',undefined,{transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,{subjectId:'rear',role:'valley',layerId:'landmark',content:'Synthetic environmental group.',count:{min:1,max:1},placementHint:'wide'}]})}),transformAnalysis:a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic observed group.'}]})});}
function scope(f,v){const band=b(),proposal=previewRegisteredMasterGuide({band,role:'valley',spec:v.spec,masterBytes:v.raw}).proposal;return flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'Synthetic environmental group.',exclusions:[],backgroundBand:band,referenceStructure:v.structure,bandFeatureRelations:{format:'ai_scene_band_feature_relations_v1',referenceRawSha256:hash(f.raw),features:features.map(({featureId,description})=>({featureId,description})),relations:[{from:'one',to:'two',axis:'x',min:.14,max:.17}]},bandCompositionGuide:{spec:v.spec,decision:decision('master.guide',proposal.sha256)}}]);}

test('registered master descriptor is data-only; preview verifies unchanged exact opaque input',()=>{const v=values(Buffer.from('reference')),band=b(),g=previewRegisteredMasterGuide({band,role:'valley',spec:v.spec,masterBytes:v.raw});assert.deepEqual(g.bytes,v.raw);assert.equal(g.recipe.inputMode,'single-prepared-edit-target-original-reference-retained-as-evidence');assert.equal(describeRegisteredMasterGuide({band,role:'valley',spec:v.spec}).recipe.sha256,g.recipe.sha256);assert.deepEqual(previewBandCompositionGuide({band,role:'valley',spec:v.spec,masterBytes:v.raw}).bytes,v.raw);assert.throws(()=>previewRegisteredMasterGuide({band,role:'valley',spec:v.spec}));assert.throws(()=>previewRegisteredMasterGuide({band,role:'valley',spec:v.spec,masterBytes:sourcePng(true)}));const changed=structuredClone(v.spec);changed.master.sourceToWorld={numerator:1,denominator:4};assert.throws(()=>describeRegisteredMasterGuide({band,role:'valley',spec:changed}));});

test('source uses one prepared edit target while original reference, structure and later guide gate remain bound',t=>{const f=setup(t),v=values(f.raw);flow.importStandardWorkflowImage(f.workflow,v.raw);const scopes=scope(f,v),o={...f.options,batchId:'master.fixture',sourceScopes:scopes},preview=flow.previewCoherentSources(f.workflow,o),p=preview.plans.find(p=>p.recipe.assetId==='rear.actual');assert.equal(p.request.images.length,1);assert.equal(p.request.images[0].role,REGISTERED_MASTER_EDIT_ROLE);assert.equal(p.request.images[0].artifact.sha256,hash(v.raw));assert.equal(p.referenceEvidence[0].rawSha256,hash(f.raw));assert.equal(p.sourceScope.referenceStructureSha256,v.structure.sha256);assert.match(p.compiler,/registered-layout-master-edit-v1/);assert.match(p.request.prompt,/EDIT THE ATTACHED REGISTERED LAYOUT MASTER IN PLACE/);assert.doesNotMatch(p.request.prompt,/conveyor|spire|canyon|Image 2|neutral example/);assert.deepEqual(coherentSourceExtraInputs(p),[]);verifyCoherentSourceExtraInputs(p,()=>v.raw);assert.throws(()=>verifyCoherentSourceExtraInputs(p,()=>f.raw));const wrong=structuredClone(p);wrong.request.images[0].role='unbound';assert.throws(()=>verifyCoherentSourceExtraInputs(wrong,()=>v.raw));flow.freezeCoherentSources(f.workflow,o);assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,0),v.raw);assert.deepEqual(flow.getGenerationResult(f.workflow,f.plan.sha256).bytes,f.raw);
 flow.authorizePlan(f.workflow,p.sha256,decision('master.compute',p.sha256,'approve-compute'));const {request,...ticket}=flow.reservePlan(f.workflow,p.sha256);assert.equal(request.images.length,1);flow.recordSubmission(f.workflow,ticket);const raw=sourcePng(true,7);flow.receiveResult(f.workflow,ticket,raw);const obs=v.spec.features.map(x=>({featureId:x.featureId,x:[(x.native.x[0]+x.native.x[1])/2,(x.native.x[0]+x.native.x[1])/2],y:[(x.native.y[0]+x.native.y[1])/2,(x.native.y[0]+x.native.y[1])/2]})),report=flow.reviewCoherentBandGuide(f.workflow,p.sha256,obs);assert.equal(report.status,'reviewed');const sources=[{plan:p,result:flow.getGenerationResult(f.workflow,p.sha256).result,raw}];assert.equal(assertCandidateBandGuideReviews(sources,[{planSha256:p.sha256,observations:obs,report}],f.raw).length,1);
});

test('changed master decision, target tolerances and original structure cannot be silently accepted',t=>{const f=setup(t),v=values(f.raw);flow.importStandardWorkflowImage(f.workflow,v.raw);const scopes=scope(f,v),body=unseal(scopes),row=body.subjects.find(s=>s.subjectId==='rear');row.bandCompositionGuide.decision.targetSha256='b'.repeat(64);assert.throws(()=>flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:seal(body)}));const changed=values(f.raw);changed.spec.referenceStructureSha256='c'.repeat(64);assert.throws(()=>flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:scope(f,changed)}));const wide=values(f.raw);wide.spec.features[0].target.x=[0,256];assert.throws(()=>flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:scope(f,wide)}));});

test('owned continuation is an explicit new instruction branch and does not reinterpret frozen v1',t=>{const f=setup(t),v=values(f.raw);flow.importStandardWorkflowImage(f.workflow,v.raw);const options={...f.options,batchId:'master.instructions',sourceScopes:scope(f,v)},old=flow.previewCoherentSources(f.workflow,options),oldPlan=old.plans.find(x=>x.recipe.assetId==='rear.actual');flow.freezeCoherentSources(f.workflow,options);const next=values(f.raw);next.spec.instructionProfile='owned-surface-continuation-v2';const preview=flow.previewCoherentSources(f.workflow,{...f.options,batchId:'master.instructions.next',sourceScopes:scope(f,next)}),newPlan=preview.plans.find(x=>x.recipe.assetId==='rear.actual');assert.notEqual(newPlan.sha256,oldPlan.sha256);assert.match(newPlan.compiler,/owned-surface-continuation-v2/);assert.match(newPlan.request.prompt,/Do not cut a second scalloped contour/);assert.match(newPlan.request.prompt,/owned skyline/);assert.doesNotMatch(oldPlan.request.prompt,/OWNED SURFACE CONTINUATION/);assert.deepEqual(flow.getGenerationPlan(f.workflow,oldPlan.sha256),oldPlan);const wrong=values(f.raw);wrong.spec.instructionProfile='unknown';assert.throws(()=>scope(f,wrong));});

test('local edit freezes the native transparent parent and retains the full-frame output contract',t=>{
 const f=setup(t),original=values(f.raw);
 flow.importStandardWorkflowImage(f.workflow,original.raw);
 const parentBatch=flow.freezeCoherentSources(f.workflow,{...f.options,batchId:'local.edit.parent',sourceScopes:scope(f,original)});
 const parent=parentBatch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.recipe.assetId==='rear.actual');
 const native=inspectPng(sourcePng(true,7),{includePixels:true});
 native.rgba.set([13,77,231,0],0);
 const raw=encodeRgbaPng(native.width,native.height,native.rgba);
 flow.authorizePlan(f.workflow,parent.sha256,decision('local.edit.parent.compute',parent.sha256,'approve-compute'));
 const {request,...ticket}=flow.reservePlan(f.workflow,parent.sha256);
 flow.recordSubmission(f.workflow,ticket);
 const result=flow.receiveResult(f.workflow,ticket,raw);
 assert.equal(result.technical.status,'pass');
 const editSpec={...original.spec,instructionProfile:'transparent-local-feature-edit-v1',
   editRegion:{x:445,y:175,width:160,height:100},master:{...original.spec.master,artifact:result.technical.image}};
 const preview=(spec,masterBytes)=>previewRegisteredMasterGuide({band:b(),role:'valley',spec,masterBytes});
 const proposal=preview(editSpec,raw).proposal;
 assert.throws(()=>preview({...editSpec,editRegion:{...editSpec.editRegion,x:0}},raw));
 assert.throws(()=>preview({...editSpec,master:original.spec.master},original.raw));
 const makeOptions=(spec,approved)=>({batchId:'local.edit.revision',replacements:[{assetId:parent.recipe.assetId,
   planId:'local.edit.one',intent:flow.LAYER_SOURCE_INTENT,sourceScope:seal({...unseal(parent.recipe.sourceScope),
     bandCompositionGuide:{spec,decision:decision('local.edit.input',approved)}})}]});
 const different=sourcePng(true,8),differentArtifact={...result.technical.image,sha256:hash(different),byteLength:different.length};
 const wrong={...editSpec,master:{...editSpec.master,artifact:differentArtifact}};
 flow.importStandardWorkflowImage(f.workflow,different);
 assert.throws(()=>flow.reviseCoherentSources(f.workflow,parentBatch.sha256,makeOptions(wrong,preview(wrong,different).proposal.sha256)),
   e=>e.errors?.some(issue=>issue.code==='REGISTERED_LOCAL_EDIT_PARENT'));
 const batch=flow.reviseCoherentSources(f.workflow,parentBatch.sha256,makeOptions(editSpec,proposal.sha256));
 const plan=batch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.recipe.assetId===parent.recipe.assetId);
 assert.deepEqual(plan.recipe.parents,[parent.sha256]);
 assert.deepEqual(plan.request.images,[{role:REGISTERED_LOCAL_EDIT_ROLE,artifact:result.technical.image}]);
 assert.equal(plan.request.maximumCalls,1);
 assert.match(plan.request.prompt,/x 445–604, y 175–274/);
 assert.equal(plan.referenceEvidence[0].rawSha256,hash(f.raw));
 assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,0),raw);
 assert.deepEqual(flow.getGenerationResult(f.workflow,parent.sha256).bytes,raw);
 assert(assessCoherentSource(plan,raw).issues.includes('REGISTERED_LOCAL_EDIT_UNCHANGED'));
 const changedSize=encodeRgbaPng(512,512,Buffer.alloc(512*512*4));
 assert(assessCoherentSource(plan,changedSize).issues.includes('REGISTERED_LOCAL_EDIT_SIZE'));
 assert.equal(assessCoherentSource(plan,different).status,'pass');
 const width=1023,height=512,pixels=Buffer.alloc(width*height*4);
 for(let y=70;y<height;y++)for(let x=0;x<width;x++)pixels.set([x%251,y%251,93,254],(y*width+x)*4);
 const rounded=encodeRgbaPng(width,height,pixels);
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('local.edit.revision.compute',batch.sha256,'approve-compute'));
 const {request:nextRequest,...nextTicket}=flow.reservePlan(f.workflow,plan.sha256);
 assert.equal(nextRequest.maximumCalls,1);
 flow.recordSubmission(f.workflow,nextTicket);
 const failed=flow.receiveResult(f.workflow,nextTicket,rounded);
 assert.deepEqual(failed.technical.issues,['REGISTERED_LOCAL_EDIT_SIZE']);
 const observations=editSpec.features.map(({featureId,native})=>({featureId,
   x:native.x.map(v=>v*1024/width),y:native.y}));
 const options={sourcePlanSha256:plan.sha256,parentBatchSha256:batch.sha256,observations,
   positionWorld:editSpec.master.positionWorld,sourceToWorld:editSpec.master.sourceToWorld};
 const prepared=flow.proposeCoherentNativeFrame(f.workflow,options);
 assert.equal(prepared.technical.status,'pass');
 assert.equal(prepared.guide.status,'reviewed');
 assert.equal(prepared.relations.status,'reviewed');
 assert.equal(prepared.originalRawSha256,failed.rawSha256);
 assert.throws(()=>flow.proposeCoherentNativeFrame(f.workflow,{...options,observations:[]}));
 const adopt=receipt=>flow.adoptCoherentNativeFrame(f.workflow,{preparationId:'local.edit.native.frame',proposal:prepared,receipt,batchId:'local.edit.calibrated'});
 assert.throws(()=>adopt(decision('local.edit.wrong',plan.sha256)));
 const before=flow.inspectWorkflow(f.workflow);
 const adopted=adopt(decision('local.edit.native.review',prepared.sha256));
 const after=flow.inspectWorkflow(f.workflow);
 assert.equal(after.eventCount,before.eventCount+2);
 assert.deepEqual(after.plans.filter(row=>row.planSha256!==adopted.record.sha256),before.plans);
 assert.equal(adopted.batch.newImageRequests,0);
 assert.deepEqual(flow.getGenerationResult(f.workflow,plan.sha256).result,failed);
 assert.deepEqual(flow.getGenerationResult(f.workflow,adopted.record.sha256).bytes,rounded);
 assert.deepEqual(flow.reviewCoherentBandGuide(f.workflow,adopted.record.sha256,observations),prepared.guide);
 assert.deepEqual(flow.reviewCoherentBandRelations(f.workflow,adopted.record.sha256,observations),prepared.relations);
 for(const sha of adopted.batch.planSha256s.filter(sha=>sha!==adopted.record.sha256)){
   const p=flow.getGenerationPlan(f.workflow,sha);
   const {request:unused,...ticket}=flow.reservePlan(f.workflow,sha);
   flow.recordSubmission(f.workflow,ticket);
   assert.equal(flow.receiveResult(f.workflow,ticket,sourcePng(p.target.alpha==='transparent',11)).technical.status,'pass');
 }
 const material=flow.getGenerationResult(f.workflow,adopted.batch.planSha256s[0]).bytes;
 const mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations:coherentSurfaceObservations()});
 const placement=createBackgroundBandPlacement({plan:adopted.record,raw:rounded,target:f.target,
   positionWorld:options.positionWorld,sourceToWorld:options.sourceToWorld});
 const measurements=[{instanceId:plan.recipe.assetId,sourcePlanSha256:adopted.record.sha256,sourceRawSha256:failed.rawSha256,
   features:observations.map(({featureId,x,y})=>({featureId,native:{x:width*(x[0]+x[1])/2,y:height*(y[0]+y[1])/2}})),
   checks:[{checkId:'only.owned',verdict:'pass'}]}];
 const composition=createFeatureCoherentComposition(adopted.batch,f.target,mapping,original.structure,measurements,{bandPlacements:[placement]});
 const row=report=>[{planSha256:adopted.record.sha256,observations,report}];
 const relationRows=row(prepared.relations),guideRows=row(prepared.guide);
 const candidate=join(f.parent,'native-frame-candidate');
 const output=flow.buildCoherentCandidate(f.workflow,adopted.batch.sha256,'native.frame',candidate,composition,relationRows,guideRows);
 assert.equal(flow.verifyCoherentCandidate(f.workflow,adopted.batch.sha256,'native.frame',candidate,composition).bundleSha256,output.sha256);
 const shifted={...placement,positionWorld:{...placement.positionWorld,x:placement.positionWorld.x+1}};
 const shiftedComposition=createFeatureCoherentComposition(adopted.batch,f.target,mapping,original.structure,measurements,{bandPlacements:[shifted]});
 assert.throws(()=>flow.checkCoherentCandidateRelations(f.workflow,adopted.batch.sha256,relationRows,guideRows,shiftedComposition),
   e=>e.errors?.some(issue=>issue.code==='COHERENT_NATIVE_FRAME_PLACEMENT_STALE'));
 const terrainLayout={terrainRuns:[{familyId:'terrain.primary',x:0,y:0,length:1},{familyId:'terrain.primary',x:0,y:2,length:1}],
   curveTerrains:[],terrainConnections:[]};
 const authored=createFeatureCoherentComposition(adopted.batch,f.target,mapping,original.structure,measurements,{bandPlacements:[placement],terrainLayout});
 const authoredPath=join(f.parent,'native-frame-authored-candidate');
 const authoredOutput=flow.buildCoherentCandidate(f.workflow,adopted.batch.sha256,'native.frame.authored',authoredPath,authored,relationRows,guideRows);
 assert.equal(flow.verifyCoherentCandidate(f.workflow,adopted.batch.sha256,'native.frame.authored',authoredPath,authored).bundleSha256,authoredOutput.sha256);
 const map=readMap(loadSceneKit(join(authoredPath,'kit')));
 assert.deepEqual(map.terrainRuns,terrainLayout.terrainRuns);
 assert.deepEqual(map.curveTerrains,[]);
});
