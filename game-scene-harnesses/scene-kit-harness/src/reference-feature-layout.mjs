import {check,digest,exact,hash,id,isDigest,receipt,seal,text,unseal} from './generation/common.mjs';
import {inspectPng} from './png.mjs';
import {validateBackgroundBandPlacement} from './background-band-placement.mjs';
import {applyReferenceIntentReview} from './reference-intent-review.mjs';

const point=(p,limit)=>{exact(p,['x','y']);check([p.x,p.y].every(Number.isFinite)&&p.x>=0&&p.y>=0&&p.x<=limit.width&&p.y<=limit.height,'REFERENCE_FEATURE_POINT');};
const unique=(rows,key,code)=>{const seen=new Set();for(const r of rows){id(r[key]);check(!seen.has(r[key]),code);seen.add(r[key]);}};
export function validateReferenceStructure(record){
  const v=unseal(record);exact(v,['format','referenceRawSha256','viewport','assets']);
  check(v.format==='ai_scene_reference_structure_v1'&&isDigest(v.referenceRawSha256),'REFERENCE_STRUCTURE_IDENTITY');
  exact(v.viewport,['width','height']);check([v.viewport.width,v.viewport.height].every(n=>Number.isInteger(n)&&n>0&&n<=4096),'REFERENCE_STRUCTURE_VIEWPORT');
  check(Array.isArray(v.assets)&&v.assets.length>0&&v.assets.length<=24,'REFERENCE_STRUCTURE_ASSETS');unique(v.assets,'instanceId','REFERENCE_STRUCTURE_DUPLICATE');
  for(const a of v.assets){exact(a,['instanceId','subjectId','features','checks',...(Object.hasOwn(a,'compositionProfile')?['compositionProfile']:[])]);id(a.subjectId);
    if(Object.hasOwn(a,'compositionProfile'))check(a.compositionProfile==='source-owned-feature-group-v1','REFERENCE_STRUCTURE_COMPOSITION_PROFILE');
    check(Array.isArray(a.features)&&a.features.length>=2&&a.features.length<=16&&Array.isArray(a.checks)&&a.checks.length>0&&a.checks.length<=16,'REFERENCE_STRUCTURE_FEATURES');
    unique(a.features,'featureId','REFERENCE_STRUCTURE_DUPLICATE');unique(a.checks,'checkId','REFERENCE_STRUCTURE_DUPLICATE');
    for(const f of a.features){exact(f,['featureId','description','target','toleranceWorld']);text(f.description,{limit:200});point(f.target,v.viewport);
      check(Number.isFinite(f.toleranceWorld)&&f.toleranceWorld>0&&f.toleranceWorld<=32,'REFERENCE_FEATURE_TOLERANCE');}
    check(a.features.some(f=>f.target.x!==a.features[0].target.x||f.target.y!==a.features[0].target.y),'REFERENCE_FEATURE_DEGENERATE');
    for(const c of a.checks){exact(c,['checkId','description']);text(c.description,{limit:400});}
  }
  return v;
}
export function createReferenceStructure(options){const record=seal({format:'ai_scene_reference_structure_v1',...options});validateReferenceStructure(record);return record;}

function assertBoundFeatureCorrections(sources, correction) {
  const required = sources.map(s => s.plan.sourceScope?.definition?.featureCorrection).filter(Boolean);
  if (required.length) check(correction && required.every(c => digest(c) === digest(correction)),
    'REFERENCE_FEATURE_CORRECTION_REQUIRED');
}
function assertBoundFeatureSupplements(sources, supplement){
  const required=sources.map(s=>s.plan.sourceScope?.definition?.featureSupplement).filter(Boolean);
  if(required.length)check(supplement&&required.every(s=>digest(s)===digest(supplement)),'REFERENCE_FEATURE_SUPPLEMENT_REQUIRED');
}

export function assertCompositionStructureCoversSources(composition, sources) {
  assertBoundFeatureCorrections(sources, composition?.featureCorrection);
  assertBoundFeatureSupplements(sources, composition?.featureSupplement);
  const frozen = sources.map(s => s.plan.sourceScope?.definition?.referenceStructure).filter(Boolean);
  if (!frozen.length) return;
  check(composition?.format === 'ai_scene_coherent_composition_v6', 'REFERENCE_STRUCTURE_COMPOSITION_REQUIRED');
  const assembled = validateReferenceStructure(composition.referenceStructure);
  const assets = new Map(assembled.assets.map(asset => [asset.instanceId, digest(asset)]));
  for (const record of frozen) {
    const required = validateReferenceStructure(record);
    // A newly registered source may add rows. Existing obligations must replay exactly.
    check(required.referenceRawSha256 === assembled.referenceRawSha256
      && digest(required.viewport) === digest(assembled.viewport)
      && required.assets.every(asset => assets.get(asset.instanceId) === digest(asset)),
    'REFERENCE_STRUCTURE_COMPOSITION_REQUIRED');
  }
}

// Resolve an explicitly reviewed coordinate erratum without rewriting the
// original structure. Checks, feature identities and tolerances remain binding.
function correctedReferenceFeatureTargets(structure, correction) {
  const original = validateReferenceStructure(structure);
  if (correction === undefined) return original;
  exact(correction, ['proposal', 'decision']);
  const proposal = unseal(correction.proposal);
  exact(proposal, ['format', 'structureSha256', 'evidenceSha256', 'changes']);
  check(proposal.format === 'ai_scene_reference_feature_correction_v1'
    && proposal.structureSha256 === structure.sha256 && isDigest(proposal.evidenceSha256),
  'REFERENCE_FEATURE_CORRECTION_BINDING');
  receipt(correction.decision, 'review');
  check(correction.decision.decision === 'accept'
    && correction.decision.targetSha256 === correction.proposal.sha256, 'REFERENCE_FEATURE_CORRECTION_DECISION');
  check(Array.isArray(proposal.changes) && proposal.changes.length > 0
    && proposal.changes.length <= 384, 'REFERENCE_FEATURE_CORRECTION_CHANGES');
  const assets = structuredClone(original.assets);
  const seen = new Set();
  for (const change of proposal.changes) {
    exact(change, ['instanceId', 'featureId', 'oldTarget', 'target', 'reason']);
    const feature = assets.find(asset => asset.instanceId === change.instanceId)
      ?.features.find(candidate => candidate.featureId === change.featureId);
    const key = JSON.stringify([change.instanceId, change.featureId]);
    check(feature && !seen.has(key), 'REFERENCE_FEATURE_CORRECTION_FEATURE');
    point(change.oldTarget, original.viewport);
    point(change.target, original.viewport);
    text(change.reason, {limit: 400});
    check(digest(change.oldTarget) === digest(feature.target)
      && digest(change.target) !== digest(feature.target), 'REFERENCE_FEATURE_CORRECTION_TARGET');
    feature.target = change.target;
    seen.add(key);
  }
  return validateReferenceStructure(seal({...original, assets}));
}
// A reviewed supplement strengthens one immutable base without editing its rows.
// It cannot replace points/checks, add owners or transfer source/art acceptance.
export function resolveReferenceFeatureTargets(structure,correction,supplement){
  const base=correctedReferenceFeatureTargets(structure,correction);if(supplement===undefined)return base;
  exact(supplement,['proposal','decision']);const p=unseal(supplement.proposal);
  exact(p,['format','structureSha256','evidenceSha256','additions']);
  check(p.format==='ai_scene_reference_feature_supplement_v1'&&p.structureSha256===structure.sha256&&isDigest(p.evidenceSha256),'REFERENCE_FEATURE_SUPPLEMENT_BINDING');
  receipt(supplement.decision,'review');check(supplement.decision.decision==='accept'&&supplement.decision.targetSha256===supplement.proposal.sha256,'REFERENCE_FEATURE_SUPPLEMENT_DECISION');
  check(Array.isArray(p.additions)&&p.additions.length>0&&p.additions.length<=base.assets.length,'REFERENCE_FEATURE_SUPPLEMENT_ADDITIONS');
  unique(p.additions,'instanceId','REFERENCE_FEATURE_SUPPLEMENT_DUPLICATE');const assets=structuredClone(base.assets);
  for(const row of p.additions){
    exact(row,['instanceId','features','checks']);const asset=assets.find(a=>a.instanceId===row.instanceId);
    check(asset&&Array.isArray(row.features)&&Array.isArray(row.checks)&&row.features.length+row.checks.length>0,'REFERENCE_FEATURE_SUPPLEMENT_OWNER');
    check(row.features.every(f=>!asset.features.some(old=>old.featureId===f.featureId))&&row.checks.every(c=>!asset.checks.some(old=>old.checkId===c.checkId)),'REFERENCE_FEATURE_SUPPLEMENT_REPLACEMENT');
    asset.features.push(...row.features);asset.checks.push(...row.checks);
  }
  return validateReferenceStructure(seal({...base,assets}));
}
export function referenceStructurePrompt(record,instanceId,correction,supplement){
  const v=resolveReferenceFeatureTargets(record,correction,supplement),a=v.assets.find(a=>a.instanceId===instanceId);check(a,'REFERENCE_STRUCTURE_ASSET');
  const xs=a.features.map(f=>f.target.x),ys=a.features.map(f=>f.target.y),span={width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
  return ['REFERENCE STRUCTURE: image 1 also constrains the named source-owned features and their relative proportions. These obligations survive source revisions; completing unseen supports must not redesign the declared scene structure.',
    ...a.checks.map(c=>`Required structure ${c.checkId}: ${c.description}`),
    'Use these normalized feature relationships within the named feature group, independent of canvas margins and later world placement. They are approximate feature proportions, not a request to copy neighboring scene content or the complete image:',
    ...a.features.map(f=>`${f.featureId} (${f.description}): relative x ${span.width?((f.target.x-Math.min(...xs))/span.width).toFixed(4):'0'}, relative y ${span.height?((f.target.y-Math.min(...ys))/span.height).toFixed(4):'0'}.`),
    `Named feature span aspect width/height: ${span.height?(span.width/span.height).toFixed(4):'horizontal group'}. Keep these proportions; source Alpha, feature observations, source review and final scene quality are independently checked.`].join('\n');
}
// Bounded rational representation compatible with existing module renderStyle.
function rational(value){let best=null;for(let d=1;d<=4096;d++){const n=Math.round(value*d);if(n<1||n>4096)continue;const error=Math.abs(n/d-value);if(!best||error<best.error)best={numerator:n,denominator:d,error};if(error===0)break;}
  check(best,'REFERENCE_FEATURE_SCALE');return {numerator:best.numerator,denominator:best.denominator};}
export function reviewReferenceFeatureLayout({structure,sources,measurements,bandPlacements=[],correction,supplement,intentReview}){
  const v=resolveReferenceFeatureTargets(structure,correction,supplement);check(Array.isArray(sources)&&Array.isArray(measurements)&&measurements.length<=v.assets.length,'REFERENCE_FEATURE_INPUTS');
  assertBoundFeatureCorrections(sources, correction);
  assertBoundFeatureSupplements(sources,supplement);
  unique(measurements,'instanceId','REFERENCE_FEATURE_DUPLICATE');const used=new Set(),rows=[];
  for(const a of v.assets){
    const candidates=sources.filter(s=>s.plan.recipe.assetId===a.instanceId);check(candidates.length===1,'REFERENCE_FEATURE_SOURCE');
    const source=candidates[0],{plan,raw}=source;unseal(plan);
    check(plan.referenceEvidence?.[0]?.rawSha256===v.referenceRawSha256&&plan.instanceBinding?.subjectId===a.subjectId,'REFERENCE_FEATURE_SOURCE');
    const m=measurements.find(m=>m.instanceId===a.instanceId);
    if(!m){rows.push({instanceId:a.instanceId,status:'blocked',issues:['REFERENCE_FEATURE_MEASUREMENTS_MISSING']});continue;}
    used.add(m.instanceId);exact(m,['instanceId','sourcePlanSha256','sourceRawSha256','features','checks']);
    check(m.sourcePlanSha256===plan.sha256&&m.sourceRawSha256===hash(raw),'REFERENCE_FEATURE_BINDING');
    check(Array.isArray(m.features)&&m.features.length<=a.features.length&&Array.isArray(m.checks)&&m.checks.length<=a.checks.length,'REFERENCE_FEATURE_MEASUREMENTS');
    unique(m.features,'featureId','REFERENCE_FEATURE_DUPLICATE');unique(m.checks,'checkId','REFERENCE_FEATURE_DUPLICATE');
    const png=inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true}),issues=[];
    for(const f of m.features){exact(f,['featureId','native']);check(a.features.some(x=>x.featureId===f.featureId),'REFERENCE_FEATURE_UNKNOWN');point(f.native,png);check(f.native.x<png.width&&f.native.y<png.height,'REFERENCE_FEATURE_POINT');}
    for(const c of m.checks){exact(c,['checkId','verdict']);check(a.checks.some(x=>x.checkId===c.checkId)&&['pass','fail','uncertain'].includes(c.verdict),'REFERENCE_FEATURE_CHECK');}
    if(a.features.some(f=>!m.features.some(x=>x.featureId===f.featureId)))issues.push('REFERENCE_FEATURE_MISSING');
    if(a.checks.some(c=>!m.checks.some(x=>x.checkId===c.checkId&&x.verdict==='pass')))issues.push('REFERENCE_STRUCTURE_UNCONFIRMED');
    const pairs=a.features.filter(f=>m.features.some(x=>x.featureId===f.featureId)).map(f=>({...f,native:m.features.find(x=>x.featureId===f.featureId).native}));
    let placement=null,points=[];
    if(pairs.length>=2){
      const band=plan.sourceScope?.definition?.backgroundBand;
      if(band){const p=bandPlacements.find(p=>p.instanceId===a.instanceId);check(p&&p.sourcePlanSha256===plan.sha256&&p.sourceRawSha256===hash(raw),'REFERENCE_FEATURE_BAND_PLACEMENT');validateBackgroundBandPlacement(p,{plan,raw});placement={positionWorld:p.positionWorld,sourceToWorld:p.sourceToWorld};}
      else{
        const mean=key=>({x:pairs.reduce((n,p)=>n+p[key].x,0)/pairs.length,y:pairs.reduce((n,p)=>n+p[key].y,0)/pairs.length}),n=mean('native'),t=mean('target');
        let den=0,num=0;for(const p of pairs){const dx=p.native.x-n.x,dy=p.native.y-n.y;den+=dx*dx+dy*dy;num+=dx*(p.target.x-t.x)+dy*(p.target.y-t.y);}
        check(den>1e-9,'REFERENCE_FEATURE_DEGENERATE');const scale=num/den;
        if(scale<1/16||scale>4)issues.push('REFERENCE_FEATURE_SCALE');
        else {const ratio=rational(scale),s=ratio.numerator/ratio.denominator,q=n=>Math.round(n*1e9)/1e9;placement={positionWorld:{x:q(t.x-s*n.x),y:q(t.y-s*n.y)},sourceToWorld:ratio};}
      }
      if(placement){const s=placement.sourceToWorld.numerator/placement.sourceToWorld.denominator;
        points=pairs.map(p=>{const actual={x:placement.positionWorld.x+p.native.x*s,y:placement.positionWorld.y+p.native.y*s},error=Math.hypot(actual.x-p.target.x,actual.y-p.target.y);return {featureId:p.featureId,target:p.target,actual,error,toleranceWorld:p.toleranceWorld};});
        if(points.some(p=>p.error>p.toleranceWorld))issues.push('REFERENCE_FEATURE_SHAPE_MISMATCH');
      }
    }
    const pixelsPerWorldPixel=placement?placement.sourceToWorld.denominator/placement.sourceToWorld.numerator:null;
    rows.push({instanceId:a.instanceId,sourcePlanSha256:plan.sha256,sourceRawSha256:hash(raw),nativeSize:{width:png.width,height:png.height},status:issues.length?'blocked':'reviewed',issues,placement,points,
      sourceSampling:{profile:'full-native-frame-no-resampling-v1',pixelsPerWorldPixel,targetPixelsPerWorldPixel:2,targetReached:pixelsPerWorldPixel!==null&&pixelsPerWorldPixel>=2}});
  }
  check(measurements.every(m=>used.has(m.instanceId)),'REFERENCE_FEATURE_UNKNOWN');
  const strict=seal({format:'ai_scene_reference_feature_layout_review_v1',structureSha256:structure.sha256,
    ...(correction?{correctionSha256:digest(correction)}:{}),
    ...(supplement?{supplementSha256:digest(supplement)}:{}),
    referenceRawSha256:v.referenceRawSha256,measurementsSha256:digest(measurements),rows,status:rows.every(r=>r.status==='reviewed')?'reviewed':'blocked',observationOrigin:'explicit-human-or-agent-data',automaticImageUnderstanding:false,observationAccuracy:'not-verified',artAcceptance:'not-assessed',sourcePngModified:false,generationCalls:0});
  return applyReferenceIntentReview(strict,{intentReview,structure:v,measurements,sources});
}
