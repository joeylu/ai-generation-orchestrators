import { inspectPng, encodeRgbaPng } from '../png.mjs';
import { areaResample } from '../terrain-proof/raster.mjs';
import { compilePaintSourcePlan, assessPaintSource, compilePaintApplicationProposal, paintApplicationGeometryProposal } from './reference-paint.mjs';
import { check, digest, exact, hash, id, imageRef, isDigest, seal, unseal, text } from './common.mjs';

export const MATERIAL_DESIGN_FILES = ['next-step-proposal.json', 'zone-recipe.json', 'vector-draft.json',
  'material-core-labels.bin', 'material-zone-guide.png', 'probe-plan.json'];
const roles = ['body-appearance', 'wood', 'snow'];
const palette = [[52,59,68], [174,182,194], [158,107,61], [219,234,250]];
export function validateMaterialDesignPacket(value) {
  const p = unseal(value);
  exact(p, ['format', 'sourceReviewPacketSha256', 'proposalSha256', 'artifacts', 'computeAuthorized']);
  check(p.format === 'ai_scene_material_design_control_packet_v1' && isDigest(p.sourceReviewPacketSha256)
    && isDigest(p.proposalSha256) && p.computeAuthorized === false && Array.isArray(p.artifacts)
    && p.artifacts.length === MATERIAL_DESIGN_FILES.length, 'MATERIAL_CONTROL_PACKET');
  const seen = new Set(); let total = 0;
  for (const a of p.artifacts) {
    exact(a, ['path', 'sha256', 'byteLength']);
    check(MATERIAL_DESIGN_FILES.includes(a.path) && !seen.has(a.path) && isDigest(a.sha256)
      && Number.isSafeInteger(a.byteLength) && a.byteLength > 0 && a.byteLength <= 16777216, 'MATERIAL_CONTROL_ARTIFACTS');
    seen.add(a.path); total += a.byteLength;
  }
  check(total <= 33554432, 'MATERIAL_CONTROL_ARTIFACTS'); return p;
}
// Reviewed labels are explicit authoring data, not inferred material or measured optical Alpha.
// Replay only the guide's declared core protection and square eight-pixel paint halo.
export function materialGuidePixels(labels, width, height) {
  check(labels.length === width * height, 'MATERIAL_LABELS');
  const supports = [];
  for (let role = 1; role <= 3; role++) {
    const horizontal = Buffer.alloc(labels.length), expanded = Buffer.alloc(labels.length);
    for (let y = 0; y < height; y++) {
      let count = 0;
      for (let x = 0; x < Math.min(8, width); x++) count += labels[y*width+x] === role;
      for (let x = 0; x < width; x++) {
        if (x+8 < width) count += labels[y*width+x+8] === role;
        if (x-9 >= 0) count -= labels[y*width+x-9] === role;
        horizontal[y*width+x] = count > 0 ? 1 : 0;
      }
    }
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let y = 0; y < Math.min(8, height); y++) count += horizontal[y*width+x];
      for (let y = 0; y < height; y++) {
        if (y+8 < height) count += horizontal[(y+8)*width+x];
        if (y-9 >= 0) count -= horizontal[(y-9)*width+x];
        expanded[y*width+x] = count > 0 ? 1 : 0;
      }
    }
    supports.push(expanded);
  }
  const rgba = Buffer.alloc(labels.length*4);
  for (let i = 0; i < labels.length; i++) {
    check(labels[i] <= 3, 'MATERIAL_LABELS');
    const code = labels[i] || (supports[2][i] ? 3 : supports[1][i] ? 2 : supports[0][i] ? 1 : 0);
    rgba.set([...palette[code],255], i*4);
  }
  return rgba;
}
export const renderMaterialGuide = (labels, width, height) => encodeRgbaPng(width,height,materialGuidePixels(labels,width,height));
export function compileMaterialControls(state, options, readBlob) {
  exact(options, ['controlId', 'basePaintControlsSha256', 'reviewPacket']); id(options.controlId);
  const packet = validateMaterialDesignPacket(options.reviewPacket), base = state.paintControls.get(options.basePaintControlsSha256);
  check(base && state.paintControlReviews.get(base.sha256)?.receipt.decision === 'accept'
    && base.specSha256 === state.activeSpec && base.styleSha256 === state.activeStyle, 'MATERIAL_BASE_REVIEW_REQUIRED');
  const files = new Map(packet.artifacts.map(a => {
    const bytes = readBlob(a.sha256); check(bytes instanceof Uint8Array && bytes.length === a.byteLength && hash(bytes) === a.sha256, 'MATERIAL_CONTROL_ARTIFACTS');
    return [a.path, Buffer.from(bytes)];
  }));
  const json = name => { const v = JSON.parse(files.get(name).toString('utf8')); unseal(v); text(JSON.stringify(v), {limit:200000}); return v; };
  const proposal = json('next-step-proposal.json'), recipe = json('zone-recipe.json'), vectors = json('vector-draft.json'), probes = json('probe-plan.json');
  const guide = imageRef(files.get('material-zone-guide.png')), labels = files.get('material-core-labels.bin');
  const size = base.geometry.localCanvas, alpha = inspectPng(readBlob(base.geometryAlpha.sha256), {includePixels:true});
  check(proposal.format === 'ai_scene_material_alignment_design_proposal_v1' && proposal.sha256 === packet.proposalSha256
    && proposal.previousSourceDesignSha256 === base.design.sha256 && proposal.zoneRecipeSha256 === recipe.sha256
    && proposal.probePlanSha256 === probes.sha256 && proposal.computeAuthorized === false
    && digest(proposal.inputRoles.map(i=>i.sha256)) === digest([base.guide.sha256,guide.sha256,base.originalReference.sha256]), 'MATERIAL_DESIGN_BINDING');
  check(recipe.format === 'ai_scene_material_alignment_zone_recipe_v1' && recipe.geometryAlphaSha256 === base.geometryAlpha.sha256
    && recipe.vectorDraftSha256 === vectors.sha256 && digest(recipe.canvas) === digest(size) && recipe.paintBleedPx === 8
    && recipe.deliveryAlphaUnchanged === true && recipe.opticalAlphaMeasured === false
    && digest(recipe.corePriority) === digest(['body-appearance','snow','wood'])
    && recipe.bleedPriority === 'protect-core-then-snow-before-wood-before-body-guide-only', 'MATERIAL_RECIPE');
  check(Array.isArray(vectors.components) && vectors.components.length > 0 && vectors.components.length <= 256
    && Array.isArray(recipe.assignments) && recipe.assignments.length === vectors.components.length, 'MATERIAL_ASSIGNMENTS');
  const assignments = new Map();
  for (const a of recipe.assignments) {
    check(typeof a.componentId === 'string' && !assignments.has(a.componentId) && roles.includes(a.materialRole), 'MATERIAL_ASSIGNMENTS');
    assignments.set(a.componentId, a.materialRole);
  }
  check(new Set(vectors.components.map(c=>c.id)).size === vectors.components.length
    && vectors.components.every(c=>assignments.has(c.id)), 'MATERIAL_ASSIGNMENTS');
  check(labels.length === size.width * size.height && digest(guide.pixelSize) === digest(size), 'MATERIAL_LABELS');
  const counts = [0,0,0,0];
  for (let i=0; i<labels.length; i++) {
    check(labels[i] <= 3 && Boolean(labels[i]) === Boolean(alpha.rgba[i*4+3]), 'MATERIAL_LABELS'); counts[labels[i]]++;
  }
  check(counts.slice(1).every(n=>n>0), 'MATERIAL_LABELS');
  const expected = materialGuidePixels(labels,size.width,size.height), decoded = inspectPng(files.get('material-zone-guide.png'), {includePixels:true});
  check(expected.equals(decoded.rgba), 'MATERIAL_GUIDE_REPLAY');
  check(probes.format === 'ai_scene_material_coverage_probe_plan_v1' && probes.recipeSha256 === recipe.sha256
    && probes.opacityAloneCertifiesCoverage === false && probes.colorThresholdAloneCertifiesCoverage === false
    && probes.automaticGrayRemoval === false && Array.isArray(probes.probes) && probes.probes.length > 0 && probes.probes.length <= 512, 'MATERIAL_PROBES');
  const seen = new Set(), exposed = new Set();
  const probeDefinitions = probes.probes.map(p=>{
    check(typeof p.probeId === 'string' && !seen.has(p.probeId) && roles.includes(p.expectedMaterial)
      && Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y) && p.x>=0 && p.x<size.width && p.y>=0 && p.y<size.height
      && labels[p.y*size.width+p.x] === roles.indexOf(p.expectedMaterial)+1, 'MATERIAL_PROBES');
    check(p.componentId === 'known-failure-site' || assignments.get(p.componentId) === p.expectedMaterial, 'MATERIAL_PROBES');
    seen.add(p.probeId); exposed.add(p.componentId);
    return {probeId:p.probeId,componentId:p.componentId,expectedMaterial:p.expectedMaterial,x:p.x,y:p.y};
  });
  check(recipe.assignments.filter(a=>a.materialRole!=='body-appearance').every(a=>exposed.has(a.componentId)), 'MATERIAL_PROBES');
  return seal({format:'ai_scene_material_paint_controls_v1', ...options, compiler:'scene-kit-reviewed-material-labels-v1',
    referencePlanSha256:base.referencePlanSha256,specSha256:base.specSha256,styleSha256:base.styleSha256,targetSha256:base.targetSha256,
    instanceId:base.instanceId,proposal,recipe,probeDefinitions,materialGuide:guide,
    labels:{sha256:hash(labels),byteLength:labels.length},labelAuthority:'reviewed-design-not-inferred-reference-material',generationCalls:0});
}
function materialPrompt(base) {
  // v25 drafts explicitly number two inputs. Rebind every reference to the full image to input 3.
  const original = base.design.sourcePaintDraft.prompt.replaceAll('输入2','输入3');
  return original + '\n\n输入2是同画布的材质语义引导，不是成品美术：棕色区画木材，浅蓝白区画雪，灰蓝主体区按输入3画岩雪结构。类别色只表示部位，不复制平涂标签。输入1管几何范围，输入2管该部位画什么，输入3管外观。按原参考保留木/雪交界；核心位置和外侧8px绘制余量都须覆盖对应材质，细枝和雪尖画宽底色，不必预先剪成最终细轮廓。灰底不能占据目标核心，禁止文字或类别色标签。\n\n后续先核对未遮罩源的部件、关键点、木/雪/主体完整区域及交界；不透明或颜色阈值不等于材质正确。失败或未定项不得进入Alpha应用；不得擦灰、删枝、改变最终Alpha、回填原图或自动修正位置。';
}
export function compileMaterialPaintPlan(state, recipe, readBlob) {
  const {materialControlsSha256,...baseRecipe} = recipe, c = state.materialPaintControls.get(materialControlsSha256);
  const review = state.materialPaintControlReviews.get(materialControlsSha256);
  check(c && review?.receipt.decision === 'accept' && review.proposalSha256 === c.proposal.sha256
    && baseRecipe.paintControlsSha256 === c.basePaintControlsSha256, 'MATERIAL_DESIGN_REVIEW_REQUIRED');
  check(Array.isArray(recipe.parents) && recipe.parents.length<=1, 'PLAN_PARENT');
  if(recipe.parents.length) {
    const parent=state.plans.get(recipe.parents[0]);
    check(parent?.plan.format==='ai_scene_generation_plan_v26' && parent.plan.recipe.materialControlsSha256===c.sha256
      && ['failed','indeterminate','rejected-technical','rejected-visual'].includes(parent.status), 'PLAN_PARENT');
  }
  const base = state.paintControls.get(c.basePaintControlsSha256), cap=state.capabilities.get(recipe.capabilitiesSha256);
  check(cap?.maxInputImages>=3, 'MATERIAL_CAPABILITY');
  const p=unseal(compilePaintSourcePlan(state,{...baseRecipe,parents:[]},readBlob));
  check(hash(readBlob(c.materialGuide.sha256))===c.materialGuide.sha256 && hash(readBlob(c.labels.sha256))===c.labels.sha256, 'MATERIAL_CONTROL_ARTIFACTS');
  return seal({...p,format:'ai_scene_generation_plan_v26',compiler:'scene-kit-material-aligned-paint-v1',recipe,
    designReviews:{...p.designReviews,materialAlignment:review.sha256},
    materialControlEvidence:{controlsSha256:c.sha256,proposalSha256:c.proposal.sha256,reviewSha256:review.sha256,
      guideSha256:c.materialGuide.sha256,labelsSha256:c.labels.sha256,probes:c.probeDefinitions},
    coveragePolicy:{requiredBeforeSourceAcceptance:true,requiredBeforeApplication:true,regions:[...roles,'transitions'],
      allProbesRequired:true,failOrUncertainBlocks:true,automaticSemanticClassification:false},
    request:{...p.request,format:'ai_scene_image_request_v26',prompt:materialPrompt(base),images:[p.request.images[0],
      {role:'reviewed-material-core-and-eight-pixel-paint-halo-soft-guide',artifact:c.materialGuide},p.request.images[1]]}});
}
export function compileMaterialCoverageProposal(state, planSha256, readBlob) {
  const e=state.plans.get(planSha256), plan=e?.plan;
  check(plan?.format==='ai_scene_generation_plan_v26' && e.result?.technical.status==='pass'
    && ['pending-visual-review','accepted','rejected-visual'].includes(e.status), 'MATERIAL_COVERAGE_STATE');
  const bytes=readBlob(e.result.rawSha256),qa=assessPaintSource(plan,bytes); check(qa.status==='pass','PAINT_SOURCE_TECHNICAL');
  const raw=inspectPng(bytes,{includePixels:true,allowCabx:true}),size=plan.target.localCanvas;
  const image=areaResample(raw,{x:0,y:0,width:raw.width,height:raw.height},size.width,size.height);
  return seal({format:'ai_scene_material_coverage_proposal_v1',planSha256,rawSha256:hash(bytes),technicalSha256:qa.sha256,
    controlsSha256:plan.materialControlEvidence.controlsSha256,normalizedRgbaSha256:hash(image.rgba),mapping:qa.mapping,
    probes:plan.materialControlEvidence.probes.map(p=>({...p,rgba:[...image.rgba.subarray((p.y*size.width+p.x)*4,(p.y*size.width+p.x)*4+4)]})),
    regions:plan.coveragePolicy.regions,semanticDecision:'not-assessed',alphaApplied:false,automaticGrayRemoval:false});
}
export function validateMaterialCoverage(proposal, observation, receipt) {
  exact(observation,['probes','regions']);
  let pass=true;
  for(const [key,definitions,idKey] of [['probes',proposal.probes,'probeId'],['regions',proposal.regions.map(region=>({region})),'region']]) {
    check(Array.isArray(observation[key]) && observation[key].length===definitions.length,'MATERIAL_COVERAGE_INCOMPLETE');
    const seen=new Set();
    for(const item of observation[key]) {
      exact(item,[idKey,'verdict','notes']); text(item.notes,{limit:2000});
      check(definitions.some(d=>d[idKey]===item[idKey]) && !seen.has(item[idKey]) && ['pass','fail','uncertain'].includes(item.verdict),'MATERIAL_COVERAGE_INCOMPLETE');
      seen.add(item[idKey]); pass &&= item.verdict==='pass';
    }
  }
  check(receipt.targetSha256===proposal.sha256 && (receipt.decision!=='accept'||pass),'MATERIAL_COVERAGE_NOT_PASSED');
}
export function requireMaterialCoverage(state, planSha256) {
  const review=state.materialCoverageReviews.get(planSha256), e=state.plans.get(planSha256);
  check(review?.receipt.decision==='accept' && review.rawSha256===e?.result?.rawSha256,'MATERIAL_COVERAGE_REVIEW_REQUIRED'); return review;
}
export function materialApplicationProposal(state, sha) {
  const e=state.plans.get(sha);
  if(e?.plan.format!=='ai_scene_generation_plan_v26') return compilePaintApplicationProposal(state,sha);
  const coverage=requireMaterialCoverage(state,sha);
  const c=state.materialPaintControls.get(e.plan.recipe.materialControlsSha256), review=state.materialPaintControlReviews.get(c?.sha256);
  check(c && review?.receipt.decision==='accept' && review.proposalSha256===c.proposal.sha256,'MATERIAL_DESIGN_REVIEW_REQUIRED');
  return seal({...unseal(paintApplicationGeometryProposal(state,e,state.paintControls.get(c.basePaintControlsSha256),sha)),format:'ai_scene_paint_application_proposal_v2',
    materialControlsSha256:e.plan.recipe.materialControlsSha256,materialCoverageReviewSha256:coverage.sha256,
    materialCoverageProposalSha256:coverage.proposalSha256});
}
