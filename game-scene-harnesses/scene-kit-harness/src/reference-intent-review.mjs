import {check,digest,exact,id,isDigest,seal,text,unseal} from './generation/common.mjs';

export const REFERENCE_INTENT_CRITERIA=Object.freeze([
  'content-ownership','depth-and-occlusion','independent-editing',
  'openings-and-contacts','composition-intent'
]);

// An explicit authoring review changes what this new candidate is trying to
// match. It never edits the generation plan, strict diagnosis or source bytes.
export function applyReferenceIntentReview(strict,{intentReview,structure,measurements,sources}){
  if(intentReview===undefined)return strict;
  const policy=unseal(intentReview);
  exact(policy,['format','profile','structureSha256','measurementsSha256','evidenceSha256','reviewer','intentReason','assets']);
  check(policy.format==='ai_scene_reference_intent_review_v1'&&policy.profile==='reference-inspired-v1'
    &&policy.structureSha256===strict.structureSha256&&policy.measurementsSha256===digest(measurements)
    &&isDigest(policy.evidenceSha256)&&['agent','human'].includes(policy.reviewer),'REFERENCE_INTENT_BINDING');
  text(policy.intentReason,{limit:1200});
  check(Array.isArray(policy.assets)&&policy.assets.length>0&&policy.assets.length<=structure.assets.length,'REFERENCE_INTENT_ASSETS');
  const selected=new Map();
  for(const asset of policy.assets){
    exact(asset,['instanceId','sourcePlanSha256','sourceRawSha256','acceptedFeatureIds','acceptedCheckIds','judgments']);id(asset.instanceId);
    const declaration=structure.assets.find(a=>a.instanceId===asset.instanceId),row=strict.rows.find(r=>r.instanceId===asset.instanceId),source=sources.find(s=>s.plan.sha256===asset.sourcePlanSha256);
    check(declaration&&row&&source&&!selected.has(asset.instanceId)&&row.sourcePlanSha256===asset.sourcePlanSha256&&row.sourceRawSha256===asset.sourceRawSha256,'REFERENCE_INTENT_SOURCE');
    check(!source.plan.sourceScope?.definition?.backgroundBand,'REFERENCE_INTENT_ISOLATED_ONLY');
    for(const [key,declared,idKey]of [['acceptedFeatureIds',declaration.features,'featureId'],['acceptedCheckIds',declaration.checks,'checkId']]){
      check(Array.isArray(asset[key])&&asset[key].length<=16&&new Set(asset[key]).size===asset[key].length
        &&asset[key].every(value=>declared.some(item=>item[idKey]===value)),'REFERENCE_INTENT_VARIATIONS');
    }
    check(Array.isArray(asset.judgments)&&asset.judgments.length===REFERENCE_INTENT_CRITERIA.length
      &&new Set(asset.judgments.map(j=>j.criterion)).size===REFERENCE_INTENT_CRITERIA.length,'REFERENCE_INTENT_JUDGMENTS');
    for(const judgment of asset.judgments){exact(judgment,['criterion','verdict','notes']);
      check(REFERENCE_INTENT_CRITERIA.includes(judgment.criterion)&&['pass','fail','uncertain'].includes(judgment.verdict),'REFERENCE_INTENT_JUDGMENTS');text(judgment.notes,{limit:1200});}
    selected.set(asset.instanceId,asset);
  }
  const rows=strict.rows.map(row=>{
    const accepted=selected.get(row.instanceId);if(!accepted)return row;
    const declaration=structure.assets.find(a=>a.instanceId===row.instanceId),observed=measurements.find(m=>m.instanceId===row.instanceId);
    // Missing evidence, invalid scale and other technical constraints cannot be
    // waived. Failed/uncertain observed structure may be reviewed as a deliberate
    // layout variation, while the new functional judgments must all pass.
    const completeChecks=declaration.checks.every(c=>observed?.checks.some(o=>o.checkId===c.checkId));
    const issues=row.issues.filter(issue=>!(
      issue==='REFERENCE_FEATURE_SHAPE_MISMATCH'&&row.points.filter(p=>p.error>p.toleranceWorld).every(p=>accepted.acceptedFeatureIds.includes(p.featureId))
      ||issue==='REFERENCE_STRUCTURE_UNCONFIRMED'&&completeChecks&&observed.checks.filter(c=>c.verdict!=='pass').every(c=>accepted.acceptedCheckIds.includes(c.checkId))));
    if(!accepted.judgments.every(j=>j.verdict==='pass'))issues.push('REFERENCE_INTENT_UNCONFIRMED');
    return {...row,status:issues.length?'blocked':'reviewed',issues,referenceMatchStatus:row.status,referenceMatchIssues:row.issues,
      acceptedVariations:{featureIds:accepted.acceptedFeatureIds,checkIds:accepted.acceptedCheckIds},intentJudgments:accepted.judgments};
  });
  const {sha256:unused,...base}=strict;
  return seal({...base,format:'ai_scene_reference_feature_layout_review_v2',reviewMode:policy.profile,
    intentReviewSha256:intentReview.sha256,strictReviewSha256:strict.sha256,strictReferenceMatchStatus:strict.status,
    rows,status:rows.every(r=>r.status==='reviewed')?'reviewed':'blocked'});
}
