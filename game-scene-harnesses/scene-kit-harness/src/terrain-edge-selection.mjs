import {canonicalJson,clone} from './document.mjs';
import {check,hash,isDigest,seal,unseal} from './generation/common.mjs';
import {getTerrainEdgeInputs} from './generation/index.mjs';

const roles=['left-wall','right-wall','left-top-corner','right-top-corner','bottom-edge','left-bottom-corner','right-bottom-corner'];
const upper=['left-top-corner','right-top-corner'];
const sideRoles=roles.slice(0,4);
const bindings=['baseBatchSha256','referencePlanSha256','targetSha256','materialPlanSha256','materialRawSha256','policySha256','nativeSizeProfile','renderEnvelopeProfile','naturalSurfaceProfile'];

// Both inputs must come from the workflow's checked read API. This is a
// delivery selection, never a new executable generation batch or authorization.
export function combineTerrainUpperInputs(base,replacement){
  for(const view of [base,replacement]){
    unseal(view.batch);
    check(view.sources.length===view.batch.planSha256s.length
      &&view.sources.every(item=>view.batch.planSha256s.includes(item.plan.sha256)
        &&['pending-visual-review','accepted'].includes(item.status)&&item.result.technical.status==='pass'
        &&hash(item.raw)===item.result.rawSha256),'TERRAIN_UPPER_SELECTION_SOURCE');
  }
  const sameRoles=(items,expected)=>items.length===expected.length&&expected.every(role=>items.filter(s=>s.plan.recipe.edgeRole===role).length===1);
  check(base.batch.coverageProfile==='full-perimeter-v1'&&sameRoles(base.sources,roles)
    &&replacement.batch.coverageProfile==='full-perimeter-v1'&&replacement.batch.coverage==='explicit-subset-replacement'
    &&sameRoles(replacement.sources,upper),'TERRAIN_UPPER_SELECTION_COVERAGE');
  check(base.batch.sha256!==replacement.batch.sha256
    &&bindings.every(key=>base.batch[key]!==undefined&&base.batch[key]===replacement.batch[key])
    &&canonicalJson(base.reference.plan)===canonicalJson(replacement.reference.plan)
    &&Buffer.from(base.reference.raw).equals(Buffer.from(replacement.reference.raw))
    &&canonicalJson(base.material.plan)===canonicalJson(replacement.material.plan)
    &&Buffer.from(base.material.raw).equals(Buffer.from(replacement.material.raw)),'TERRAIN_UPPER_SELECTION_BINDING');
  const sources=base.sources.map(old=>upper.includes(old.plan.recipe.edgeRole)
    ?replacement.sources.find(item=>item.plan.recipe.edgeRole===old.plan.recipe.edgeRole):old);
  check(upper.every(role=>base.sources.find(s=>s.plan.recipe.edgeRole===role).plan.sha256
    !==sources.find(s=>s.plan.recipe.edgeRole===role).plan.sha256),'TERRAIN_UPPER_SELECTION_UNCHANGED');
  const selection=seal({format:'ai_scene_terrain_upper_selection_v1',profile:'native-upper-pair-replacement-v1',
    baseBatchSha256:base.batch.sha256,replacementBatchSha256:replacement.batch.sha256,
    bindings:Object.fromEntries(bindings.map(key=>[key,clone(base.batch[key])])),
    sources:sources.map(item=>({edgeRole:item.plan.recipe.edgeRole,planSha256:item.plan.sha256,
      resultSha256:item.result.sha256,rawSha256:item.result.rawSha256,technicalSha256:item.result.technical.sha256,
      batchSha256:(upper.includes(item.plan.recipe.edgeRole)?replacement:base).batch.sha256,
      ...(upper.includes(item.plan.recipe.edgeRole)?{replacedPlanSha256:base.sources.find(s=>s.plan.recipe.edgeRole===item.plan.recipe.edgeRole).plan.sha256}:{})})),
    generationCalls:0,computeAuthorizationIncluded:false,artAcceptance:'not-transferred'});
  return {...base,sources,selection,replacementInputs:replacement};
}

export function readTerrainUpperSelection(workflow,baseSha256,replacementSha256){
  return combineTerrainUpperInputs(getTerrainEdgeInputs(workflow,baseSha256),getTerrainEdgeInputs(workflow,replacementSha256));
}

// Explicit disjoint side/top subsets let a completed wall revision reuse the other
// checked roles. Keep the historical upper-pair record and its caller unchanged.
export function combineTerrainSideInputs(base,replacements){
  check(Array.isArray(replacements)&&replacements.length>0&&replacements.length<=sideRoles.length,
    'TERRAIN_PERIMETER_SELECTION_COVERAGE');
  const views=[base,...replacements];
  for(const view of views){
    unseal(view.batch);
    check(view.sources.length===view.batch.planSha256s.length
      &&new Set(view.sources.map(s=>s.plan.sha256)).size===view.sources.length
      &&view.sources.every(item=>view.batch.planSha256s.includes(item.plan.sha256)
        &&['pending-visual-review','accepted'].includes(item.status)&&item.result.technical.status==='pass'
        &&hash(item.raw)===item.result.rawSha256),'TERRAIN_PERIMETER_SELECTION_SOURCE');
  }
  check(base.batch.coverageProfile==='full-perimeter-v1'&&base.sources.length===roles.length
    &&roles.every(role=>base.sources.filter(s=>s.plan.recipe.edgeRole===role).length===1),
  'TERRAIN_PERIMETER_SELECTION_COVERAGE');
  check(new Set(views.map(v=>v.batch.sha256)).size===views.length,'TERRAIN_PERIMETER_SELECTION_BINDING');
  const selected=new Map(),ordered=[...replacements].sort((a,b)=>a.batch.sha256.localeCompare(b.batch.sha256));
  for(const view of ordered){
    check(view.batch.coverageProfile==='full-perimeter-v1'&&view.batch.coverage==='explicit-subset-replacement'
      &&view.sources.length>0&&view.sources.length<=sideRoles.length,'TERRAIN_PERIMETER_SELECTION_COVERAGE');
    check(bindings.every(key=>base.batch[key]!==undefined&&base.batch[key]===view.batch[key])
      &&canonicalJson(base.reference.plan)===canonicalJson(view.reference.plan)
      &&Buffer.from(base.reference.raw).equals(Buffer.from(view.reference.raw))
      &&canonicalJson(base.material.plan)===canonicalJson(view.material.plan)
      &&Buffer.from(base.material.raw).equals(Buffer.from(view.material.raw)),'TERRAIN_PERIMETER_SELECTION_BINDING');
    for(const item of view.sources){
      const role=item.plan.recipe.edgeRole;
      check(sideRoles.includes(role),'TERRAIN_PERIMETER_SELECTION_COVERAGE');
      check(!selected.has(role),'TERRAIN_PERIMETER_SELECTION_DUPLICATE_ROLE');
      check(base.sources.find(s=>s.plan.recipe.edgeRole===role).plan.sha256!==item.plan.sha256,
        'TERRAIN_PERIMETER_SELECTION_UNCHANGED');
      selected.set(role,{item,view});
    }
  }
  const sources=base.sources.map(old=>selected.get(old.plan.recipe.edgeRole)?.item??old),
    selection=seal({format:'ai_scene_terrain_side_selection_v1',profile:'checked-side-subset-replacement-v1',
      baseBatchSha256:base.batch.sha256,replacementBatchSha256s:ordered.map(v=>v.batch.sha256),
      bindings:Object.fromEntries(bindings.map(key=>[key,clone(base.batch[key])])),
      sources:sources.map(item=>{const replacement=selected.get(item.plan.recipe.edgeRole);return {
        edgeRole:item.plan.recipe.edgeRole,planSha256:item.plan.sha256,resultSha256:item.result.sha256,
        rawSha256:item.result.rawSha256,technicalSha256:item.result.technical.sha256,
        batchSha256:replacement?.view.batch.sha256??base.batch.sha256,
        ...(replacement?{replacedPlanSha256:base.sources.find(s=>s.plan.recipe.edgeRole===item.plan.recipe.edgeRole).plan.sha256}:{})};}),
      generationCalls:0,computeAuthorizationIncluded:false,artAcceptance:'not-transferred'});
  return {...base,sources,selection,sideReplacementInputs:ordered};
}

export function readTerrainSideSelection(workflow,baseSha256,replacementSha256s){
  check(Array.isArray(replacementSha256s)&&replacementSha256s.length>0&&replacementSha256s.length<=sideRoles.length
    &&replacementSha256s.every(isDigest)&&new Set(replacementSha256s).size===replacementSha256s.length
    &&!replacementSha256s.includes(baseSha256),'TERRAIN_PERIMETER_SELECTION_BINDING');
  return combineTerrainSideInputs(getTerrainEdgeInputs(workflow,baseSha256),
    replacementSha256s.map(sha=>getTerrainEdgeInputs(workflow,sha)));
}

export function terrainEdgeSourceOrigin(inputs,item){
  if(inputs.sideReplacementInputs)return inputs.sideReplacementInputs.find(view=>
    view.sources.some(source=>source.plan.sha256===item.plan.sha256))??inputs;
  return inputs.replacementInputs?.sources.some(source=>source.plan.sha256===item.plan.sha256)?inputs.replacementInputs:inputs;
}
