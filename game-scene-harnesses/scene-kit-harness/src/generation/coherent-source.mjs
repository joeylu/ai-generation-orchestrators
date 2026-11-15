import { canonicalJson } from '../document.mjs';
import { inspectPng } from '../png.mjs';
import {validateReferenceRequirements} from '../reference-measurement.mjs';
import { check, digest, exact, hash, id, seal, text } from './common.mjs';
import {LAYER_SOURCE_INTENT,SOURCE_GUIDED_REFERENCE_ROLE,compileLayerScopedSource} from './layer-source.mjs';
import {sourceVisualGuide} from './source-visual-guide.mjs';
import {sourceFrameGuide} from './source-frame-guide.mjs';
import {backgroundBandGuide,BACKGROUND_BAND_GUIDE_IMAGE_ROLE} from './background-band-guide.mjs';
import {backgroundBandCoverageGuide,BACKGROUND_BAND_COVERAGE_GUIDE_IMAGE_ROLE} from './background-band-coverage-guide.mjs';
import {bandCompositionGuide,isReferenceWindowGuide,BAND_REFERENCE_WINDOW_GUIDE_IMAGE_ROLE,BAND_COMPOSITION_GUIDE_IMAGE_ROLE} from './band-composition-guide.mjs';
import {backgroundBandOpenDepthGuide,BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE} from './background-band-open-depth-guide.mjs';
import {backgroundBandOpenTrenchGuide,BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE} from './background-band-open-trench-guide.mjs';
import {backgroundBandIrregularValleyGuide,BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_IMAGE_ROLE} from './background-band-irregular-valley-guide.mjs';
import {compileSourceDependency} from './coherent-source-dependency.mjs';
import {isRegisteredMasterSpec,previewRegisteredMasterGuide,registeredMasterInputRole,isRegisteredLocalEdit} from './registered-layout-master.mjs';

export const COHERENT_POLICY = seal({format:'ai_scene_coherent_policy_v1',id:'overall-coherence-v1',
  priority:['theme-and-style','depth-and-subject-identity','playable-surface-readability','complete-editable-scene'],
  pixelIdentityRequired:false,perPartMaterialProbesRequired:false,pregenerationCoordinatesRequired:false,
  placement:'observed-envelope-contain-and-grid-snap-v1',assetUpscale:false,renderScale:'display-enlargement-allowed-without-larger-source-PNG',maximumPlatformGridShift:2,platformPlacement:'nearest-isolated-grid-rectangle',source:'new-isolated-subject-from-accepted-reference',
  nativePng:'preserve-original-bytes',continuousAlpha:true,derivedTransparentMarginPx:2,hiddenRgb:'diagnostic-only-for-native',
  transparentBorder:'edge-alpha-at-most-one-is-diagnostic-no-repair',automaticRetry:false,
  sourceArtAcceptance:'not-inferred-from-technical-pass',finalArtReview:'separate-exact-delivery-review'});
export const COHERENT_ROLES=Object.freeze(['sky','backdrop','landmark','scenery','valley','ground','platform','foreground']);
export const coherentRole=role=>role==='solid-terrain'?'ground':role==='solid-platform'?'platform':role;
export function validateCoherentRequirements(requirements) {
  validateReferenceRequirements(requirements);
  check(requirements.subjects.every(s=>COHERENT_ROLES.includes(coherentRole(s.role))), 'COHERENT_ROLE_REQUIRED');
  const sky=requirements.subjects.filter(s=>s.role==='sky'),grounds=requirements.subjects.filter(s=>coherentRole(s.role)==='ground');
  check(sky.length===1&&sky[0].count.min===1&&sky[0].count.max===1&&sky[0].layerId===requirements.layers[0].layerId
    &&requirements.layers[0].kind==='background'&&grounds.some(s=>s.count.min>=1)
    &&new Set(grounds.map(s=>s.layerId)).size===1, 'COHERENT_REQUIRED_SUBJECTS');
  for(const s of requirements.subjects) {
    const kind=requirements.layers.find(l=>l.layerId===s.layerId)?.kind,r=coherentRole(s.role);
    check((['ground','platform'].includes(r))===(kind==='terrain'), 'COHERENT_TERRAIN_LAYER');
  }
}
export function coherentInventory(reference, spec) {
  const target=reference.reconstructionTarget;check(reference.status==='accepted' && target?.format==='ai_scene_reference_reconstruction_target_v2','COHERENT_REFERENCE_REQUIRED');
  validateCoherentRequirements(spec.requirements);
  const groundIdentity=spec.requirements.subjects.filter(s=>coherentRole(s.role)==='ground').map(s=>s.content).join('\n');
  const rows=[{assetId:'coherent.material',role:'material',instance:null,content:groundIdentity}];
  check(!target.instances.some(i=>i.instanceId==='coherent.material'),'COHERENT_RESERVED_ID');
  for(const instance of target.instances) {
    const subject=spec.requirements.subjects.find(s=>s.subjectId===instance.subjectId),role=coherentRole(instance.role);
    check(subject&&role===coherentRole(subject.role),'COHERENT_SUBJECT_BINDING');
    if(role!=='ground')rows.push({assetId:instance.instanceId,role,instance,content:subject.content});
  }
  check(rows.length>=2&&rows.length<=25,'COHERENT_SOURCE_COUNT');return rows;
}
export function compileCoherentSource(state,recipe,readBlob) {
  for(const sha of Array.isArray(recipe?.parents)?recipe.parents:[]){
    const oldIntent=state.plans.get(sha)?.plan.recipe.sourceScope?.terrainIntent;
    if(oldIntent?.profile==='reference-terrain-intent-v2')check(recipe.sourceScope?.terrainIntent?.profile===oldIntent.profile
      &&(oldIntent.usage!=='complete-brush'||recipe.sourceScope.terrainIntent.usage==='complete-brush'),'TERRAIN_COMPLETION_REVISION_REQUIRED');
    if(state.plans.get(sha)?.plan.recipe.sourceScope?.terrainIntent)
      check(recipe.intent===LAYER_SOURCE_INTENT&&recipe.sourceScope?.terrainIntent,'TERRAIN_INTENT_REVISION_REQUIRED');
  }
  for(const sha of Array.isArray(recipe?.parents)?recipe.parents:[]){const previous=state.plans.get(sha)?.plan.recipe.sourceScope?.referenceStructure;
    if(previous)check(recipe.intent===LAYER_SOURCE_INTENT&&recipe.sourceScope?.referenceStructure?.sha256===previous.sha256,'REFERENCE_STRUCTURE_REVISION_CHANGE');
    const correction=state.plans.get(sha)?.plan.recipe.sourceScope?.featureCorrection;
    if(correction)check(recipe.sourceScope?.featureCorrection&&digest(recipe.sourceScope.featureCorrection)===digest(correction),'REFERENCE_FEATURE_CORRECTION_REVISION_CHANGE');
    const supplement=state.plans.get(sha)?.plan.recipe.sourceScope?.featureSupplement;
    if(supplement)check(recipe.sourceScope?.featureSupplement&&digest(recipe.sourceScope.featureSupplement)===digest(supplement),'REFERENCE_FEATURE_SUPPLEMENT_REVISION_CHANGE');}
  if(Object.hasOwn(recipe??{},'sourceDependency')){
    check(recipe.intent===LAYER_SOURCE_INTENT,'SOURCE_DEPENDENCY_INTENT');
    const {sourceDependency,...baseRecipe}=recipe,base=compileCoherentSource(state,baseRecipe,readBlob);
    return compileSourceDependency(base,recipe,state,readBlob,assessCoherentSource);
  }
  if(recipe?.intent===LAYER_SOURCE_INTENT){
    const {sourceScope,...baseRecipe}=recipe,base=compileCoherentSource(state,{...baseRecipe,parents:[],intent:''},readBlob);
    const ref=state.plans.get(recipe.referencePlans[0]),spec=state.designs.get(recipe.specSha256),item=coherentInventory(ref,spec).find(i=>i.assetId===recipe.assetId);
    check(sourceScope,'LAYER_SCOPE_REQUIRED');return compileLayerScopedSource(base,recipe,state,item,readBlob);
  }
  const isolatedForeground=recipe?.intent==='isolated-foreground-v3';
  exact(recipe,['planId','parents','stage','specSha256','styleSha256','capabilitiesSha256','referencePlans','inventoryRefs','assetId','targetSha256','policySha256','intent',...(isolatedForeground?['subjectBrief']:[])]);
  id(recipe.planId);id(recipe.assetId);text(recipe.intent,{empty:true});
  check(recipe.stage==='coherent-source'&&recipe.policySha256===COHERENT_POLICY.sha256&&['','complete-framing-v2','isolated-foreground-v3'].includes(recipe.intent)
    &&recipe.specSha256===state.activeSpec&&recipe.styleSha256===state.activeStyle
    &&Array.isArray(recipe.referencePlans)&&recipe.referencePlans.length===1
    &&Array.isArray(recipe.inventoryRefs)&&recipe.inventoryRefs.length===0,'COHERENT_RECIPE');
  const ref=state.plans.get(recipe.referencePlans[0]),spec=state.designs.get(recipe.specSha256),style=state.designs.get(recipe.styleSha256);
  check(spec?.format==='ai_scene_spec_v3'&&style?.format==='ai_scene_style_v2'
    &&ref?.plan.recipe.specSha256===recipe.specSha256&&ref?.plan.recipe.styleSha256===recipe.styleSha256
    &&ref.reconstructionTarget?.sha256===recipe.targetSha256,'COHERENT_REFERENCE_REQUIRED');
  const item=coherentInventory(ref,spec).find(i=>i.assetId===recipe.assetId);check(item,'COHERENT_ASSET');
  if(isolatedForeground){
    exact(recipe.subjectBrief,['content','exclusions']);text(recipe.subjectBrief.content,{limit:1200});
    check(Array.isArray(recipe.subjectBrief.exclusions)&&recipe.subjectBrief.exclusions.length>0
      &&recipe.subjectBrief.exclusions.length<=16,'COHERENT_FOREGROUND_BRIEF');
    recipe.subjectBrief.exclusions.forEach(v=>text(v,{limit:200}));
  }
  check(Array.isArray(recipe.parents)&&recipe.parents.length<=1,'PLAN_PARENT');
  check(recipe.intent===''||(item.role==='foreground'&&recipe.parents.length===1),'COHERENT_FRAMING_REVISION');
  if(recipe.parents.length){const parent=state.plans.get(recipe.parents[0]);check(['ai_scene_generation_plan_v27','ai_scene_coherent_border_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v2'].includes(parent?.plan.format)
    &&parent.plan.recipe.assetId===recipe.assetId&&parent.plan.recipe.targetSha256===recipe.targetSha256
    &&(['failed','indeterminate','rejected-technical','rejected-visual'].includes(parent.status)
      ||isolatedForeground&&['pending-visual-review','accepted'].includes(parent.status)&&parent.result?.technical.status==='pass'),'PLAN_PARENT');}
  const cap=state.capabilities.get(recipe.capabilitiesSha256),opaque=['material','sky'].includes(item.role);
  check(cap?.imageToImage&&cap.maxInputImages>=1&&(opaque||cap.transparentBackground)&&cap.maxWidth>=1024&&cap.maxHeight>=512,'COHERENT_CAPABILITY');
  check(hash(readBlob(ref.result.rawSha256))===ref.result.rawSha256,'COHERENT_REFERENCE_BYTES');
  const roleInstructions={material:'Opaque continuous terrain material study ONLY: upper one-eighth is an unbroken surface lip; below is solid terrain body filling the canvas. No sky, scenery, valley, separate platforms, holes or atlas.',
    sky:'Opaque sky and atmosphere only. Fill the complete landscape canvas; no mountains, ground, architecture or vegetation.',
    backdrop:'One complete distant landform group. Preserve the reference biome, low-contrast depth and palette. No painted sky.',
    landmark:'One complete distant landmark group INCLUDING its attached foundation/supporting cliff if the reference shows one. Keep it visually grounded. No unrelated foreground or playable terrain.',
    scenery:'One complete environmental group with its attached bases. Preserve the reference subject identity, palette and material scale. No independent props.',
    valley:'One complete static valley-depth group appropriate to the reference. Water is allowed only if the reference calls for water; dry valleys must stay dry.',
    platform:'One complete SOLID floating platform: straight thin horizontal cap, shallow solid frontal underside. No receding top plane, pillars, legs or neighboring scenery.',
    foreground:'One complete clear foreground framing group with attached branches/vegetation/rock as appropriate. Match the reference identity and lighting, keep the playable opening readable; no depth-of-field blur.'};
  const sourcePolicy={mode:'native-coherent-source',minimumWidth:item.role==='material'?1024:item.role==='sky'?Math.max(256,spec.viewport.width):256,minimumHeight:item.role==='material'?512:item.role==='sky'?Math.max(256,spec.viewport.height):256,
    maximumWidth:Math.min(4096,cap.maxWidth),maximumHeight:Math.min(4096,cap.maxHeight)};
  const bounds=item.instance?envelopeBounds(item.instance.visibleEnvelope):null;
  const basePrompt=[
    'Generate ONE isolated static source asset for a pure 2D SIDE-VIEW game scene. The accepted complete reference is the only image input: use its theme, subject identity, palette, light, brushwork and material scale. Do not copy its whole scene.',
    item.role==='material'?`Requested asset: ONE continuous terrain material field, not a scene or a terrain silhouette. Ground identity data is for material identity ONLY: ignore its position, count, outline and layout words. GROUND_IDENTITY=${canonicalJson(item.content)}`:`ONLY requested subject: ${item.content}`,roleInstructions[item.role],
    item.instance?`Draw ONLY instance ${item.instance.instanceId} of subject ${item.instance.subjectId}, located near the observed reference envelope ${canonicalJson(bounds)} in the ${spec.viewport.width}x${spec.viewport.height} review frame. This envelope selects ONE instance; plural or two-sided wording in the content describes the complete reference and never requests extra instances here. These coordinates identify the subject ONLY. Center the isolated subject on its OWN canvas; do not preserve full-scene placement. The program fits it into the reviewed composition. Approximate silhouette and overall material relationships are sufficient; pixel identity and tiny branch alignment are not required.`:'Use the approved scene biome materials, not an unrelated generic texture.',
    opaque?'Return one varied, opaque landscape PNG. No transparency or scene collage.':
      'Return one genuinely transparent RGBA PNG with a COMPLETE silhouette, real transparent openings and continuous soft Alpha. Center the subject, leave generous transparent margins on ALL sides, and complete previously occluded/frame-clipped parts consistently. Inferred parts are not measured reconstruction.',
    'Keep the observed depth/value relationships: distant subjects retain atmospheric contrast and color; foreground subjects stay crisp. No character, independent prop, text, UI, frame, grid, atlas, comparison panel, painted checkerboard, photographic blur, isometric or top-down playable plane.',
    `Style: ${canonicalJson({name:style.name,rules:style.rules})}`,
    `Minimum ${sourcePolicy.minimumWidth}x${sourcePolicy.minimumHeight}; maximum ${sourcePolicy.maximumWidth}x${sourcePolicy.maximumHeight}. Preserve the native PNG. No automatic retry or Alpha repair.`
  ].join('\n\n');
  const prompt=isolatedForeground?[
    'Generate ONE standalone decorative foreground asset for a pure 2D SIDE-VIEW game. This is an asset illustration on transparency, not a scene section or a terrain cross-section.',
    `The ENTIRE output subject is: ${recipe.subjectBrief.content}`,
    'Input image 1 is a STYLE-ONLY reference for brushwork, palette, material treatment and light. Its arrangement, background objects, terrain outlines, playable surfaces and camera framing are NOT output instructions. Do not copy a complete side of that scene. The subject description above decides all output content.',
    `Exclude entirely: ${recipe.subjectBrief.exclusions.join('; ')}.`,
    'Keep the foreground decoration separate from playable ground: no continuous walkable ledge, broad elevated platform cap, tall supporting cliff wall, or backing slab. Naturally rounded local surfaces of individual rocks are allowed. Preserve real transparent openings between branches and separate forms.',
    'Draw exactly one complete group, centered on its OWN canvas, with at least 12 percent fully transparent empty space on EVERY side. No object, glow, shadow or ground plane touches the image edges. The editor places the asset later; scene coordinates and paired-side composition do not apply.',
    'Clear near-camera silhouette and crisp branches; no depth-of-field blur. No sky, horizon, architecture, character, text, UI, atlas, painted checkerboard or comparison panel.',
    `Style: ${canonicalJson({name:style.name,rules:style.rules})}`,
    `Return one genuinely transparent RGBA PNG, minimum ${sourcePolicy.minimumWidth}x${sourcePolicy.minimumHeight}, maximum ${sourcePolicy.maximumWidth}x${sourcePolicy.maximumHeight}. Preserve native PNG and continuous Alpha.`,
    'FINAL CONTENT CHECK: the image contains only the described foreground decoration. If a playable platform or main cliff wall is present, it is a wrong source, even if the PNG is transparent. No post-generation silhouette cleanup is part of this request.'
  ].join('\n\n'):recipe.intent==='complete-framing-v2'?[
    'SOURCE FRAMING V2: Render only the requested NEAR-CAMERA foreground framing group as one isolated complete cutout. Exclude the main playable cliff wall and its long bright horizontal playable ledge behind the foreground. Do not copy the entire left/right side of the scene. Keep the requested foreground identity, material and light from the reference.',
    'Fit the COMPLETE outer contour comfortably INSIDE your own canvas: reserve at least 12 percent fully transparent empty gutter on ALL FOUR sides. No rock, branch, plant, glow or ground plane may touch the canvas edges. Complete previously frame-clipped parts consistently and center the smaller isolated group. Do not inherit the reference image border as a cut edge. The program positions the asset later; exact position and pixel identity are not required.',
    basePrompt
  ].join('\n\n'):basePrompt;
  return seal({format:'ai_scene_generation_plan_v27',compiler:isolatedForeground?'scene-kit-coherent-isolated-foreground-v3':recipe.intent==='complete-framing-v2'?'scene-kit-coherent-source-framing-v2':'scene-kit-coherent-source-v1',recipe,qualityPolicy:COHERENT_POLICY,
    designReviews:ref.plan.designReviews,referenceEvidence:[{planSha256:ref.plan.sha256,rawSha256:ref.result.rawSha256,
      targetSha256:ref.reconstructionTarget.sha256,acceptedPacketSha256:ref.reconstructionTarget.acceptedPacketSha256,humanReceiptSha256:ref.reconstructionTarget.humanReceiptSha256}],
    instanceBinding:{instanceId:item.instance?.instanceId??null,role:item.role,subjectId:item.instance?.subjectId??null,content:item.content,observedEnvelope:bounds},
    target:{assetId:item.assetId,kind:opaque?'background':'environment',alpha:opaque?'opaque':'transparent',sourcePolicy},
    ...(isolatedForeground?{sourceScope:{profile:'isolated-foreground-v3',subjectBrief:recipe.subjectBrief,
      referenceUsage:'style-only',sceneCoordinatesInPrompt:false,sceneSubjectContentInPrompt:false,
      alphaCleanupAllowed:false,semanticIsolationProven:false,predecessorArtDecisionUnchanged:true}}:{}),
    visualReviewChecklist:isolatedForeground?{requiredChecks:['Only the single subject in subjectBrief.content; no neighboring layer content.',
      'No main cliff wall, continuous playable ledge or backing terrain slab; all subjectBrief exclusions absent.',
      'Complete crisp silhouette and genuine transparent openings; coherent material and light.'],
      automatedSemanticDetection:false,visualAcceptance:'not-assessed'}:{requiredChecks:['Correct subject and coherent theme/style.','Complete silhouette and meaningful openings.','Readable overall composition after fit; no pixel-exact requirement.'],visualAcceptance:'not-assessed'},
    request:{format:'ai_scene_image_request_v27',task:'coherent-scene-source',prompt,images:[{role:isolatedForeground?'accepted-scene-style-only-reference':'accepted-scene-style-and-subject-reference',artifact:ref.result.technical.image}],
      output:{format:'png',alpha:opaque?'opaque':'transparent',sourcePolicy},maximumCalls:1}});
}
// Only the frozen source-specific profile can add this deterministic input.
// Preview compilation uses canonical bytes in memory; writers materialize them
// before journal application, and model replay independently compares bytes.
export function coherentSourceVisualGuideInputs(plan){
  if(plan.recipe?.intent!==LAYER_SOURCE_INTENT||!['ai_scene_layer_source_scope_v3','ai_scene_layer_source_scope_v4','ai_scene_layer_source_scope_v6'].includes(plan.recipe.sourceScope?.format)
    ||!Object.hasOwn(plan.recipe.sourceScope,'visualGuideProfile'))return [];
  const guide=sourceVisualGuide(plan.recipe.sourceScope.visualGuideProfile);
  check(plan.format==='ai_scene_generation_plan_v27'&&plan.instanceBinding.role==='foreground'&&plan.target.alpha==='transparent'
    &&plan.request.images.length===2&&plan.request.images[0].role===(plan.recipe.sourceScope.referenceStructure?'accepted-scene-style-material-light-and-declared-structure-reference':SOURCE_GUIDED_REFERENCE_ROLE)
    &&plan.request.images[0].artifact.sha256===plan.referenceEvidence[0].rawSha256
    &&plan.request.images[1].role===guide.role&&digest(plan.request.images[1].artifact)===digest(guide.artifact)
    &&plan.sourceScope.visualGuideEvidence?.recipeSha256===guide.recipe.sha256&&plan.sourceScope.visualGuideEvidence.rawSha256===guide.artifact.sha256
    &&plan.sourceScope.visualGuideEvidence.profile===guide.profile&&plan.sourceScope.visualGuideEvidence.role===guide.role,'SOURCE_VISUAL_GUIDE_INPUT');
  return [guide.bytes];
}
export function verifyCoherentSourceVisualGuideInput(plan,readBlob){
  for(const [index,bytes]of coherentSourceVisualGuideInputs(plan).entries()){
    const actual=readBlob(plan.request.images[index+1].artifact.sha256);
    check(actual instanceof Uint8Array&&Buffer.from(actual).equals(bytes),'SOURCE_VISUAL_GUIDE_REPLAY');
  }
}
export function coherentSourceBackgroundBandGuideInputs(plan,readBlob){
  const scope=plan.recipe?.sourceScope,band=scope?.backgroundBand,referenceWindow=isReferenceWindowGuide(scope?.bandCompositionGuide?.spec);
  if(plan.recipe?.intent!==LAYER_SOURCE_INTENT||!['ai_scene_layer_source_scope_v5','ai_scene_layer_source_scope_v6'].includes(scope?.format)||!['ai_scene_background_band_v2','ai_scene_background_band_v3','ai_scene_background_band_v4'].includes(band?.format))return [];
  if(isRegisteredMasterSpec(scope.bandCompositionGuide?.spec))return [];
  if(scope.bandCompositionGuide)check(scope.bandCompositionGuide.spec.referenceRawSha256===plan.referenceEvidence?.[0]?.rawSha256,'BAND_COMPOSITION_REFERENCE');
  const coverage=band.format==='ai_scene_background_band_v3',open=band.format==='ai_scene_background_band_v4',trench=open&&band.guidanceProfile==='open-trench-three-cut-coverage-v2',irregular=open&&band.guidanceProfile==='open-valley-irregular-coverage-v3',guide=scope.bandCompositionGuide?bandCompositionGuide({band,role:plan.instanceBinding.role,...scope.bandCompositionGuide,...(referenceWindow?{referenceBytes:readBlob?.(scope.bandCompositionGuide.spec.referenceRawSha256)}:{})}):irregular?backgroundBandIrregularValleyGuide({canvasAspect:band.canvasAspect,coverageBudget:band.coverageBudget,role:plan.instanceBinding.role}):trench?backgroundBandOpenTrenchGuide({canvasAspect:band.canvasAspect,coverageBudget:band.coverageBudget,role:plan.instanceBinding.role}):open?backgroundBandOpenDepthGuide({canvasAspect:band.canvasAspect,coverageBudget:band.coverageBudget,role:plan.instanceBinding.role}):coverage?backgroundBandCoverageGuide({canvasAspect:band.canvasAspect,coverageBudget:band.coverageBudget,role:plan.instanceBinding.role})
    :backgroundBandGuide(band.guidanceProfile,plan.instanceBinding.role),evidence=plan.sourceScope.backgroundBandGuideEvidence,
    imageRole=scope.bandCompositionGuide?(referenceWindow?BAND_REFERENCE_WINDOW_GUIDE_IMAGE_ROLE:BAND_COMPOSITION_GUIDE_IMAGE_ROLE):irregular?BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_IMAGE_ROLE:trench?BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE:open?BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE:coverage?BACKGROUND_BAND_COVERAGE_GUIDE_IMAGE_ROLE:BACKGROUND_BAND_GUIDE_IMAGE_ROLE;
  check(plan.format==='ai_scene_generation_plan_v27'&&plan.target.alpha==='transparent'&&plan.request.images.length===2
    &&plan.request.images[0].role===(scope.referenceStructure?'accepted-scene-style-material-light-and-declared-structure-reference':'accepted-scene-style-material-light-reference')&&plan.request.images[0].artifact.sha256===plan.referenceEvidence[0].rawSha256
    &&plan.request.images[1].role===imageRole&&digest(plan.request.images[1].artifact)===digest(guide.artifact)
    &&evidence?.profile===guide.profile&&evidence.role===guide.role&&evidence.imageRole===imageRole
    &&evidence.recipeSha256===guide.recipe.sha256&&evidence.rawSha256===guide.artifact.sha256,'BACKGROUND_BAND_GUIDE_INPUT');
  return [guide.bytes];
}
export function coherentSourceFrameGuideInputs(plan,readBlob){
  const scope=plan.recipe?.sourceScope;if(!scope?.sourceFrameGuide)return [];
  const guide=sourceFrameGuide({...scope.sourceFrameGuide,structure:scope.referenceStructure,correction:scope.featureCorrection,supplement:scope.featureSupplement,role:plan.instanceBinding.role,referenceBytes:readBlob?.(scope.sourceFrameGuide.spec.referenceRawSha256)}),e=plan.sourceScope?.sourceFrameGuideEvidence;
  check(plan.format==='ai_scene_generation_plan_v27'&&plan.recipe.intent===LAYER_SOURCE_INTENT&&plan.target.alpha==='transparent'
    &&scope.sourceFrameGuide.spec.instanceId===plan.recipe.assetId&&plan.request.images.length===2
    &&plan.request.images[0].role==='accepted-scene-style-material-light-and-declared-structure-reference'
    &&plan.request.images[0].artifact.sha256===scope.sourceFrameGuide.spec.referenceRawSha256
    &&plan.referenceEvidence[0].rawSha256===scope.sourceFrameGuide.spec.referenceRawSha256
    &&plan.request.images[1].role===guide.role&&digest(plan.request.images[1].artifact)===digest(guide.artifact)
    &&e?.role===guide.role&&e.recipeSha256===guide.recipe.sha256&&e.rawSha256===guide.artifact.sha256,'SOURCE_FRAME_GUIDE_INPUT');
  return [guide.bytes];
}
export function coherentSourceExtraInputs(plan,readBlob){return [...coherentSourceVisualGuideInputs(plan),...coherentSourceBackgroundBandGuideInputs(plan,readBlob),...coherentSourceFrameGuideInputs(plan,readBlob)];}
export function verifyCoherentSourceExtraInputs(plan,readBlob){
  const scope=plan.recipe?.sourceScope;if(isRegisteredMasterSpec(scope?.bandCompositionGuide?.spec)){
    const imageRole=registeredMasterInputRole(scope.bandCompositionGuide.spec);
    const g=previewRegisteredMasterGuide({band:scope.backgroundBand,role:plan.instanceBinding.role,...scope.bandCompositionGuide,masterBytes:readBlob(scope.bandCompositionGuide.spec.master.artifact.sha256)}),e=plan.sourceScope?.backgroundBandGuideEvidence;
    check(plan.format==='ai_scene_generation_plan_v27'&&plan.target.alpha==='transparent'&&plan.request.images.length===1&&plan.request.images[0].role===imageRole&&digest(plan.request.images[0].artifact)===digest(g.artifact)&&plan.referenceEvidence[0].rawSha256===scope.bandCompositionGuide.spec.referenceRawSha256&&e?.profile===g.profile&&e.recipeSha256===g.recipe.sha256&&e.rawSha256===g.artifact.sha256&&e.imageRole===imageRole,'REGISTERED_MASTER_PLAN_INPUT');return;
  }
  verifyCoherentSourceVisualGuideInput(plan,readBlob);
  for(const bytes of coherentSourceFrameGuideInputs(plan,readBlob)){
    const actual=readBlob(plan.request.images[1].artifact.sha256);
    check(actual instanceof Uint8Array&&Buffer.from(actual).equals(bytes),'SOURCE_FRAME_GUIDE_REPLAY');
  }
  for(const [index,bytes]of coherentSourceBackgroundBandGuideInputs(plan,readBlob).entries()){
    const actual=readBlob(plan.request.images[index+1].artifact.sha256);
    check(actual instanceof Uint8Array&&Buffer.from(actual).equals(bytes),'BACKGROUND_BAND_GUIDE_REPLAY');
  }
}
export function envelopeBounds(points){const x=Math.floor(Math.min(...points.map(p=>p.x))),y=Math.floor(Math.min(...points.map(p=>p.y)));
  return {x,y,width:Math.max(1,Math.ceil(Math.max(...points.map(p=>p.x)))-x),height:Math.max(1,Math.ceil(Math.max(...points.map(p=>p.y)))-y)};}
export function assessCoherentSource(plan,bytes,{recalibrateNativeFrame=false,measureVisibleBody=false}={}){
  let image=null,contentBounds=null,hiddenRgbPixels=null,edgeMaximumAlpha=null,topEdgeMaximumAlpha=null,hasVisibleBody=false;const issues=[],
    scope=plan.recipe?.sourceScope,band=scope?.backgroundBand,finiteCuts=plan.recipe?.intent===LAYER_SOURCE_INTENT
      &&['ai_scene_layer_source_scope_v5','ai_scene_layer_source_scope_v6'].includes(plan.recipe.sourceScope.format)
      &&(band?.format==='ai_scene_background_band_v3'&&band.profile==='background-band-coverage-v3'||band?.format==='ai_scene_background_band_v4'&&band.profile==='background-band-open-depth-v4')
      &&band.boundaryProfile==='natural-top-finite-three-cuts-v1'
      &&plan.sourceScope?.definition?.sha256===plan.recipe.sourceScope.sha256
      &&plan.sourceScope?.boundaryPolicy?.profile==='natural-top-finite-three-cuts-v1';
  if(hash(bytes)===plan.referenceEvidence[0].rawSha256)issues.push('COHERENT_REFERENCE_REUSE');
  try{const p=inspectPng(Buffer.from(bytes),{includePixels:true,pixelStats:true,allowCabx:true,allowHiddenRgb:true}),s=plan.target.sourcePolicy;
    image={sha256:hash(bytes),byteLength:bytes.length,pixelSize:{width:p.width,height:p.height}};hiddenRgbPixels=p.hiddenRgbPixels;
    if(isRegisteredLocalEdit(scope?.bandCompositionGuide?.spec)){
      const master=scope.bandCompositionGuide.spec.master.artifact;
      if(!recalibrateNativeFrame&&(p.width!==master.pixelSize.width||p.height!==master.pixelSize.height))issues.push('REGISTERED_LOCAL_EDIT_SIZE');
      if(image.sha256===master.sha256)issues.push('REGISTERED_LOCAL_EDIT_UNCHANGED');
    }
    if(p.width<s.minimumWidth||p.height<s.minimumHeight||p.width>s.maximumWidth||p.height>s.maximumHeight)issues.push('OUTPUT_SIZE');
    if(!p.nonzeroAlphaPixels)issues.push('OUTPUT_EMPTY');if(!p.varied)issues.push('COHERENT_BLANK');
    if(plan.target.alpha==='opaque'&&p.transparentPixels)issues.push('OUTPUT_NOT_OPAQUE');
    if(plan.instanceBinding.role==='material'&&p.width<=p.height)issues.push('MATERIAL_SOURCE_SIZE');
    if(plan.instanceBinding.role==='sky'&&p.width<=p.height)issues.push('COHERENT_SKY_ORIENTATION');
    let minX=p.width,minY=p.height,maxX=-1,maxY=-1,edge=0,topEdge=0,zero=0;
    for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const a=p.rgba[(y*p.width+x)*4+3];if(!a)zero++;
      if(a){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
      if(measureVisibleBody&&a>=8)hasVisibleBody=true;
      if(y<2)topEdge=Math.max(topEdge,a);if(x<2||y<2||x>=p.width-2||y>=p.height-2)edge=Math.max(edge,a);}
    edgeMaximumAlpha=edge;topEdgeMaximumAlpha=topEdge;if(maxX>=0)contentBounds={x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};
    if(plan.target.alpha==='transparent'){if(zero<p.width*p.height/100)issues.push('COHERENT_NO_TRANSPARENCY');
      if(finiteCuts?topEdge>1:edge>1)issues.push(finiteCuts?'COHERENT_BACKGROUND_TOP_GUTTER':'COHERENT_CLIPPED_SILHOUETTE');}
  }catch{issues.push('OUTPUT_PNG_UNSUPPORTED');}
  return seal({format:'ai_scene_coherent_source_qa_v1',planSha256:plan.sha256,rawSha256:hash(bytes),image,contentBounds,hiddenRgbPixels,edgeMaximumAlpha,
    ...(measureVisibleBody?{hasVisibleBody}:{}),
    ...(finiteCuts?{boundaryProfile:band.boundaryProfile,topEdgeMaximumAlpha,declaredFiniteCuts:['left','right','bottom'],
      cutAlphaModified:false,contentContinuity:'not-assessed'}:{}),
    issues,status:issues.length?'fail':'pass',sourcePngModified:false,semanticArtAcceptance:'not-assessed',pixelIdentityAssessed:false,automaticRetry:false});
}
export function compileCoherentBatch(state,options){
  exact(options,['batchId','referencePlanSha256','planSha256s','parentBatchSha256']);id(options.batchId);
  const ref=state.plans.get(options.referencePlanSha256),spec=state.designs.get(ref?.plan.recipe.specSha256);
  check(ref?.status==='accepted'&&spec,'COHERENT_REFERENCE_REQUIRED');
  const inventory=coherentInventory(ref,spec),parent=options.parentBatchSha256===null?null:state.batches.get(options.parentBatchSha256);
  check(options.parentBatchSha256===null||(['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(parent?.format)&&parent.referencePlanSha256===options.referencePlanSha256),'COHERENT_BATCH_PARENT');
  check(Array.isArray(options.planSha256s)&&options.planSha256s.length===inventory.length&&new Set(options.planSha256s).size===inventory.length,'COHERENT_BATCH_COVERAGE');
  const ids=new Set(),preparedPlanSha256s=[],reboundPlanSha256s=[];let newRequests=0,changes=0;
  for(const sha of options.planSha256s){const e=state.plans.get(sha),asset=e?.plan.recipe.assetId;
    const prepared=['ai_scene_coherent_border_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v2','ai_scene_coherent_native_frame_preparation_v1'].includes(e?.plan.format);
    const rebound=e?.plan.format==='ai_scene_coherent_rebind_v1';
    check((prepared||rebound||e?.plan.format==='ai_scene_generation_plan_v27')&&e.plan.recipe.referencePlans[0]===options.referencePlanSha256
      &&e.plan.recipe.targetSha256===ref.reconstructionTarget.sha256&&!ids.has(asset),'COHERENT_BATCH_COVERAGE');ids.add(asset);
    if(prepared)preparedPlanSha256s.push(sha);
    if(rebound){check(e.kind==='coherent-rebind'&&['pending-visual-review','accepted'].includes(e.status)&&e.plan.request.maximumCalls===0
      &&e.plan.receipt?.decision==='accept'&&e.plan.receipt.targetSha256===e.plan.proposal?.sha256
      &&e.result?.format==='ai_scene_coherent_rebind_result_v1'&&e.result.rebindSha256===sha
      &&e.result.targetPlanSha256===e.plan.targetPlanSha256&&e.result.maximumCalls===0
      &&e.result.rawSha256===e.plan.rawSha256&&e.result.technical?.status==='pass'
      &&e.result.technical.sha256===e.plan.technical.sha256&&e.plan.technical.planSha256===e.plan.targetPlanSha256,'COHERENT_BATCH_REBIND');reboundPlanSha256s.push(sha);}
    const prior=parent?.planSha256s.find(s=>state.plans.get(s).plan.recipe.assetId===asset);
    if(prior===sha)check(['planned','authorized','pending-visual-review','accepted'].includes(e.status),'COHERENT_BATCH_REUSE');
    else{changes++;
      if(rebound){
        const latest=[...state.batches.values()].findLast(b=>['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)&&b.referencePlanSha256===options.referencePlanSha256);
        check(parent&&e.plan.targetPlanSha256===prior&&e.plan.parentBatchSha256===parent.sha256
          &&e.plan.intendedBatchId===options.batchId&&latest?.sha256===parent.sha256,'COHERENT_BATCH_REPLACEMENT');
      }
      else if(prepared){check(parent&&['coherent-border-preparation','coherent-canvas-gutter-preparation','coherent-native-frame-preparation'].includes(e.kind)&&['pending-visual-review','accepted'].includes(e.status)
        &&e.plan.sourcePlanSha256===prior&&e.plan.request.maximumCalls===0,'COHERENT_BATCH_REPLACEMENT');
        if(['coherent-canvas-gutter-preparation','coherent-native-frame-preparation'].includes(e.kind)){
          const latest=[...state.batches.values()].findLast(b=>['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)&&b.referencePlanSha256===options.referencePlanSha256);
          check(e.plan.proposal.parentBatchSha256===parent.sha256&&latest?.sha256===parent.sha256,'COHERENT_CANVAS_GUTTER_PARENT_STALE');
        }
      }
      else{check(e.status==='planned'&&(!parent||e.plan.recipe.parents[0]===prior),'COHERENT_BATCH_REPLACEMENT');newRequests++;}}}
  const v3=reboundPlanSha256s.length>0||parent?.format==='ai_scene_coherent_source_batch_v3';
  const v2=preparedPlanSha256s.length>0||parent?.format==='ai_scene_coherent_source_batch_v2'||v3;
  const visualShas=options.planSha256s.map(sha=>state.plans.get(sha).plan.sourceScope?.definition?.visualCoherence?.sha256??null);
  if(visualShas.some(Boolean))check(visualShas.every(sha=>sha===visualShas[0]),'COHERENT_BATCH_VISUAL_COHERENCE');
  const corrections=options.planSha256s.map(sha=>state.plans.get(sha).plan.sourceScope?.definition?.featureCorrection).filter(Boolean);
  if(corrections.length)check(corrections.every(c=>digest(c)===digest(corrections[0])),'REFERENCE_FEATURE_CORRECTION_BATCH_CONFLICT');
  const supplements=options.planSha256s.map(sha=>state.plans.get(sha).plan.sourceScope?.definition?.featureSupplement).filter(Boolean);
  if(supplements.length)check(supplements.every(s=>digest(s)===digest(supplements[0])),'REFERENCE_FEATURE_SUPPLEMENT_BATCH_CONFLICT');
  const structures=options.planSha256s.map(sha=>state.plans.get(sha).plan.recipe.sourceScope?.referenceStructure).filter(Boolean);
  if(structures.length){
    if(!parent)check(structures.every(s=>s.sha256===structures[0].sha256),'REFERENCE_STRUCTURE_BATCH_CONFLICT');
    const assets=new Map();
    for(const structure of structures){
      check(structure.referenceRawSha256===structures[0].referenceRawSha256
        &&digest(structure.viewport)===digest(structures[0].viewport),'REFERENCE_STRUCTURE_BATCH_CONFLICT');
      for(const asset of structure.assets){
        const sha=digest(asset),prior=assets.get(asset.instanceId);
        check(!prior||prior===sha,'REFERENCE_STRUCTURE_BATCH_CONFLICT');
        check(inventory.some(i=>i.assetId===asset.instanceId&&i.instance?.subjectId===asset.subjectId),'REFERENCE_STRUCTURE_BATCH_COVERAGE');
        assets.set(asset.instanceId,sha);
      }
    }
  }
  check(inventory.every(i=>ids.has(i.assetId))&&(v2?changes>0:newRequests>0),'COHERENT_BATCH_COVERAGE');
  for(const sha of options.planSha256s){const dependency=state.plans.get(sha).plan.recipe.sourceDependency;
    if(dependency)check(options.planSha256s.includes(dependency.sourcePlanSha256),'SOURCE_DEPENDENCY_BATCH');}
  return seal({format:v3?'ai_scene_coherent_source_batch_v3':v2?'ai_scene_coherent_source_batch_v2':'ai_scene_coherent_source_batch_v1',...options,targetSha256:ref.reconstructionTarget.sha256,
    policySha256:COHERENT_POLICY.sha256,maximumCalls:v2?options.planSha256s.reduce((n,s)=>n+state.plans.get(s).plan.request.maximumCalls,0):inventory.length,
    newImageRequests:newRequests,automaticRetry:false,...(v2?{preparedPlanSha256s}:{}),
    ...(v3?{reboundPlanSha256s}:{}),
    ...(visualShas[0]?{visualCoherenceSha256:visualShas[0]}:{})});
}
