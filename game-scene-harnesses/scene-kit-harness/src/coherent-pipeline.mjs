import {TERRAIN_INTENT_POLICY,assertTerrainIntentScopes,assertTerrainIntentRendering} from './terrain-intent.mjs';
import {TERRAIN_COMPLETION_POLICY,needsCompleteTerrain,terrainPerimeterOptions} from './terrain-perimeter-contract.mjs';
import {deliverCompleteCoherentTerrain,verifyCompleteCoherentTerrain} from './coherent-terrain.mjs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {check,digest,exact,hash,id,isDigest,imageRef,jsonBytes,seal,unseal,receipt as validateReceipt} from './generation/common.mjs';
import {checkReferenceObservationCoverage,assertReferenceObservationCoverage} from './generation/reference-observation-coverage.mjs';
import {checkCaptureBinding} from './coherent-capture-binding.mjs';
import {assertRecompositionReview} from './generation/recomposition-review.mjs';
import * as flow from './generation/index.mjs';
import * as reference from './reference-led-pipeline.mjs';
import {COHERENT_POLICY,validateCoherentRequirements} from './generation/coherent-source.mjs';
import {coherentCanvasGutterOptions} from './generation/coherent-canvas-gutter.mjs';
import {LAYER_SOURCE_INTENT,LAYER_SOURCE_POLICY,createLayerSourceScopes,validateLayerSourceScopes,withVisualCoherenceScopes} from './generation/layer-source.mjs';
import {VISUAL_COHERENCE_POLICY,VISUAL_COHERENCE_ENGINEERED_POLICY,createVisualCoherence,validateVisualObservations} from './generation/visual-coherence.mjs';
import {createCoherentComposition,createMeasuredCoherentComposition,createFeatureCoherentComposition,validateCoherentComposition} from './coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from './terrain-proof/measured-field.mjs';
import {COHERENT_SAMPLING} from './coherent-sampling.mjs';
import {loadSceneKit,readMap,contextFor} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
import {renderCoherentFrame,coherentComparison} from './coherent-render.mjs';
import {writeProofBundle,verifyProofBundle} from './terrain-proof/bundle.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
export const COHERENT_ASSEMBLY_POLICY='reference-measured-surface-required-v1';
export const COHERENT_FINAL_REVIEW_POLICY='studio-recomposition-required-v1';
export function initCoherentPipeline(output,brief,options={}){
  const {sourceScopes:overrides,visualObservations:observed={},referenceGuidanceProfile,...baseBrief}=brief,prepared={...baseBrief,requirements:Object.hasOwn(brief.requirements,'sha256')?brief.requirements:seal(brief.requirements)};
  const guided=Object.hasOwn(brief,'referenceGuidanceProfile'),composition=referenceGuidanceProfile==='soft-composition-v3';
  check(!guided||referenceGuidanceProfile==='isolated-component-v2'||composition,'COHERENT_REFERENCE_GUIDANCE_PROFILE');
  const {compositionGuide,finalReviewPolicy,terrainIntentPolicy,...referenceOptions}=options;
  check(terrainIntentPolicy===undefined||[TERRAIN_INTENT_POLICY,TERRAIN_COMPLETION_POLICY].includes(terrainIntentPolicy),'TERRAIN_INTENT_POLICY');
  check(finalReviewPolicy===undefined||finalReviewPolicy===COHERENT_FINAL_REVIEW_POLICY,'COHERENT_FINAL_REVIEW_POLICY');
  if(composition){
    check(compositionGuide&&typeof compositionGuide==='object','COHERENT_COMPOSITION_GUIDE_REQUIRED');exact(compositionGuide,['bytes','receipt']);
    validateReceipt(compositionGuide.receipt,'review');
    const image=imageRef(compositionGuide.bytes,{allowCabx:true,allowHiddenRgb:true});
    check(compositionGuide.receipt.decision==='accept'&&compositionGuide.receipt.targetSha256===image.sha256,'COHERENT_COMPOSITION_GUIDE_APPROVAL');
    const size=image.pixelSize,frame=prepared.viewport;
    check(size.width<=4096&&size.height<=4096&&Math.abs(size.width*frame.height-size.height*frame.width)*1000<=(prepared.maxAspectErrorPermille??20)*size.height*frame.width,'COHERENT_COMPOSITION_GUIDE_FRAME');
  }else check(!Object.hasOwn(options,'compositionGuide'),'COHERENT_COMPOSITION_GUIDE_PROFILE');
  const engineered=observed.sceneFamily==='engineered-city',visualPolicy=engineered?VISUAL_COHERENCE_ENGINEERED_POLICY:VISUAL_COHERENCE_POLICY;
  const visualObservations=seal({format:engineered?'ai_scene_visual_observations_v2':'ai_scene_visual_observations_v1',policySha256:visualPolicy.sha256,
    origin:'explicit-brief-observations-not-automatic-image-analysis',observations:validateVisualObservations(observed)});
  validateCoherentRequirements(prepared.requirements);
  const sourceScopes=createLayerSourceScopes(prepared.requirements,overrides??[]);
  if(terrainIntentPolicy)assertTerrainIntentScopes(sourceScopes,{completionRequired:terrainIntentPolicy===TERRAIN_COMPLETION_POLICY});
  reference.initReferenceLedProject(output,prepared,referenceOptions);const project=parseJson(readSelectedFile(join(output,'project.json')));
  const guide=composition?flow.importCoherentCompositionGuide(join(output,'workflow'),{guideId:brief.projectId+'.composition.guide',specSha256:project.specSha256,receipt:compositionGuide.receipt},compositionGuide.bytes):null;
  const profile=seal({format:composition?'ai_scene_coherent_project_v7':guided?'ai_scene_coherent_project_v6':engineered?'ai_scene_coherent_project_v5':'ai_scene_coherent_project_v4',projectId:brief.projectId,referenceProjectSha256:project.sha256,policySha256:COHERENT_POLICY.sha256,sourceScopesSha256:sourceScopes.sha256,
    ...(guided?{referenceGuidanceProfile}:{}),
    ...(composition?{compositionGuideSha256:guide.sha256}:{}),...(finalReviewPolicy?{finalReviewPolicy}:{}),...(terrainIntentPolicy?{terrainIntentPolicy}:{}),
    visualCoherencePolicySha256:visualPolicy.sha256,visualObservationsSha256:visualObservations.sha256,assemblyPolicy:COHERENT_ASSEMBLY_POLICY});
  writeFreshFile(join(output,'coherent-project.json'),jsonBytes(profile),sourceRoot);writeFreshFile(join(output,'coherent-policy.json'),jsonBytes(COHERENT_POLICY),sourceRoot);
  writeFreshFile(join(output,'source-scopes.json'),jsonBytes(sourceScopes),sourceRoot);
  writeFreshFile(join(output,'visual-observations.json'),jsonBytes(visualObservations),sourceRoot);
  return inspectCoherentPipeline(output);
}
function observedDesignAt(root,{late=false,parent=null}={}){
  const path=join(root,late?'late-reference-decomposition.json':'observed-reference-design.json');if(!existsSync(path))return null;
  const value=parseJson(readSelectedFile(path)),v=unseal(value);
  exact(v,['format','originalProjectSha256','originalReferencePlanSha256','rawSha256','spec','sourceScopes','project','referenceProject','referencePlanSha256','receipt',...(late?['parentBatchSha256']:[])]);
  check(v.format===(late?'ai_scene_late_reference_decomposition_v1':'ai_scene_observed_reference_design_v1'),'OBSERVED_DESIGN_BINDING');
  const original=parent?.project??parseJson(readSelectedFile(join(root,'coherent-project.json')));unseal(original);
  check(original.sha256===v.originalProjectSha256&&original.projectId===v.project.projectId,'OBSERVED_DESIGN_BINDING');
  if(late)check(isDigest(v.parentBatchSha256)&&(!parent||parent.referencePlanSha256===v.originalReferencePlanSha256),'OBSERVED_DESIGN_BINDING');
  validateReceipt(v.receipt,'review');check(v.receipt.decision==='accept'&&v.receipt.targetSha256===v.spec.sha256,'OBSERVED_DESIGN_DECISION');
  return value;
}
function projectAt(root,{includeCurrentInputs=false,originalOnly=false}={}){
  const early=originalOnly?null:observedDesignAt(root);
  const late=originalOnly?null:observedDesignAt(root,{late:true,parent:early}),revision=late??early;
  const project=revision?.project??parseJson(readSelectedFile(join(root,'coherent-project.json'))),p=unseal(project),ref=revision?.referenceProject??parseJson(readSelectedFile(join(root,'project.json')));unseal(ref);
  const composition=p.format==='ai_scene_coherent_project_v7',guided=composition||p.format==='ai_scene_coherent_project_v6',engineered=p.format==='ai_scene_coherent_project_v5'||guided&&p.visualCoherencePolicySha256===VISUAL_COHERENCE_ENGINEERED_POLICY.sha256,
    visualPolicy=engineered?VISUAL_COHERENCE_ENGINEERED_POLICY:VISUAL_COHERENCE_POLICY;
  const measured=guided||engineered||p.format==='ai_scene_coherent_project_v4',visual=measured||p.format==='ai_scene_coherent_project_v3',scoped=visual||p.format==='ai_scene_coherent_project_v2';exact(p,['format','projectId','referenceProjectSha256','policySha256',...(scoped?['sourceScopesSha256']:[]),...(visual?['visualCoherencePolicySha256','visualObservationsSha256']:[]),...(measured?['assemblyPolicy']:[]),...(guided?['referenceGuidanceProfile']:[]),...(composition?['compositionGuideSha256']:[]),...(Object.hasOwn(p,'finalReviewPolicy')?['finalReviewPolicy']:[]),...(Object.hasOwn(p,'terrainIntentPolicy')?['terrainIntentPolicy']:[])]);
  check(['ai_scene_coherent_project_v1','ai_scene_coherent_project_v2','ai_scene_coherent_project_v3','ai_scene_coherent_project_v4','ai_scene_coherent_project_v5','ai_scene_coherent_project_v6','ai_scene_coherent_project_v7'].includes(p.format)&&p.referenceProjectSha256===ref.sha256&&p.projectId===ref.projectId&&p.policySha256===COHERENT_POLICY.sha256
    &&(!visual||p.visualCoherencePolicySha256===visualPolicy.sha256)&&(!measured||p.assemblyPolicy===COHERENT_ASSEMBLY_POLICY)
    &&(!guided||p.referenceGuidanceProfile===(composition?'soft-composition-v3':'isolated-component-v2'))&&(!composition||isDigest(p.compositionGuideSha256))
    &&(!Object.hasOwn(p,'finalReviewPolicy')||measured&&p.finalReviewPolicy===COHERENT_FINAL_REVIEW_POLICY),'COHERENT_PROJECT');
  check(p.terrainIntentPolicy===undefined||[TERRAIN_INTENT_POLICY,TERRAIN_COMPLETION_POLICY].includes(p.terrainIntentPolicy),'TERRAIN_INTENT_POLICY');
  const policy=parseJson(readSelectedFile(join(root,'coherent-policy.json')));unseal(policy);check(policy.sha256===p.policySha256,'COHERENT_PROJECT');
  const spec=revision?.spec??parseJson(readSelectedFile(join(root,'spec-draft.json')));unseal(spec);check(spec.sha256===ref.specSha256,'COHERENT_PROJECT');validateCoherentRequirements(spec.requirements);
  for(const [name,sha]of [['style-draft',ref.styleSha256],['capabilities',ref.capabilitiesSha256]]){const v=parseJson(readSelectedFile(join(root,name+'.json')));unseal(v);check(v.sha256===sha,'COHERENT_PROJECT');}
  const sourceScopes=scoped?(revision?.sourceScopes??parseJson(readSelectedFile(join(root,'source-scopes.json')))):null;
  if(scoped){validateLayerSourceScopes(spec.requirements,sourceScopes);check(sourceScopes.sha256===p.sourceScopesSha256,'COHERENT_PROJECT');}
  if(p.terrainIntentPolicy)assertTerrainIntentScopes(sourceScopes,{completionRequired:p.terrainIntentPolicy===TERRAIN_COMPLETION_POLICY});
  const visualObservations=visual?parseJson(readSelectedFile(join(root,'visual-observations.json'))):null;
  if(visual){const body=unseal(visualObservations);exact(body,['format','policySha256','origin','observations']);
    check(visualObservations.sha256===p.visualObservationsSha256&&body.format===(engineered?'ai_scene_visual_observations_v2':'ai_scene_visual_observations_v1')
      &&body.policySha256===visualPolicy.sha256&&body.origin==='explicit-brief-observations-not-automatic-image-analysis'
      &&engineered===(body.observations.sceneFamily==='engineered-city'),'COHERENT_PROJECT');validateVisualObservations(body.observations);}
  const workflow=join(root,'workflow'),view=flow.readCoherentWorkflowView(workflow,{includeCurrentInputs}),state=view.inspection;
  for(const entry of [early,late].filter(Boolean)){
    const prior=view.plans.find(p=>p.sha256===entry.originalReferencePlanSha256),next=view.plans.find(p=>p.sha256===entry.referencePlanSha256);
    const old=state.plans.find(p=>p.planSha256===entry.originalReferencePlanSha256),current=state.plans.find(p=>p.planSha256===entry.referencePlanSha256);
    check(prior&&next?.format==='ai_scene_reference_candidate_v1'&&next.recipe.specSha256===entry.spec.sha256
      &&old?.rawSha256===entry.rawSha256&&old.technicalStatus==='pass'&&current?.rawSha256===entry.rawSha256
      &&next.recipe.rawInput.sha256===entry.rawSha256
      &&next.designReviews.spec===seal({format:'ai_scene_design_review_v1',kind:'spec',receipt:entry.receipt}).sha256,'OBSERVED_DESIGN_BINDING');
  }
  if(late)check(view.batches.some(b=>b.sha256===late.parentBatchSha256&&b.referencePlanSha256===late.originalReferencePlanSha256),'OBSERVED_DESIGN_BINDING');
  check(!composition||state.compositionGuides?.some(guide=>guide.sha256===p.compositionGuideSha256&&guide.specSha256===ref.specSha256&&guide.requirementsSha256===spec.requirements.sha256),'COHERENT_COMPOSITION_GUIDE_BINDING');
  check(composition||!state.compositionGuides?.some(guide=>guide.specSha256===ref.specSha256),'COHERENT_COMPOSITION_GUIDE_BINDING');
  const currentReference=state.plans.findLast(entry=>entry.current&&entry.stage==='reference');
  check(!currentReference||(guided?currentReference.referenceGuidanceProfile===p.referenceGuidanceProfile&&(!composition||currentReference.compositionGuideSha256===p.compositionGuideSha256):!Object.hasOwn(currentReference,'referenceGuidanceProfile')),'COHERENT_REFERENCE_GUIDANCE_BINDING');
  check(state.projectId===p.projectId,'COHERENT_PROJECT');return {project,referenceProject:ref,spec,workflow,state,sourceScopes,visualObservations,view,late};
}
function visualScopesAt(root,{workflow,spec,sourceScopes,visualObservations,project},referencePlanSha256,observations=null){
  if(project?.terrainIntentPolicy)assertTerrainIntentScopes(sourceScopes,{completionRequired:project.terrainIntentPolicy===TERRAIN_COMPLETION_POLICY});
  const style=parseJson(readSelectedFile(join(root,'style-draft.json'))),target=flow.getReferenceReconstructionTarget(workflow,referencePlanSha256);
  let selectedObservations=observations??visualObservations?.observations??{};
  if(observations!==null&&visualObservations?.observations.sceneFamily==='engineered-city'){
    validateVisualObservations(observations);
    selectedObservations={sceneFamily:'engineered-city',...observations};
  }
  return withVisualCoherenceScopes(spec.requirements,sourceScopes??createLayerSourceScopes(spec.requirements),createVisualCoherence(spec,style,target,
    selectedObservations));
}
function coherentInspection(context){
  const {project,referenceProject:rp,state,sourceScopes,visualObservations,view}=context,ref=state.plans.findLast(p=>p.current&&p.stage==='reference');
  const batches=view.batches.filter(b=>b.referencePlanSha256===ref?.planSha256);
  const batch=batches.at(-1),sources=batch?.planSha256s.map(sha=>state.plans.find(p=>p.planSha256===sha))??[];
  const terrainIntent=view.plans.find(p=>batch?.planSha256s.includes(p.sha256)&&p.instanceBinding?.role==='material')?.recipe.sourceScope?.terrainIntent
    ??sourceScopes?.subjects.find(s=>s.role==='ground')?.terrainIntent;
  let stage='awaiting-design-review';
  if(state.activeSpecSha256===rp.specSha256&&state.activeStyleSha256===rp.styleSha256){
    stage=!ref?'reference-plan-needed':ref.status==='planned'?'awaiting-reference-compute':ref.status==='authorized'?'ready-to-generate-reference':ref.status==='pending-visual-review'?'awaiting-reference-review':ref.status!=='accepted'?'attention-required'
      :!batch?'source-batch-needed':sources.some(s=>!s?.current||['failed','indeterminate','rejected-technical','rejected-visual','reserved','submitted'].includes(s.status))?'attention-required'
      :sources.every(s=>s.received)?'ready-to-deliver':sources.some(s=>s.status==='planned')?'awaiting-source-compute':'ready-to-generate-sources';
  }
  return {format:'ai_scene_coherent_status_v1',projectId:project.projectId,stage,policySha256:COHERENT_POLICY.sha256,
    ...(project.finalReviewPolicy?{finalReviewPolicy:project.finalReviewPolicy}:{}),
    ...(project.terrainIntentPolicy?{terrainIntentPolicy:project.terrainIntentPolicy}:{}),
    ...(project.terrainIntentPolicy===TERRAIN_COMPLETION_POLICY?{terrainCompletion:{usage:terrainIntent.usage,
      perimeterRequired:needsCompleteTerrain(terrainIntent),materialStageDoesNotCertifyBrush:true}}:{}),
    ...(project.referenceGuidanceProfile?{referenceGuidanceProfile:project.referenceGuidanceProfile}:{}),
    ...(project.format==='ai_scene_coherent_project_v7'?{compositionGuideSha256:project.compositionGuideSha256}:{}),
    design:{specSha256:rp.specSha256,styleSha256:rp.styleSha256},reference:ref??null,batchSha256:batch?.sha256??null,sources,
    maximumSourceCalls:batch?.maximumCalls??null,remainingSourceCalls:sources.filter(s=>!s.received).length,eventCount:state.eventCount,
    ...(sourceScopes?{sourcePlanning:{profile:LAYER_SOURCE_INTENT,policySha256:LAYER_SOURCE_POLICY.sha256,scopesSha256:sourceScopes.sha256,subjects:sourceScopes.subjects,
      ...(['ai_scene_coherent_project_v3','ai_scene_coherent_project_v4','ai_scene_coherent_project_v5','ai_scene_coherent_project_v6','ai_scene_coherent_project_v7'].includes(project.format)?{visualCoherencePolicySha256:project.visualCoherencePolicySha256,visualObservations,
        assemblyProfile:['ai_scene_coherent_project_v4','ai_scene_coherent_project_v5','ai_scene_coherent_project_v6','ai_scene_coherent_project_v7'].includes(project.format)?'reference-surfaces-and-measured-material-v1':'reference-surfaces-and-joined-material-v1'}:{})}}:{}),
    ...(['ai_scene_coherent_project_v4','ai_scene_coherent_project_v5','ai_scene_coherent_project_v6','ai_scene_coherent_project_v7'].includes(project.format)?{assemblyRequirements:{policy:COHERENT_ASSEMBLY_POLICY,surfaceMappingRequired:true,
      observationInput:'explicit-reference-and-material-observations',generationCalls:0,automaticCalibration:false}}:{}),
    geometryAnalysis:'agent-or-explicit-host-planner-data-not-pixel-segmentation',fullArtAcceptance:'not-assessed',automaticRetry:false,productionKit:false};
}
export const inspectCoherentPipeline=root=>coherentInspection(projectAt(root));
export function previewObservedReferenceDesign(root,{revisionId,requirements,sourceScopes:overrides,parentBatchSha256}){
  const late=parentBatchSha256!==undefined;
  id(revisionId);check(!existsSync(join(root,late?'late-reference-decomposition.json':'observed-reference-design.json')),'OBSERVED_DESIGN_EXISTS');
  const context=projectAt(root),status=coherentInspection(context);
  check(context.project.format==='ai_scene_coherent_project_v4'&&status.reference?.technicalStatus==='pass'
    &&(late?status.stage==='ready-to-deliver'&&isDigest(parentBatchSha256)&&status.batchSha256===parentBatchSha256
      :!context.late&&status.stage==='awaiting-reference-review'&&!status.batchSha256),'OBSERVED_DESIGN_STATE');
  const req=Object.hasOwn(requirements,'sha256')?requirements:seal(requirements);validateCoherentRequirements(req);
  // Only decomposition changes: the original scene standards remain binding.
  check(digest(req.standards)===digest(context.spec.requirements.standards)
    &&digest(req.compositionNotes)===digest(context.spec.requirements.compositionNotes),'OBSERVED_DESIGN_STANDARDS');
  const spec=seal({...unseal(context.spec),specId:context.project.projectId+'.spec.'+revisionId,requirements:req});
  const scopes=createLayerSourceScopes(req,overrides);
  if(context.project.terrainIntentPolicy)assertTerrainIntentScopes(scopes,{completionRequired:context.project.terrainIntentPolicy===TERRAIN_COMPLETION_POLICY});
  const referenceProject=seal({...unseal(context.referenceProject),specSha256:spec.sha256,requirementsSha256:req.sha256});
  const project=seal({...unseal(context.project),referenceProjectSha256:referenceProject.sha256,sourceScopesSha256:scopes.sha256});
  return seal({format:'ai_scene_observed_reference_design_proposal_v1',revisionId,originalProjectSha256:context.project.sha256,
    originalReferencePlanSha256:status.reference.planSha256,rawSha256:status.reference.rawSha256,spec,sourceScopes:scopes,project,referenceProject,generationCalls:0,
    ...(late?{parentBatchSha256}:{})});
}
export function adoptObservedCoherentReferenceDesign(root,input,receipt){
  const proposal=previewObservedReferenceDesign(root,input),context=projectAt(root);
  const late=Object.hasOwn(proposal,'parentBatchSha256');
  validateReceipt(receipt,'review');check(receipt.decision==='accept'&&receipt.targetSha256===proposal.spec.sha256,'OBSERVED_DESIGN_DECISION');
  const adopted=flow.adoptObservedReferenceDesign(context.workflow,{sourcePlanSha256:proposal.originalReferencePlanSha256,spec:proposal.spec,receipt,
    options:{planId:context.project.projectId+'.observed.'+input.revisionId,parents:[],capabilitiesSha256:context.referenceProject.capabilitiesSha256,
      pixelPolicy:{mode:'native-reference',orientation:'landscape',minimumShortEdge:Math.max(256,context.spec.viewport.height),maximumWidth:4096,maximumHeight:4096},
      intent:'Existing exact reference bytes; explicitly revised source decomposition, no new image compute.'},...(late?{parentBatchSha256:proposal.parentBatchSha256}:{})});
  const record=seal({format:late?'ai_scene_late_reference_decomposition_v1':'ai_scene_observed_reference_design_v1',originalProjectSha256:proposal.originalProjectSha256,
    originalReferencePlanSha256:proposal.originalReferencePlanSha256,rawSha256:proposal.rawSha256,spec:proposal.spec,sourceScopes:proposal.sourceScopes,
    project:proposal.project,referenceProject:proposal.referenceProject,referencePlanSha256:adopted.plan.sha256,receipt,
    ...(late?{parentBatchSha256:proposal.parentBatchSha256}:{})});
  writeFreshFile(join(root,late?'late-reference-decomposition.json':'observed-reference-design.json'),jsonBytes(record),sourceRoot);
  return inspectCoherentPipeline(root);
}
const coveragePath=(root,context,kind)=>join(root,context.late?`late-reference-observation-${kind}.json`:`reference-observation-${kind}.json`);
function checkedCoverageMarker(root,context,referencePlanSha256){
  const path=coveragePath(root,context,'required');if(!existsSync(path))return null;
  const marker=parseJson(readSelectedFile(path)),body=unseal(marker);exact(body,['format','projectId','referencePlanSha256']);
  check(body.format==='ai_scene_reference_observation_required_v1'&&body.projectId===context.project.projectId&&body.referencePlanSha256===referencePlanSha256,'COHERENT_OBSERVATION_MARKER');return marker;
}
function requireReferenceCoverage(root,context,referencePlanSha256,scopes){
  if(!checkedCoverageMarker(root,context,referencePlanSha256))return;
  const path=coveragePath(root,context,'accepted');check(existsSync(path),'COHERENT_OBSERVATION_COVERAGE_REQUIRED');
  const accepted=parseJson(readSelectedFile(path)),v=unseal(accepted);exact(v,['format','projectId','referencePlanSha256','requiredObservationIds','observations','assignments','report']);
  check(v.format==='ai_scene_reference_observation_accepted_v1'&&v.projectId===context.project.projectId&&v.referencePlanSha256===referencePlanSha256,'COHERENT_OBSERVATION_COVERAGE_STALE');
  const reference=flow.getGenerationResult(context.workflow,referencePlanSha256);
  assertReferenceObservationCoverage({referenceBytes:reference.bytes,requirements:context.spec.requirements,sourceScopes:scopes,
    requiredObservationIds:v.requiredObservationIds,observations:v.observations,assignments:v.assignments},v.report);
}
export function checkCoherentObservationCoverage(root,data){
  exact(data,['requiredObservationIds','observations','assignments']);const context=projectAt(root),status=coherentInspection(context),ref=status.reference;
  check(status.stage==='source-batch-needed'&&ref?.status==='accepted'&&checkedCoverageMarker(root,context,ref.planSha256),'COHERENT_OBSERVATION_STATE');
  const scopes=['ai_scene_coherent_project_v3','ai_scene_coherent_project_v4','ai_scene_coherent_project_v5','ai_scene_coherent_project_v6','ai_scene_coherent_project_v7'].includes(context.project.format)?visualScopesAt(root,context,ref.planSha256):context.sourceScopes;
  check(scopes,'COHERENT_OBSERVATION_SCOPES');const reference=flow.getGenerationResult(context.workflow,ref.planSha256);
  const report=checkReferenceObservationCoverage({...data,referenceBytes:reference.bytes,requirements:context.spec.requirements,sourceScopes:scopes});
  if(report.status==='pass'){
    const record=seal({format:'ai_scene_reference_observation_accepted_v1',projectId:context.project.projectId,referencePlanSha256:ref.planSha256,...data,report});
    const path=coveragePath(root,context,'accepted');if(existsSync(path))check(digest(parseJson(readSelectedFile(path)))===digest(record),'COHERENT_OBSERVATION_COVERAGE_STALE');else writeFreshFile(path,jsonBytes(record),sourceRoot);
  }
  return report;
}
export function advanceCoherentPipeline(root){
  const status=inspectCoherentPipeline(root),context=projectAt(root),{project,referenceProject:rp,workflow,spec,sourceScopes}=context;
  if(status.stage==='reference-plan-needed'){
    const options={planId:project.projectId+'.reference',parents:[],capabilitiesSha256:rp.capabilitiesSha256,
      pixelPolicy:{mode:'native-reference',orientation:'landscape',minimumShortEdge:Math.max(256,spec.viewport.height),maximumWidth:4096,maximumHeight:4096},intent:'Overall coherent reference-led scene; no pixel-exact asset matching.'};
    if(project.format==='ai_scene_coherent_project_v7')flow.freezeCoherentReferenceV3(workflow,{...options,referenceGuidanceProfile:project.referenceGuidanceProfile,compositionGuideSha256:project.compositionGuideSha256});
    else if(project.format==='ai_scene_coherent_project_v6')flow.freezeCoherentReferenceV2(workflow,{...options,referenceGuidanceProfile:project.referenceGuidanceProfile});
    else flow.freezeCoherentReference(workflow,options);
  }
  if(status.stage==='source-batch-needed'){
    const scopes=['ai_scene_coherent_project_v3','ai_scene_coherent_project_v4','ai_scene_coherent_project_v5','ai_scene_coherent_project_v6','ai_scene_coherent_project_v7'].includes(project.format)?visualScopesAt(root,context,status.reference.planSha256):sourceScopes;
    requireReferenceCoverage(root,context,status.reference.planSha256,scopes);
    flow.freezeCoherentSources(workflow,{batchId:'sources.'+status.reference.planSha256.slice(0,20),referencePlanSha256:status.reference.planSha256,capabilitiesSha256:rp.capabilitiesSha256,...(scopes?{sourceScopes:scopes}:{})});
  }
  return inspectCoherentPipeline(root);
}
export function reviewCoherentDesign(root,receipts){const {workflow,referenceProject:p}=projectAt(root);exact(receipts,['spec','style']);
  check(receipts.spec.targetSha256===p.specSha256&&receipts.style.targetSha256===p.styleSha256,'COHERENT_DESIGN_TARGET');
  flow.reviewSceneDesigns(workflow,receipts);return advanceCoherentPipeline(root);}
export function prepareCoherentReferenceReview(root,analysis,output){const {workflow}=projectAt(root),status=inspectCoherentPipeline(root);
  check(status.stage==='awaiting-reference-review','COHERENT_REFERENCE_REVIEW_STATE');return flow.buildMeasuredReferenceReview(workflow,status.reference.planSha256,analysis,output);}
export function reviewCoherentReference(root,analysis,receipt,{deferObservationCoverage=false}={}){const context=projectAt(root),{workflow}=context,status=coherentInspection(context);
  check(status.stage==='awaiting-reference-review'&&typeof deferObservationCoverage==='boolean','COHERENT_REFERENCE_REVIEW_STATE');
  check(!context.late||deferObservationCoverage,'COHERENT_OBSERVATION_COVERAGE_REQUIRED');
  if(deferObservationCoverage){validateReceipt(receipt,'review');}
  if(deferObservationCoverage&&receipt.decision==='accept'){
    const marker=seal({format:'ai_scene_reference_observation_required_v1',projectId:context.project.projectId,referencePlanSha256:status.reference.planSha256}),path=coveragePath(root,context,'required');
    if(existsSync(path))check(digest(parseJson(readSelectedFile(path)))===digest(marker),'COHERENT_OBSERVATION_MARKER');else writeFreshFile(path,jsonBytes(marker),sourceRoot);
  }
  flow.reviewMeasuredReference(workflow,status.reference.planSha256,analysis,receipt);return deferObservationCoverage?inspectCoherentPipeline(root):advanceCoherentPipeline(root);}
export function authorizeCoherentStage(root,receipt){const status=advanceCoherentPipeline(root),{workflow}=projectAt(root);
  if(status.stage==='awaiting-reference-compute'){check(receipt.targetSha256===status.reference.planSha256,'COHERENT_COMPUTE_TARGET');flow.authorizePlan(workflow,status.reference.planSha256,receipt);}
  else{check(status.stage==='awaiting-source-compute'&&receipt.targetSha256===status.batchSha256,'COHERENT_COMPUTE_TARGET');flow.authorizeReferenceAssetBatch(workflow,status.batchSha256,receipt);}
  return inspectCoherentPipeline(root);}

function lateReuseInputs(root,assetId){
  id(assetId);
  const context=projectAt(root),status=coherentInspection(context),{late,view,workflow}=context;
  check(late&&status.stage==='awaiting-source-compute','OBSERVED_DESIGN_REUSE_STATE');
  const find=batchSha=>view.batches.find(b=>b.sha256===batchSha)?.planSha256s
    .map(sha=>view.plans.find(p=>p.sha256===sha)).find(p=>p.recipe.assetId===assetId);
  const source=find(late.parentBatchSha256),target=find(status.batchSha256);
  const ownership=plan=>{
    const {requirementsSha256,visualCoherence,...value}=unseal(plan.recipe.sourceScope);
    return digest(value);
  };
  check(source&&target&&source.recipe.sourceScope&&target.recipe.sourceScope
    &&ownership(source)===ownership(target),'OBSERVED_DESIGN_REUSE_SCOPE');
  return {workflow,parentBatchSha256:status.batchSha256,options:{sourceWorkflow:workflow,sourcePlanSha256:source.sha256,
    targetPlanSha256:target.sha256,targetSha256:target.recipe.targetSha256,scopeSha256:target.recipe.sourceScope.sha256,
    historicalBatchSha256:late.parentBatchSha256}};
}
export function previewLateCoherentSourceReuse(root,assetId){
  const {workflow,options}=lateReuseInputs(root,assetId);
  return flow.proposeCoherentRebind(workflow,options).proposal;
}
export function adoptLateCoherentSourceReuse(root,assetId,{proposal,receipt,rebindId,batchId}){
  const {workflow,parentBatchSha256,options}=lateReuseInputs(root,assetId);
  return flow.commitCoherentRebind(workflow,{...options,parentBatchSha256,proposal,receipt,rebindId,batchId});
}
export async function runCoherentStage(root,adapter,{onProgress=()=>{}}={}){
  check(adapter&&typeof adapter.preflight==='function'&&typeof adapter.generate==='function','PIPELINE_ADAPTER_REQUIRED');
  const status=advanceCoherentPipeline(root),{workflow}=projectAt(root);check(['ready-to-generate-reference','ready-to-generate-sources'].includes(status.stage),'PIPELINE_NOT_AUTHORIZED');
  await adapter.preflight();const shas=status.stage==='ready-to-generate-reference'?[status.reference.planSha256]:flow.getCoherentSourceBatch(workflow,status.batchSha256).planSha256s;
  for(const sha of shas){const entry=flow.inspectWorkflow(workflow).plans.find(p=>p.planSha256===sha);if(entry.received)continue;
    check(entry.status==='authorized','PIPELINE_NOT_AUTHORIZED');const {request,...ticket}=flow.reservePlan(workflow,sha);flow.recordSubmission(workflow,ticket);onProgress({phase:'submitted',planSha256:sha});
    let bytes;try{bytes=await adapter.generate({...ticket,request,images:request.images.map((i,n)=>({...i,bytes:flow.readGenerationInput(workflow,sha,n)}))});
      check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=16777216,'PIPELINE_ADAPTER_OUTPUT');}
    catch{flow.stopAttempt(workflow,ticket,'indeterminate');return inspectCoherentPipeline(root);}
    const result=flow.receiveResult(workflow,ticket,bytes);onProgress({phase:'received',planSha256:sha,technicalStatus:result.technical.status});
    if(result.technical.status!=='pass')return inspectCoherentPipeline(root);
  }
  return inspectCoherentPipeline(root);
}
function preparedSourceForComputeReview(plan){
  if(plan.format!=='ai_scene_coherent_rebind_v1')return plan;
  // A rebind record contains a private review receipt and free-form operator
  // notes. Publish only the identities needed to trace the zero-call source.
  return seal({format:'ai_scene_coherent_rebind_compute_evidence_v1',rebindSha256:plan.sha256,
    targetPlanSha256:plan.targetPlanSha256,targetSha256:plan.recipe.targetSha256,
    sourcePlanSha256:plan.sourceEvidence.source.planSha256,sourceEvidenceSha256:plan.sourceEvidence.sha256,
    rawSha256:plan.rawSha256,technicalSha256:plan.technical.sha256,proposalSha256:plan.proposal.sha256,
    request:{format:'ai_scene_no_generation_request_v1',maximumCalls:0},
    sourceVisualAcceptance:'not-transferred',finalArtAcceptance:'not-assessed'});
}
function computeSnapshot(context){const status=coherentInspection(context),{view}=context;
  check(['awaiting-reference-compute','awaiting-source-compute','ready-to-generate-reference','ready-to-generate-sources'].includes(status.stage),'COHERENT_COMPUTE_STATE');
  const batch=status.batchSha256?view.batches.find(batch=>batch.sha256===status.batchSha256):null;
  const bySha=new Map(view.plans.map(plan=>[plan.sha256,plan]));
  const shas=status.stage.includes('reference')?[status.reference.planSha256]:batch.planSha256s;
  if(['ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(batch?.format)&&!status.stage.includes('reference')){
    const all=shas.map(s=>bySha.get(s)),plans=all.filter(p=>p.request.maximumCalls>0),preparedSources=all.filter(p=>p.request.maximumCalls===0).map(preparedSourceForComputeReview);
    const newAuthorizationRequiredPlanSha256s=status.sources.filter(s=>s.status==='planned'&&s.maximumCalls>0).map(s=>s.planSha256);
    return seal({format:'ai_scene_coherent_compute_snapshot_v2',projectId:status.projectId,targetSha256:batch.sha256,policy:COHERENT_POLICY,
      plans,preparedSources,maximumCalls:plans.reduce((n,p)=>n+p.request.maximumCalls,0),remainingCalls:status.remainingSourceCalls,
      authorizationUsage:newAuthorizationRequiredPlanSha256s.length?'new-digest-bound-authorization-required':'existing-unsubmitted-authorizations-only',newAuthorizationRequiredPlanSha256s,
      unusedAuthorizationPlanSha256s:status.sources.filter(s=>s.status==='authorized'&&!s.reserved&&s.maximumCalls>0).map(s=>s.planSha256),
      generationCalls:0,executable:false});
  }
  return seal({format:'ai_scene_coherent_compute_snapshot_v1',projectId:status.projectId,targetSha256:status.stage.includes('reference')?status.reference.planSha256:batch.sha256,
    policy:COHERENT_POLICY,plans:shas.map(s=>bySha.get(s)),maximumCalls:shas.length,remainingCalls:status.stage.includes('reference')?1:status.remainingSourceCalls,
    generationCalls:0,executable:false});}
export const coherentComputeSnapshot=root=>computeSnapshot(projectAt(root));
export function exportCoherentComputeReview(root,output){const context=projectAt(root,{includeCurrentInputs:true}),snapshot=computeSnapshot(context),{workflow,view}=context,files=new Map([['compute-snapshot.json',jsonBytes(snapshot)]]);
  const scoped=snapshot.plans.filter(p=>p.sourceScope?.profile===LAYER_SOURCE_INTENT);
  if(scoped.length)files.set('source-scope-review.json',jsonBytes(seal({format:'ai_scene_layer_source_review_v1',targetSha256:snapshot.targetSha256,policy:LAYER_SOURCE_POLICY,
    sources:scoped.map(p=>({planSha256:p.sha256,assetId:p.recipe.assetId,role:p.instanceBinding.role,alpha:p.target.alpha,scope:p.sourceScope.definition,
      observedEnvelope:p.instanceBinding.observedEnvelope,layoutUsage:'assembly-only-not-image-prompt',semanticIsolation:'requires-visual-review',
      ...(p.sourceScope.backgroundBandCoverage?{backgroundBandCoverage:p.sourceScope.backgroundBandCoverage,coverageAcceptance:'uncalibrated-no-derived-coverage-claim'}:{}),
      ...(p.sourceScope.backgroundBandGuideEvidence?{backgroundBandGuideEvidence:p.sourceScope.backgroundBandGuideEvidence}:{})})),generationCalls:0})));
  const visual=scoped.find(p=>p.sourceScope.definition.visualCoherence)?.sourceScope.definition.visualCoherence;
  if(visual)files.set('visual-coherence.json',jsonBytes(visual));
  for(const [index,p]of snapshot.plans.entries()){
    files.set(`prompt-${index+1}.txt`,Buffer.from(p.request.prompt));
    for(let n=0;n<p.request.images.length;n++){
      const ref=p.request.images[n].artifact,bytes=view.inputs.get(ref.sha256);check(bytes?.length===ref.byteLength,'IMAGE_REFERENCE');
      files.set(`input-${index+1}-${n+1}.png`,bytes);
    }
  }
  for(const [index,p]of (snapshot.preparedSources??[]).entries())files.set(`prepared-source-${index+1}.json`,jsonBytes(p));
  const bundle=seal({format:'ai_scene_coherent_compute_review_bundle_v1',snapshotSha256:snapshot.sha256,
    artifacts:[...files].map(([path,b])=>({path,sha256:hash(b),byteLength:b.length})),generationCalls:0});
  files.set('proof-bundle.json',jsonBytes(bundle));const prepared={files,bundle,report:snapshot};
  if(existsSync(output))verifyProofBundle(output,prepared);else writeProofBundle(output,workflow,prepared);
  return snapshot;
}
function coherentBorderReviewFiles(root,sourcePlanSha256,parentBatchSha256=null){
  const status=inspectCoherentPipeline(root),{project,workflow}=projectAt(root);
  const parent=flow.getCoherentSourceBatch(workflow,parentBatchSha256??status.batchSha256);
  check(parent.referencePlanSha256===status.reference?.planSha256&&parent.planSha256s.includes(sourcePlanSha256)
    &&(parentBatchSha256!==null||status.stage==='attention-required'),'COHERENT_BORDER_REVIEW_STATE');
  const {proposal,bytes}=flow.proposeCoherentBorderPreparation(workflow,sourcePlanSha256),original=flow.getGenerationResult(workflow,sourcePlanSha256),plan=flow.getGenerationPlan(workflow,sourcePlanSha256);
  const context=seal({format:'ai_scene_coherent_border_review_context_v1',projectId:project.projectId,coherentProjectSha256:project.sha256,
    parentBatchSha256:parent.sha256,sourcePlanSha256,proposalSha256:proposal.sha256,generationCalls:0});
  const files=new Map([['proposal.json',jsonBytes(proposal)],['review-context.json',jsonBytes(context)],['source-original.png',original.bytes],['preview-padded.png',bytes],
    ['original-plan.json',jsonBytes(plan)],['original-result.json',jsonBytes(original.result)]]);
  files.set('README.md',Buffer.from(['# 准确透明补框预览','',
    '本预览只在原画布外追加2px透明边框，原始RGBA整体平移(2,2)。不裁轮廓、不擦除低Alpha、不重画或恢复缺失部分。',
    '原始生成技术拒收保持；新准备记录不是一次成功生图，原生PNG、原QA与派生PNG分别保存。',
    '确认仅绑定proposal.json的准确摘要，采用后其余未使用的原计划授权仍各仅能调用一次。','',
    `提案摘要：${proposal.sha256}`,`父批次：${parent.sha256}`,'图片调用：0；本操作不预留或派发原批次的其他来源。',''].join('\n')));
  const bundle=seal({format:'ai_scene_coherent_border_review_bundle_v1',proposalSha256:proposal.sha256,contextSha256:context.sha256,
    artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),generationCalls:0});
  files.set('proof-bundle.json',jsonBytes(bundle));return {files,bundle,proposal,context,workflow};
}
export function exportCoherentBorderReview(root,sourcePlanSha256,output){
  const prepared=coherentBorderReviewFiles(root,sourcePlanSha256);
  if(existsSync(output))verifyProofBundle(output,prepared);else writeProofBundle(output,prepared.workflow,prepared);
  return {format:'ai_scene_coherent_border_review_v1',proposalSha256:prepared.proposal.sha256,bundleSha256:prepared.bundle.sha256,
    sourcePlanSha256,parentBatchSha256:prepared.context.parentBatchSha256,proposal:prepared.proposal,generationCalls:0};
}
export function applyCoherentBorderReview(root,reviewDirectory,receipt,{preparationId,batchId}){
  validateReceipt(receipt,'review');id(preparationId);id(batchId);
  const supplied=parseJson(readSelectedFile(join(reviewDirectory,'proposal.json')));unseal(supplied);
  const suppliedContext=parseJson(readSelectedFile(join(reviewDirectory,'review-context.json')));unseal(suppliedContext);
  const prepared=coherentBorderReviewFiles(root,supplied.sourcePlanSha256,suppliedContext.parentBatchSha256);verifyProofBundle(reviewDirectory,prepared);
  check(receipt.decision==='accept'&&receipt.targetSha256===prepared.proposal.sha256,'COHERENT_BORDER_APPROVAL_REQUIRED');
  const state=flow.inspectWorkflow(prepared.workflow),existing=state.plans.find(p=>p.planId===preparationId);
  let record;
  if(existing){record=flow.getGenerationPlan(prepared.workflow,existing.planSha256);
    check(record.format==='ai_scene_coherent_border_preparation_v1'&&record.sourcePlanSha256===supplied.sourcePlanSha256
      &&record.proposal.sha256===prepared.proposal.sha256&&hash(jsonBytes(record.receipt))===hash(jsonBytes(receipt)),'COHERENT_BORDER_RESUME_MISMATCH');
  }
  const adopted=state.batches.map(sha=>{try{return flow.getCoherentSourceBatch(prepared.workflow,sha);}catch{return null;}}).find(b=>b?.batchId===batchId);
  if(adopted){check(record&&['ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(adopted.format)&&adopted.parentBatchSha256===prepared.context.parentBatchSha256
      &&adopted.planSha256s.includes(record.sha256)&&inspectCoherentPipeline(root).batchSha256===adopted.sha256,'COHERENT_BORDER_RESUME_MISMATCH');
    return {...inspectCoherentPipeline(root),preparationSha256:record.sha256,preparedBatchSha256:adopted.sha256,reusedVerifiedPreparation:true,generationCalls:0};
  }
  check(inspectCoherentPipeline(root).batchSha256===prepared.context.parentBatchSha256,'COHERENT_BORDER_REVIEW_STATE');
  let batch;
  if(!record){const applied=flow.prepareAndAdoptCoherentBorderSource(prepared.workflow,{preparationId,proposal:prepared.proposal,receipt,parentBatchSha256:prepared.context.parentBatchSha256,batchId});
    record=applied.record;batch=applied.batch;
  }else batch=flow.adoptCoherentPreparedSource(prepared.workflow,prepared.context.parentBatchSha256,record.sha256,batchId);
  return {...inspectCoherentPipeline(root),preparationSha256:record.sha256,preparedBatchSha256:batch.sha256,generationCalls:0};
}
function coherentCanvasGutterReviewFiles(root,sourcePlanSha256,parentBatchSha256=null,options={}){
  const status=inspectCoherentPipeline(root),{project,workflow}=projectAt(root);
  const parent=flow.getCoherentSourceBatch(workflow,parentBatchSha256??status.batchSha256);
  check(parent.referencePlanSha256===status.reference?.planSha256&&parent.planSha256s.includes(sourcePlanSha256)
    &&!status.sources.some(p=>p.reserved&&!p.received),'COHERENT_CANVAS_GUTTER_REVIEW_STATE');
  const {proposal,bytes,previews}=flow.proposeCoherentCanvasGutterPreparation(workflow,sourcePlanSha256,parent.sha256,options),
    original=flow.getGenerationResult(workflow,sourcePlanSha256),plan=flow.getGenerationPlan(workflow,sourcePlanSha256);
  const v2=proposal.format==='ai_scene_coherent_canvas_gutter_proposal_v2',version=v2?'v2':'v1';
  const context=seal({format:'ai_scene_coherent_canvas_gutter_review_context_'+version,projectId:project.projectId,coherentProjectSha256:project.sha256,
    parentBatchSha256:parent.sha256,sourcePlanSha256,proposalSha256:proposal.sha256,generationCalls:0});
  const files=new Map([['proposal.json',jsonBytes(proposal)],['review-context.json',jsonBytes(context)],['source-original.png',original.bytes],['preview-padded.png',bytes],
    ['preview-original-checkerboard.png',previews.original],['preview-padded-checkerboard.png',previews.padded],
    ['original-plan.json',jsonBytes(plan)],['original-result.json',jsonBytes(original.result)]]);
  files.set('README.md',Buffer.from(['# 准确透明画布留白预览','',
    '只在整张原画布四边追加零RGBA，使原画布在新画布内各边至少12%透明留白。全部原RGBA按整数偏移复制，不裁/缩放/擦除Alpha、不调色、不恢复缺失轮廓。',
    v2?'低Alpha v2仅处理原QA唯一裁边失败、外2px最大Alpha为2–7、Alpha≥8主体四边至少2px的已接收透明来源。原失败、全部弱Alpha尾迹与隐藏RGB保持；不恢复缺失形状，不构成美术接受。'
      :'正确Alpha合成的棋盘格预览用于诊断；原始PNG、原技术pass和原美术决定保持，新准备记录不构成生图或最终美术接受。',
    '请先确认主体完整且只属于自身层，再接受准确proposal摘要。采用后原未使用计划/单次授权保持。','',
    `提案摘要：${proposal.sha256}`,`父批次：${parent.sha256}`,`原尺寸：${proposal.originalPixelSize.width}×${proposal.originalPixelSize.height}`,
    `新尺寸：${proposal.paddedPixelSize.width}×${proposal.paddedPixelSize.height}`,`内容偏移：${proposal.contentOffset.x},${proposal.contentOffset.y}`,
    '图片调用：0；不预留或派发其他来源。',''].join('\n')));
  const bundle=seal({format:'ai_scene_coherent_canvas_gutter_review_bundle_'+version,proposalSha256:proposal.sha256,contextSha256:context.sha256,
    artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),generationCalls:0});
  files.set('proof-bundle.json',jsonBytes(bundle));return {files,bundle,proposal,context,workflow};
}
export function exportCoherentCanvasGutterReview(root,sourcePlanSha256,output,options={}){
  const prepared=coherentCanvasGutterReviewFiles(root,sourcePlanSha256,null,options);
  if(existsSync(output))verifyProofBundle(output,prepared);else writeProofBundle(output,prepared.workflow,prepared);
  return {format:prepared.proposal.format==='ai_scene_coherent_canvas_gutter_proposal_v2'?'ai_scene_coherent_canvas_gutter_review_v2':'ai_scene_coherent_canvas_gutter_review_v1',proposalSha256:prepared.proposal.sha256,bundleSha256:prepared.bundle.sha256,
    sourcePlanSha256,parentBatchSha256:prepared.context.parentBatchSha256,proposal:prepared.proposal,generationCalls:0};
}
export function applyCoherentCanvasGutterReview(root,reviewDirectory,receipt,{preparationId,batchId}){
  validateReceipt(receipt,'review');id(preparationId);id(batchId);
  const supplied=parseJson(readSelectedFile(join(reviewDirectory,'proposal.json')));unseal(supplied);
  const suppliedContext=parseJson(readSelectedFile(join(reviewDirectory,'review-context.json')));unseal(suppliedContext);
  check(supplied.parentBatchSha256===suppliedContext.parentBatchSha256,'COHERENT_CANVAS_GUTTER_REVIEW_BINDING');
  const prepared=coherentCanvasGutterReviewFiles(root,supplied.sourcePlanSha256,suppliedContext.parentBatchSha256,coherentCanvasGutterOptions(supplied));verifyProofBundle(reviewDirectory,prepared);
  check(receipt.decision==='accept'&&receipt.targetSha256===prepared.proposal.sha256,'COHERENT_CANVAS_GUTTER_APPROVAL_REQUIRED');
  const state=flow.inspectWorkflow(prepared.workflow),existing=state.plans.find(p=>p.planId===preparationId);
  let record;
  if(existing){record=flow.getGenerationPlan(prepared.workflow,existing.planSha256);
    check(record.format===(supplied.format==='ai_scene_coherent_canvas_gutter_proposal_v2'?'ai_scene_coherent_canvas_gutter_preparation_v2':'ai_scene_coherent_canvas_gutter_preparation_v1')&&record.sourcePlanSha256===supplied.sourcePlanSha256
      &&record.proposal.sha256===prepared.proposal.sha256&&hash(jsonBytes(record.receipt))===hash(jsonBytes(receipt)),'COHERENT_CANVAS_GUTTER_RESUME_MISMATCH');
  }
  const adopted=state.batches.map(sha=>{try{return flow.getCoherentSourceBatch(prepared.workflow,sha);}catch{return null;}}).find(b=>b?.batchId===batchId);
  if(adopted){check(record&&['ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(adopted.format)&&adopted.parentBatchSha256===prepared.context.parentBatchSha256
      &&adopted.planSha256s.includes(record.sha256)&&inspectCoherentPipeline(root).batchSha256===adopted.sha256,'COHERENT_CANVAS_GUTTER_RESUME_MISMATCH');
    return {...inspectCoherentPipeline(root),preparationSha256:record.sha256,preparedBatchSha256:adopted.sha256,reusedVerifiedPreparation:true,generationCalls:0};
  }
  check(inspectCoherentPipeline(root).batchSha256===prepared.context.parentBatchSha256,'COHERENT_CANVAS_GUTTER_REVIEW_STATE');
  let batch;
  if(!record){const applied=flow.prepareAndAdoptCoherentCanvasGutterSource(prepared.workflow,{preparationId,proposal:prepared.proposal,receipt,parentBatchSha256:prepared.context.parentBatchSha256,batchId});
    record=applied.record;batch=applied.batch;
  }else batch=flow.adoptCoherentPreparedSource(prepared.workflow,prepared.context.parentBatchSha256,record.sha256,batchId);
  return {...inspectCoherentPipeline(root),preparationSha256:record.sha256,preparedBatchSha256:batch.sha256,generationCalls:0};
}
export function prepareCoherentSourceScopeReview(root,output,overrides=null){
  const context=projectAt(root),{project,referenceProject:rp,workflow,state,spec,sourceScopes:defaults}=context,ref=state.plans.findLast(p=>p.current&&p.stage==='reference');
  check(ref?.status==='accepted','COHERENT_REFERENCE_REQUIRED');
  const baseScopes=overrides===null?(defaults??createLayerSourceScopes(spec.requirements)):createLayerSourceScopes(spec.requirements,overrides);
  const sourceScopes=['ai_scene_coherent_project_v3','ai_scene_coherent_project_v4','ai_scene_coherent_project_v5','ai_scene_coherent_project_v6','ai_scene_coherent_project_v7'].includes(project.format)?visualScopesAt(root,{...context,sourceScopes:baseScopes},ref.planSha256):baseScopes;
  validateLayerSourceScopes(spec.requirements,sourceScopes);
  const options={batchId:'layer.scope.review.'+sourceScopes.sha256.slice(0,20),referencePlanSha256:ref.planSha256,capabilitiesSha256:rp.capabilitiesSha256};
  const after=flow.previewCoherentSources(workflow,{...options,sourceScopes}),before=flow.previewCoherentSources(workflow,{...options,batchId:options.batchId+'.legacy'});
  const reference=flow.getGenerationResult(workflow,ref.planSha256),files=new Map([['proposal.json',jsonBytes(after)],['source-scopes.json',jsonBytes(sourceScopes)],['input-reference.png',reference.bytes]]);
  check(hash(reference.bytes)===after.plans[0].referenceEvidence[0].rawSha256,'COHERENT_REFERENCE_BYTES');
  const rows=after.plans.map((plan,index)=>{const prefix=String(index+1).padStart(2,'0'),old=before.plans.find(p=>p.recipe.assetId===plan.recipe.assetId);check(old,'LAYER_SCOPE_COVERAGE');
    files.set(`prompts/${prefix}-before.txt`,Buffer.from(old.request.prompt));files.set(`prompts/${prefix}-after.txt`,Buffer.from(plan.request.prompt));
    return {assetId:plan.recipe.assetId,role:plan.instanceBinding.role,parentRole:plan.sourceScope.parentRole,alpha:plan.target.alpha,scope:plan.sourceScope.definition,
      beforePrompt:`prompts/${prefix}-before.txt`,afterPrompt:`prompts/${prefix}-after.txt`,planSha256:plan.sha256,observedEnvelope:plan.instanceBinding.observedEnvelope};});
  const report=seal({format:'ai_scene_layer_source_preview_v1',projectId:project.projectId,referencePlanSha256:ref.planSha256,rawSha256:hash(reference.bytes),targetSha256:after.batch.targetSha256,
    proposedBatchSha256:after.batch.sha256,sourceScopesSha256:sourceScopes.sha256,sources:rows,baseline:'legacy-first-batch-planning-not-existing-delivered-art',
    frozen:false,executable:false,generationCalls:0,semanticIsolation:'not-proven',artAcceptance:'not-assessed'});
  files.set('review.json',jsonBytes(report));files.set('README.md',Buffer.from(['# 单层来源提示审阅包','',
    '这是零生图的提示与分层职责对照；before是旧默认首批配方，after是新版隔离配方，不是两批图片的效果对比。',
    'input-reference.png保留已接受参考原字节；坐标仅用于后续回拼。当前没有冻结批次、授权计算或改变历史来源/决定。','',
    ...rows.map(r=>`- ${r.assetId}：${r.role} → ${r.parentRole}，${r.alpha}。提示：${r.beforePrompt} / ${r.afterPrompt}。`),
    '',`审阅摘要：${report.sha256}`,'模型是否遵守单层规则仍需新准确计划的真实计算与美术审阅，不由透明度检查推断。',''].join('\n')));
  const bundle=seal({format:'ai_scene_layer_source_preview_bundle_v1',reviewSha256:report.sha256,artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),generationCalls:0});
  files.set('proof-bundle.json',jsonBytes(bundle));const prepared={files,bundle,report};if(existsSync(output))verifyProofBundle(output,prepared);else writeProofBundle(output,workflow,prepared);return report;
}
// Compare the next versioned source contract without modifying old projects,
// freezing a batch, consuming authorization or submitting an image request.
export function prepareCoherentVisualReview(root,output,observations=null){
  const context=projectAt(root),{project,referenceProject:rp,workflow,state,spec}=context;
  const ref=state.plans.findLast(p=>p.current&&p.stage==='reference');check(ref?.status==='accepted','COHERENT_REFERENCE_REQUIRED');
  const scopes=visualScopesAt(root,context,ref.planSha256,observations),visual=scopes.visualCoherence;
  const options={batchId:'visual.review.'+scopes.sha256.slice(0,20),referencePlanSha256:ref.planSha256,capabilitiesSha256:rp.capabilitiesSha256};
  const after=flow.previewCoherentSources(workflow,{...options,sourceScopes:scopes});
  const before=flow.previewCoherentSources(workflow,{...options,batchId:options.batchId+'.v4',sourceScopes:context.sourceScopes??createLayerSourceScopes(spec.requirements)});
  const files=new Map([['proposal.json',jsonBytes(after)],['visual-coherence.json',jsonBytes(visual)],['source-scopes.json',jsonBytes(scopes)],
    ['input-reference.png',flow.getGenerationResult(workflow,ref.planSha256).bytes]]);
  const sources=after.plans.map((plan,index)=>{const prefix=String(index+1).padStart(2,'0'),old=before.plans.find(p=>p.recipe.assetId===plan.recipe.assetId);
    files.set(`prompts/${prefix}-before.txt`,Buffer.from(old.request.prompt));files.set(`prompts/${prefix}-after.txt`,Buffer.from(plan.request.prompt));
    return {assetId:plan.recipe.assetId,role:plan.instanceBinding.role,planSha256:plan.sha256,beforePrompt:`prompts/${prefix}-before.txt`,afterPrompt:`prompts/${prefix}-after.txt`};});
  const report=seal({format:'ai_scene_visual_coherence_preview_v1',projectId:project.projectId,referencePlanSha256:ref.planSha256,targetSha256:after.batch.targetSha256,
    visualCoherenceSha256:visual.sha256,sourceScopesSha256:scopes.sha256,sources,frozen:false,executable:false,generationCalls:0,
    automaticSemanticDetection:false,artAcceptance:'not-assessed',existingAuthorizationsReusable:false});
  files.set('review.json',jsonBytes(report));
  files.set('README.md',Buffer.from(['# 共享视觉规范与来源提示预览','',
    '这份预览比较旧单层v4和共享视觉规范。每项仍只生成自身；材质家族、笔触、光照、远近明暗和地形表沿过渡共用同一份参考规范。',
    '相对尺寸、表沿与接地信息只用于回拼。程序不声称自动识别美术正确，也不改变原色。',
    '这是零调用提案，未冻结来源、未消费计算授权、未替换旧图。后续真实生成仍需新的准确批次与单次确认。','',`审阅摘要：${report.sha256}`,''].join('\n')));
  const bundle=seal({format:'ai_scene_visual_coherence_preview_bundle_v1',reviewSha256:report.sha256,artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),generationCalls:0});
  files.set('proof-bundle.json',jsonBytes(bundle));const prepared={files,bundle,report};if(existsSync(output))verifyProofBundle(output,prepared);else writeProofBundle(output,workflow,prepared);return report;
}
export function reviseCoherentStage(root,options){const {workflow}=projectAt(root),status=inspectCoherentPipeline(root);
  const sourceAlternative=status.stage==='ready-to-deliver'&&Array.isArray(options?.replacements)
    &&options.replacements.length>0&&options.replacements.every(r=>r.intent==='isolated-foreground-v3'||r.intent===LAYER_SOURCE_INTENT);
  const optIn=Object.hasOwn(options??{},'allowUnsubmittedDependency');
  if(optIn)check(options.allowUnsubmittedDependency===true&&options.expectedBatchSha256===status.batchSha256
    &&status.reference?.status==='accepted'&&['awaiting-source-compute','ready-to-generate-sources'].includes(status.stage),'COHERENT_REVISION_STATE');
  else check(status.stage==='attention-required'||sourceAlternative,'COHERENT_REVISION_STATE');
  if(status.reference?.status!=='accepted'){exact(options,['planId']);flow.reviseGenerationPlan(workflow,status.reference.planSha256,{planId:options.planId,
    capabilitiesSha256:flow.getGenerationPlan(workflow,status.reference.planSha256).recipe.capabilitiesSha256,intent:'Overall coherent reference-led scene; no pixel-exact asset matching.'});}
  else flow.reviseCoherentSources(workflow,status.batchSha256,options);return inspectCoherentPipeline(root);}
// Fixed current-batch inputs only. Reading/calibrating these sources submits no
// image request and cannot borrow an old source or compute authorization.
export function coherentSurfaceInputs(root){
  const context=projectAt(root),status=coherentInspection(context),{workflow,view}=context;check(status.stage==='ready-to-deliver','COHERENT_SURFACE_REVIEW_STATE');
  const batch=view.batches.find(batch=>batch.sha256===status.batchSha256),target=flow.getReferenceReconstructionTarget(workflow,status.reference.planSha256);
  const bySha=new Map(view.plans.map(plan=>[plan.sha256,plan])),materials=batch.planSha256s.map(sha=>bySha.get(sha)).filter(plan=>plan.instanceBinding.role==='material');
  check(materials.length===1,'COHERENT_MATERIAL_REQUIRED');const plan=materials[0],reference=flow.getGenerationResult(workflow,status.reference.planSha256),material=flow.getGenerationResult(workflow,plan.sha256);
  check(status.reference.status==='accepted'&&reference.result.rawSha256===target.rawSha256&&hash(reference.bytes)===target.rawSha256
    &&plan.referenceEvidence[0].rawSha256===target.rawSha256&&material.result.technical.status==='pass'
    &&material.result.rawSha256===hash(material.bytes),'COHERENT_SURFACE_INPUTS');
  return {reference:{raw:reference.bytes,planSha256:status.reference.planSha256,rawSha256:target.rawSha256},
    material:{raw:material.bytes,planSha256:plan.sha256,rawSha256:material.result.rawSha256,assetId:plan.recipe.assetId,...(plan.recipe.sourceScope?.terrainIntent?{terrainIntent:plan.recipe.sourceScope.terrainIntent}:{})},target,batch};
}
function measuredComposition(inputs,observations,options={}){
  assertTerrainIntentRendering(inputs.material.terrainIntent,options.terrainRendering);
  const mapping=compileMeasuredSurfaceMapping({...inputs,observations});
  if(options.terrainRendering?.capEndRow!==undefined)check(options.terrainRendering.capEndRow<=mapping.field.capHeight,'TERRAIN_RENDERING_SURFACE','Surface cover must fit the actual measured cap window');
  const {referenceStructure,featureMeasurements,...ordinary}=options;
  return {mapping,composition:referenceStructure?createFeatureCoherentComposition(inputs.batch,inputs.target,mapping,referenceStructure,featureMeasurements,ordinary):createMeasuredCoherentComposition(inputs.batch,inputs.target,mapping,ordinary)};
}
export function prepareCoherentSurfaceReview(root,observations,output,{baseComposition=null,terrainRendering}={}){
  const inputs=coherentSurfaceInputs(root),{workflow,project}=projectAt(root),options={};
  if(baseComposition!==null){
    check(['ai_scene_coherent_composition_v2','ai_scene_coherent_composition_v3','ai_scene_coherent_composition_v4','ai_scene_coherent_composition_v5','ai_scene_coherent_composition_v6'].includes(baseComposition.format),'COHERENT_SURFACE_BASE_COMPOSITION');
    validateCoherentComposition(baseComposition,inputs.batch,inputs.target);options.transforms=baseComposition.transforms;
    if(Object.hasOwn(baseComposition,'layerOrder'))options.layerOrder=baseComposition.layerOrder;
    if(Object.hasOwn(baseComposition,'bandPlacements'))options.bandPlacements=baseComposition.bandPlacements;
    if(Object.hasOwn(baseComposition,'contacts'))options.contacts=baseComposition.contacts;
    if(Object.hasOwn(baseComposition,'surfaceCalibration'))options.surfaceCalibration=baseComposition.surfaceCalibration;
    if(Object.hasOwn(baseComposition,'terrainLayout'))options.terrainLayout=baseComposition.terrainLayout;
    if(Object.hasOwn(baseComposition,'terrainRendering'))options.terrainRendering=baseComposition.terrainRendering;
    if(Object.hasOwn(baseComposition,'featureCorrection'))options.featureCorrection=baseComposition.featureCorrection;
    if(Object.hasOwn(baseComposition,'featureSupplement'))options.featureSupplement=baseComposition.featureSupplement;
    if(Object.hasOwn(baseComposition,'referenceIntentReview'))options.referenceIntentReview=baseComposition.referenceIntentReview;
    if(baseComposition.format==='ai_scene_coherent_composition_v6'){options.referenceStructure=baseComposition.referenceStructure;options.featureMeasurements=baseComposition.featureMeasurements;}
  }
  if(terrainRendering!==undefined)options.terrainRendering=terrainRendering;
  const {mapping,composition}=measuredComposition(inputs,observations,options);
  const report=seal({format:'ai_scene_coherent_surface_review_v1',projectId:project.projectId,batchSha256:inputs.batch.sha256,targetSha256:inputs.target.sha256,
    referencePlanSha256:inputs.reference.planSha256,referenceRawSha256:inputs.reference.rawSha256,
    materialPlanSha256:inputs.material.planSha256,materialRawSha256:inputs.material.rawSha256,
    mappingSha256:mapping.sha256,compositionSha256:composition.sha256,baseCompositionSha256:baseComposition?.sha256??null,
    observationOrigin:'explicit-native-pixel-observations-not-automatic-segmentation',generationCalls:0,newComputeAuthorized:false,
    existingSourceAuthorizationsReused:false,sourcePngsModified:false,artAcceptance:'not-assessed'});
  const files=new Map([['surface-mapping.json',jsonBytes(mapping)],['composition-profile.json',jsonBytes(composition)],['surface-observations.json',jsonBytes(observations)],
    ['reference-native.png',inputs.reference.raw],['material-native.png',inputs.material.raw],['reference-target.json',jsonBytes(inputs.target)],
    ['source-batch.json',jsonBytes(inputs.batch)],['review.json',jsonBytes(report)]]);
  if(baseComposition!==null)files.set('base-composition.json',jsonBytes(baseComposition));
  files.set('README.md',Buffer.from(['# 按参考测量的地表映射','',
    '原参考与当前批次材质PNG保持原字节。显式观测决定岩块尺度、表面起点、岩土起点和同源连续过渡；程序不自动分割、重画、调色或认证美术正确。',
    'surface-mapping.json记录准确有理数尺度和覆盖深度；composition-profile.json可用于新交付，环境摆放与层序从经验证的基础配置保留。',
    '本包只准备确定性派生配置，不修改工作流事件、旧候选、Studio项目或来源授权，不产生新图片调用。',
    '技术兼容报告仍需要结合完整参考和实际Studio检查整体观感；这不是图片生成计划或新的计算授权。','',`审阅摘要：${report.sha256}`,''].join('\n')));
  const bundle=seal({format:'ai_scene_coherent_surface_review_bundle_v1',reviewSha256:report.sha256,
    artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),generationCalls:0});
  files.set('proof-bundle.json',jsonBytes(bundle));const prepared={files,bundle,report};
  if(existsSync(output))verifyProofBundle(output,prepared);else writeProofBundle(output,workflow,prepared);return report;
}
function currentTerrainContext(root,context=projectAt(root)){
  const status=coherentInspection(context);check(status.stage==='ready-to-deliver','COHERENT_TERRAIN_SOURCE_STATE');
  const batch=context.view.batches.find(b=>b.sha256===status.batchSha256),material=context.view.plans.find(p=>batch.planSha256s.includes(p.sha256)&&p.instanceBinding?.role==='material');
  return {workflow:context.workflow,projectId:status.projectId,batchSha256:batch.sha256,intent:material.recipe.sourceScope?.terrainIntent,capabilitiesSha256:context.referenceProject.capabilitiesSha256};
}
function coherentTerrainSourceOptions(root,batchId,manufacturedMaterialProfile,gutterPolicy){
  const c=currentTerrainContext(root);
  return {workflow:c.workflow,options:terrainPerimeterOptions(c.intent,{batchId,baseBatchSha256:c.batchSha256,
    capabilitiesSha256:c.capabilitiesSha256,manufacturedMaterialProfile,gutterPolicy})};
}
export function previewCoherentTerrainSources(root,batchId,manufacturedMaterialProfile,gutterPolicy){
  const {workflow,options}=coherentTerrainSourceOptions(root,batchId,manufacturedMaterialProfile,gutterPolicy);
  return flow.previewTerrainEdgeSources(workflow,options);
}
export function freezeCoherentTerrainSources(root,batchId,proposalSha256,manufacturedMaterialProfile,gutterPolicy){
  const {workflow,options}=coherentTerrainSourceOptions(root,batchId,manufacturedMaterialProfile,gutterPolicy);
  check(isDigest(proposalSha256),'TERRAIN_PERIMETER_PROPOSAL_CHANGED');
  return flow.freezeTerrainEdgeSources(workflow,options,{proposalSha256});
}
export function deliverCoherentPipeline(root,output,{composition=null,relationReviews=null,guideReviews=null,terrain=null}={}){const status=inspectCoherentPipeline(root),{workflow,project}=projectAt(root);check(status.stage==='ready-to-deliver','COHERENT_DELIVERY_STATE');
  check(composition!==null||!['ai_scene_coherent_project_v4','ai_scene_coherent_project_v5','ai_scene_coherent_project_v6','ai_scene_coherent_project_v7'].includes(project.format),'COHERENT_SURFACE_MAPPING_REQUIRED');
  const terrainContext=currentTerrainContext(root);
  if(needsCompleteTerrain(terrainContext.intent))return deliverCompleteCoherentTerrain(terrainContext,output,{composition,relationReviews,guideReviews,terrain});
  check(terrain===null,'TERRAIN_COMPLETE_BRUSH_REQUIRED');
  if(composition===null)composition=project.format==='ai_scene_coherent_project_v3'
    ?createCoherentComposition(flow.getCoherentSourceBatch(workflow,status.batchSha256),flow.getReferenceReconstructionTarget(workflow,status.reference.planSha256))
    :seal({format:'ai_scene_coherent_composition_v2',batchSha256:status.batchSha256,
      targetSha256:status.reference.reconstructionTargetSha256,sourceSampling:COHERENT_SAMPLING,transforms:[]});
  flow.checkCoherentCandidateRelations(workflow,status.batchSha256,relationReviews,guideReviews,composition);
  const out=makeFreshDirectory(output,sourceRoot),candidateId=status.projectId+'.kit';
  const bundle=flow.buildCoherentCandidate(workflow,status.batchSha256,candidateId,join(out,'candidate'),composition,relationReviews,guideReviews);
  flow.verifyCoherentCandidate(workflow,status.batchSha256,candidateId,join(out,'candidate'),composition);
  const handle=loadSceneKit(join(out,'candidate/kit')),map=readMap(handle),scene=compileMap(handle,map),context=contextFor(handle);
  const exported=exportScene(handle,map,join(out,'export')),zip=exportSceneArchive(handle,map);
  const render=renderCoherentFrame(scene,path=>context.files.get(path)),ref=flow.getGenerationResult(workflow,status.reference.planSha256).bytes,comparison=coherentComparison(ref,render);
  for(const [path,bytes]of [['scene-kit.zip',zip],['scene-preview.png',render],['reference-native.png',ref],['reference-vs-reconstruction.png',comparison]])writeFreshFile(join(out,path),bytes,sourceRoot);
  if(composition)writeFreshFile(join(out,'composition-profile.json'),jsonBytes(composition),sourceRoot);
  const report=seal({format:'ai_scene_coherent_delivery_v1',projectId:status.projectId,sourceBatchSha256:status.batchSha256,candidateId,bundleSha256:bundle.sha256,
    policySha256:COHERENT_POLICY.sha256,kitSha256:handle.bundleSha256,authorSha256:scene.source.authorSha256,compiledSha256:scene.contentSha256,
    zip:{sha256:hash(zip),byteLength:zip.length},render:{sha256:hash(render),kind:'deterministic-default-scene-render-not-browser-screenshot',sampling:'area-minify-nearest-display-enlarge'},
    comparison:{sha256:hash(comparison),left:'whole-reference',right:'deterministic-recomposition',referenceCrop:false},export:exported,
    studio:{kit:'candidate/kit',document:'export/scene.document.json',command:'coherent studio --root PROJECT --delivery DELIVERY --port PORT'},
    finalHumanArtReview:'pending',productionKit:false,generationCalls:0,...(composition?{compositionSha256:composition.sha256}:{})});
  writeFreshFile(join(out,'delivery.json'),jsonBytes(report),sourceRoot);return report;
}
export function verifyCoherentDelivery(root,output){const report=parseJson(readSelectedFile(join(output,'delivery.json')));unseal(report);
  if(report.format==='ai_scene_terrain_edge_delivery_v1'||existsSync(join(output,'coherent-brush.json')))return verifyCompleteCoherentTerrain(currentTerrainContext(root),output);
  const context=projectAt(root),status=coherentInspection(context),{workflow,late}=context;
  const historical=Boolean(late&&report.sourceBatchSha256===late.parentBatchSha256);
  const deliveredBatch=context.view.batches.find(b=>b.sha256===report.sourceBatchSha256);
  check(!context.view.plans.some(p=>deliveredBatch?.planSha256s.includes(p.sha256)&&needsCompleteTerrain(p.recipe?.sourceScope?.terrainIntent)),
    'TERRAIN_PERIMETER_DELIVERY_REQUIRED','A complete brush cannot replay a material-only coherent delivery');
  check(report.format==='ai_scene_coherent_delivery_v1'&&report.projectId===status.projectId
    &&(historical||report.sourceBatchSha256===status.batchSha256&&status.stage==='ready-to-deliver'),'COHERENT_DELIVERY_IDENTITY');
  const composition=Object.hasOwn(report,'compositionSha256')?parseJson(readSelectedFile(join(output,'composition-profile.json'))):null;
  if(composition){unseal(composition);check(composition.sha256===report.compositionSha256,'COHERENT_COMPOSITION_IDENTITY');}
  const candidate=flow.verifyCoherentCandidate(workflow,report.sourceBatchSha256,report.candidateId,join(output,'candidate'),composition,{historical});
  check(candidate.bundleSha256===report.bundleSha256&&report.policySha256===COHERENT_POLICY.sha256&&report.finalHumanArtReview==='pending'&&report.productionKit===false,'COHERENT_DELIVERY_IDENTITY');
  const reopened=openSceneExport(join(output,'export')),handle=loadSceneKit(join(output,'candidate/kit')),map=readMap(handle),scene=compileMap(handle,map);
  check(scene.contentSha256===report.compiledSha256&&reopened.compiled.contentSha256===scene.contentSha256&&handle.bundleSha256===report.kitSha256&&scene.source.authorSha256===report.authorSha256,'COHERENT_DELIVERY_IDENTITY');
  const zip=readSelectedFile(join(output,'scene-kit.zip'),268435456);check(hash(zip)===report.zip.sha256&&zip.length===report.zip.byteLength&&zip.equals(exportSceneArchive(handle,map)),'COHERENT_DELIVERY_ZIP');
  const render=renderCoherentFrame(scene,path=>contextFor(handle).files.get(path)),ref=flow.getGenerationResult(workflow,historical?late.originalReferencePlanSha256:status.reference.planSha256).bytes;
  check(report.render.kind==='deterministic-default-scene-render-not-browser-screenshot'&&report.render.sampling==='area-minify-nearest-display-enlarge'
    &&report.comparison.right==='deterministic-recomposition'&&report.comparison.referenceCrop===false
    &&hash(render)===report.render.sha256&&hash(coherentComparison(ref,render))===report.comparison.sha256
    &&readSelectedFile(join(output,'reference-native.png'),16777216).equals(ref)&&readSelectedFile(join(output,'scene-preview.png'),16777216).equals(render)
    &&readSelectedFile(join(output,'reference-vs-reconstruction.png'),16777216).equals(coherentComparison(ref,render)),'COHERENT_DELIVERY_RENDER');
  return {status:'verified',reportSha256:report.sha256,zipSha256:report.zip.sha256,artAcceptance:'not-assessed',generationCalls:0};
}
// A trusted host Agent/planner supplies typed observations. No model output is executable.
// Each explicit analysis ID reserves once; unknown analyses cannot be resubmitted under that ID.
export async function analyzeCoherentReference(root,analysisId,planner){id(analysisId);check(planner&&typeof planner.analyze==='function','COHERENT_PLANNER_REQUIRED');
  const status=inspectCoherentPipeline(root),{workflow,spec}=projectAt(root);check(status.stage==='awaiting-reference-review','COHERENT_REFERENCE_REVIEW_STATE');
  const request=seal({format:'ai_scene_coherent_analysis_request_v1',analysisId,planSha256:status.reference.planSha256,rawSha256:status.reference.rawSha256,
    requirements:spec.requirements,viewport:spec.viewport,outputFormat:'ai_scene_measured_reference_layout_v1',purpose:'coarse-observed-envelopes-and-readable-surfaces-not-Alpha'});
  const intended=join(root,'analysis-'+analysisId);
  if(existsSync(intended)){
    const prior=parseJson(readSelectedFile(join(intended,'reservation.json')));unseal(prior);check(prior.sha256===request.sha256,'COHERENT_ANALYSIS_IDENTITY');
    if(!existsSync(join(intended,'result.json')))return {status:'analysis-attention-required',automaticRetry:false};
    const result=parseJson(readSelectedFile(join(intended,'result.json'))),analysis=parseJson(readSelectedFile(join(intended,'analysis.json')));unseal(result);unseal(analysis);
    check(result.requestSha256===request.sha256&&result.analysisSha256===analysis.sha256,'COHERENT_ANALYSIS_IDENTITY');
    const verified=flow.verifyMeasuredReferenceReview(workflow,status.reference.planSha256,analysis,join(intended,'review'));
    const packet=parseJson(readSelectedFile(join(intended,'review/proof-bundle.json')));unseal(packet);
    check(packet.packetSha256===result.packetSha256&&packet.sha256===verified.bundleSha256,'COHERENT_ANALYSIS_IDENTITY');
    return {analysis,packet,reviewDirectory:'analysis-'+analysisId+'/review',reusedVerifiedAnalysis:true};
  }
  const out=makeFreshDirectory(intended,sourceRoot);writeFreshFile(join(out,'reservation.json'),jsonBytes(request),sourceRoot);
  let analysis;try{analysis=await planner.analyze({request,bytes:flow.getGenerationResult(workflow,status.reference.planSha256).bytes});
    const raw=jsonBytes(analysis);check(raw.length<=2097152,'COHERENT_ANALYSIS_SIZE');writeFreshFile(join(out,'planner-output.json'),raw,sourceRoot);
    const packet=prepareCoherentReferenceReview(root,analysis,join(out,'review'));writeFreshFile(join(out,'analysis.json'),jsonBytes(analysis),sourceRoot);
    writeFreshFile(join(out,'result.json'),jsonBytes(seal({format:'ai_scene_coherent_analysis_result_v1',requestSha256:request.sha256,analysisSha256:analysis.sha256,packetSha256:packet.packetSha256,status:'ready-for-human-review'})),sourceRoot);
    return {analysis,packet,reviewDirectory:'analysis-'+analysisId+'/review'};
  }catch{writeFreshFile(join(out,'terminal-unknown.json'),jsonBytes(seal({format:'ai_scene_coherent_analysis_terminal_v1',requestSha256:request.sha256,outcome:'indeterminate-no-automatic-retry'})),sourceRoot);
    return {status:'analysis-attention-required',automaticRetry:false};}
}
export async function driveCoherentPipeline(root,{imageAdapter,planner,operator,analysisId='reference',delivery=join(root,'delivery'),onProgress=()=>{},deferObservationCoverage=false,
  composition:preparedComposition=null,terrain=null,relationReviews=null,guideReviews=null}){
  check(typeof deferObservationCoverage==='boolean','COHERENT_OBSERVATION_OPTION');
  check(operator&&typeof operator==='object','COHERENT_OPERATOR_REQUIRED');
  for(let step=0;step<10;step++){
    if(deferObservationCoverage&&!existsSync(join(root,'reference-observation-required.json'))){
      const context=projectAt(root),current=coherentInspection(context);
      check(!['awaiting-source-compute','ready-to-generate-sources','ready-to-deliver'].includes(current.stage),'COHERENT_OBSERVATION_ALREADY_FROZEN');
      if(current.stage==='source-batch-needed'){
        const marker=seal({format:'ai_scene_reference_observation_required_v1',projectId:context.project.projectId,referencePlanSha256:current.reference.planSha256});
        writeFreshFile(join(root,'reference-observation-required.json'),jsonBytes(marker),sourceRoot);
      }
    }
    if(existsSync(join(root,'reference-observation-required.json'))&&!existsSync(join(root,'reference-observation-accepted.json'))){
      const pendingContext=projectAt(root),pending=coherentInspection(pendingContext);
      if(pending.stage==='source-batch-needed'&&checkedCoverageMarker(root,pendingContext,pending.reference.planSha256))
        return {...pending,stage:'awaiting-observation-coverage',technicalStage:'source-batch-needed',generationCalls:0};
    }
    const status=advanceCoherentPipeline(root);onProgress({phase:'state',stage:status.stage});
    if(status.stage==='awaiting-design-review'){if(!operator.reviewDesign)return status;const receipts=await operator.reviewDesign(status);if(!receipts)return status;reviewCoherentDesign(root,receipts);continue;}
    if(['awaiting-reference-compute','awaiting-source-compute'].includes(status.stage)){if(!operator.approveCompute)return status;const snapshot=coherentComputeSnapshot(root),receipt=await operator.approveCompute(snapshot);if(!receipt)return status;authorizeCoherentStage(root,receipt);continue;}
    if(['ready-to-generate-reference','ready-to-generate-sources'].includes(status.stage)){
      if(!imageAdapter)return status;
      const next=await runCoherentStage(root,imageAdapter,{onProgress});if(next.stage==='attention-required')return next;continue;
    }
    if(status.stage==='awaiting-reference-review'){
      if(!planner||!operator.reviewReference)return status;const analyzed=await analyzeCoherentReference(root,analysisId,planner);if(!analyzed.analysis)return analyzed;
      const receipt=await operator.reviewReference(analyzed);if(!receipt)return status;reviewCoherentReference(root,analyzed.analysis,receipt,{deferObservationCoverage});continue;
    }
    if(status.stage==='ready-to-deliver'){
      if(existsSync(delivery))return {...status,delivery:verifyCoherentDelivery(root,delivery)};
      let composition=preparedComposition;
      if(composition===null&&['ai_scene_coherent_project_v4','ai_scene_coherent_project_v5','ai_scene_coherent_project_v6','ai_scene_coherent_project_v7'].includes(projectAt(root).project.format)){
        const waiting={...status,stage:'awaiting-surface-mapping',technicalStage:'ready-to-deliver'};
        if(typeof operator.calibrateSurface!=='function')return waiting;
        const inputs=coherentSurfaceInputs(root),calibration=await operator.calibrateSurface(inputs);
        if(!calibration)return waiting;
        exact(calibration,['observations',...(Object.hasOwn(calibration,'options')?['options']:[])]);
        ({composition}=measuredComposition(inputs,calibration.observations,calibration.options??{}));
        onProgress({phase:'surface-mapping-prepared',compositionSha256:composition.sha256,generationCalls:0});
      }
      try{return {...status,delivery:deliverCoherentPipeline(root,delivery,{composition,terrain,relationReviews,guideReviews})};}
      catch(error){if(error.errors?.some(x=>x.code==='TERRAIN_PERIMETER_DELIVERY_REQUIRED'))return {...status,stage:'awaiting-terrain-perimeter',technicalStage:'ready-to-deliver',generationCalls:0};
        if(error.errors?.some(x=>x.code==='BAND_RELATION_GATE_REQUIRED'))return {...status,stage:'awaiting-band-relations-review',technicalStage:'ready-to-deliver',generationCalls:0};
        if(error.errors?.some(x=>x.code==='BAND_GUIDE_GATE_REQUIRED'))return {...status,stage:'awaiting-band-guide-review',technicalStage:'ready-to-deliver',generationCalls:0};throw error;}
    }
    return status;
  }
  check(false,'COHERENT_DRIVER_LIMIT');
}
export function reviewCoherentDelivery(root,output,receipt,{captureDirectory,observations,recompositionReport}={}){verifyCoherentDelivery(root,output);validateReceipt(receipt,'review');
  const report=parseJson(readSelectedFile(join(output,'delivery.json')));check(receipt.targetSha256===report.sha256,'COHERENT_FINAL_REVIEW_TARGET');
  const policy=projectAt(root).project.finalReviewPolicy;
  if(policy===COHERENT_FINAL_REVIEW_POLICY&&receipt.decision==='accept'){check(typeof captureDirectory==='string'&&Array.isArray(observations)&&recompositionReport,'COHERENT_RECOMPOSITION_REQUIRED');
    const capture=parseJson(readSelectedFile(join(captureDirectory,'capture.json'))),studioCaptureBytes=readSelectedFile(join(captureDirectory,'studio-scene.png'),16777216),
      referenceBytes=readSelectedFile(join(output,'reference-native.png'),16777216);
    assertRecompositionReview({referenceBytes,studioCaptureBytes,...checkCaptureBinding(report,capture,studioCaptureBytes),observations},recompositionReport);}
  const decision=seal({format:'ai_scene_coherent_delivery_art_review_v1',deliverySha256:report.sha256,receipt,
    scope:'this-exact-composed-candidate-only-not-individual-source-approval',sourceReviewsOverwritten:false,
    ...(policy?{finalReviewPolicy:policy,...(receipt.decision==='accept'?{recompositionReviewSha256:recompositionReport.sha256}:{})}:{})});
  writeFreshFile(join(output,'art-review.json'),jsonBytes(decision),sourceRoot);return decision;
}
export function reserveCoherentExchange(root,output){const status=inspectCoherentPipeline(root),{workflow}=projectAt(root);
  check(['ready-to-generate-reference','ready-to-generate-sources'].includes(status.stage),'PIPELINE_NOT_AUTHORIZED');
  const entry=status.stage==='ready-to-generate-reference'?status.reference:status.sources.find(p=>p.status==='authorized');check(entry,'PIPELINE_NOT_AUTHORIZED');
  const out=makeFreshDirectory(output,sourceRoot),{request,...ticket}=flow.reservePlan(workflow,entry.planSha256);
  writeFreshFile(join(out,'ticket.json'),jsonBytes(ticket),sourceRoot);flow.recordSubmission(workflow,ticket);
  const inputs=request.images.map((i,n)=>{const bytes=flow.readGenerationInput(workflow,entry.planSha256,n),path=`input-${n+1}.png`;
    writeFreshFile(join(out,path),bytes,sourceRoot);return {path,role:i.role,sha256:hash(bytes)};});
  const exchange=seal({format:'ai_scene_coherent_external_exchange_v1',ticket,request,inputs,transparentBackground:request.output.alpha==='transparent',maximumCalls:1,automaticRetry:false});
  writeFreshFile(join(out,'exchange.json'),jsonBytes(exchange),sourceRoot);return exchange;
}
export function receiveCoherentExchange(root,exchangeDirectory,pngFile){const {workflow}=projectAt(root),ticket=parseJson(readSelectedFile(join(exchangeDirectory,'ticket.json'))),
  exchange=parseJson(readSelectedFile(join(exchangeDirectory,'exchange.json')));unseal(exchange);check(JSON.stringify(ticket)===JSON.stringify(exchange.ticket),'COHERENT_EXCHANGE_TICKET');
  const plan=flow.getGenerationPlan(workflow,ticket.planSha256);check(hash(jsonBytes(plan.request))===hash(jsonBytes(exchange.request)),'COHERENT_EXCHANGE_REQUEST');
  const bytes=readSelectedFile(pngFile,16777216),state=flow.inspectWorkflow(workflow).plans.find(p=>p.planSha256===ticket.planSha256);
  let result;if(state.received){result=flow.getGenerationResult(workflow,ticket.planSha256).result;check(result.attemptSha256===ticket.attemptSha256&&result.rawSha256===hash(bytes),'COHERENT_EXCHANGE_RESULT');}
  else result=flow.receiveResult(workflow,ticket,bytes);
  for(const [path,data]of [['source-native.png',bytes],['technical.json',jsonBytes(result.technical)]]){
    const file=join(exchangeDirectory,path);if(existsSync(file))check(readSelectedFile(file,16777216).equals(data),'COHERENT_EXCHANGE_RESULT');else writeFreshFile(file,data,sourceRoot);}
  return inspectCoherentPipeline(root);
}
export function stopCoherentExchange(root,exchangeDirectory){const {workflow}=projectAt(root),ticket=parseJson(readSelectedFile(join(exchangeDirectory,'ticket.json')));
  flow.stopAttempt(workflow,ticket,'indeterminate');return inspectCoherentPipeline(root);}
