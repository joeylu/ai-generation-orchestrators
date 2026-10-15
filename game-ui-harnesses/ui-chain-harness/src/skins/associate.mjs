const overlap=(a,b)=>a[0]<b[0]+b[2]&&b[0]<a[0]+a[2]&&a[1]<b[1]+b[3]&&b[1]<a[1]+a[3];
const inside=(a,b)=>b[0]>=a[0]&&b[1]>=a[1]&&b[0]+b[2]<=a[0]+a[2]&&b[1]+b[3]<=a[1]+a[3];
const gap=(a,b)=>Math.max(0,a[0]-b[0]-b[2],b[0]-a[0]-a[2],a[1]-b[1]-b[3],b[1]-a[1]-a[3]);
function union(rects){
  if(!rects.length)return null;
  const x=Math.min(...rects.map(r=>r[0])),y=Math.min(...rects.map(r=>r[1]));
  return[x,y,Math.max(...rects.map(r=>r[0]+r[2]))-x,Math.max(...rects.map(r=>r[1]+r[3]))-y];
}

// Hypotheses only. Weak components are accounted for, never erased. A stronger
// disconnected decoration is retained regardless of its size. No area cutoff.
export function associateSheet(image,location,policy){
  if(policy.version!=='1.0'||policy.automaticAcceptance!==false||!Number.isInteger(policy.weakComponentMaxAlpha)||policy.weakComponentMaxAlpha<0||policy.weakComponentMaxAlpha>254||!Number.isFinite(policy.attachmentGapLogicalPixels)||policy.attachmentGapLogicalPixels<0||policy.attachmentGapLogicalPixels>32)throw Error('locate.policy');
  const fringeMaxAlpha=policy.attachedFringeMaxAlpha??policy.weakComponentMaxAlpha;
  if(policy.attachedFringeMaxAlpha!==undefined&&(!Number.isInteger(policy.attachedFringeMaxAlpha)||fringeMaxAlpha<policy.weakComponentMaxAlpha||fringeMaxAlpha>32))throw Error('locate.fringe-policy');
  if(location.status==='unsupported')return{status:'unsupported',parts:[],assemblyReady:false};
  const rule=policy.primaryOwnership;
  if(rule&&(![rule.minimumPixelFraction,rule.minimumAlphaFraction].every(n=>Number.isFinite(n)&&n>0.5&&n<=1)||!Number.isFinite(rule.maximumOtherSlotFraction)||rule.maximumOtherSlotFraction<0||rule.maximumOtherSlotFraction>=0.5))throw Error('locate.ownership-policy');
  const strong=location.components.filter(c=>c.maxAlpha>policy.weakComponentMaxAlpha);
  const weak=location.components.filter(c=>c.maxAlpha<=policy.weakComponentMaxAlpha);
  const owners=new Map(location.components.map(c=>[c.id,location.parts.filter(p=>overlap(p.slot,c.rect)).map(p=>p.assetId)]));
  const ownership=strong.map(c=>{
    if(!rule){const ids=owners.get(c.id);return{componentId:c.id,primary:ids.length===1?ids[0]:null,touched:ids,method:'legacy-rectangle'};}
    if(!Array.isArray(c.slotDistribution))throw Error('locate.missing-pixel-distribution-rerun');
    const distribution=c.slotDistribution.map(s=>({...s,pixelFraction:s.nonzeroPixels/c.pixels,alphaFraction:s.alphaSum/c.alphaSum}));
    const candidates=distribution.filter(s=>s.pixelFraction>=rule.minimumPixelFraction&&s.alphaFraction>=rule.minimumAlphaFraction&&distribution.filter(t=>t!==s).every(t=>t.pixelFraction<=rule.maximumOtherSlotFraction&&t.alphaFraction<=rule.maximumOtherSlotFraction));
    return{componentId:c.id,primary:candidates.length===1?candidates[0].assetId:null,touched:distribution.map(s=>s.assetId),method:'actual-component-pixels',distribution,outsidePixels:c.pixels-c.slotDistribution.reduce((n,s)=>n+s.nonzeroPixels,0),outsideAlphaSum:c.alphaSum-c.slotDistribution.reduce((n,s)=>n+s.alphaSum,0)};
  });
  // A faint detached fringe can belong to a body without becoming a second body.
  // This is a direct, uniquely owned attachment, never an opacity deletion or a
  // chain of fragments that could bridge two controls. Legacy policies opt out.
  const fringeAssignments=[],fringeIds=new Set(),primary=new Map(ownership.map(o=>[o.componentId,o.primary]));
  const bodies=strong.filter(c=>c.maxAlpha>fringeMaxAlpha),maximumGapPixels=policy.attachmentGapLogicalPixels*location.scale;
  for(const c of strong.filter(c=>c.maxAlpha<=fringeMaxAlpha)){
    const owner=primary.get(c.id);if(!owner)continue;
    const sameSlot=bodies.filter(b=>primary.get(b.id)===owner);
    if(sameSlot.length!==1)continue;
    const nearby=bodies.filter(b=>gap(b.rect,c.rect)<=maximumGapPixels);
    if(nearby.length!==1||nearby[0].id!==sameSlot[0].id)continue;
    fringeIds.add(c.id);fringeAssignments.push({componentId:c.id,anchorComponentId:sameSlot[0].id,assetId:owner,maxAlpha:c.maxAlpha,alphaSum:c.alphaSum,gapPixels:gap(sameSlot[0].rect,c.rect),maximumGapPixels,method:'bounded-low-alpha-neighbor'});
  }
  const parts=location.parts.map(p=>{
    const assigned=ownership.filter(o=>o.primary===p.assetId).map(o=>o.componentId);
    const anchors=strong.filter(c=>assigned.includes(c.id)&&!fringeIds.has(c.id));
    const conflicts=strong.filter(c=>ownership.some(o=>o.componentId===c.id&&!o.primary&&o.touched.includes(p.assetId)));
    const foreign=ownership.filter(o=>o.primary&&o.primary!==p.assetId&&o.touched.includes(p.assetId)).map(o=>o.componentId);
    const issues=[];
    if(!anchors.length)issues.push('no-substantial-anchor');
    if(anchors.length>1)issues.push('multiple-substantial-pieces');
    if(conflicts.length)issues.push('shared-substantial-component');
    if(anchors.some(c=>!inside(p.slot,c.rect)))issues.push('substantial-crosses-slot');
    if(foreign.length)issues.push('foreign-component-in-slot');
    return{assetId:p.assetId,slot:p.slot,anchorComponentIds:anchors.map(c=>c.id),anchorRect:union(anchors.map(c=>c.rect)),attachedWeakComponentIds:[],attachedFringeComponentIds:fringeAssignments.filter(f=>f.assetId===p.assetId).map(f=>f.componentId),conflictComponentIds:conflicts.map(c=>c.id),foreignComponentIds:foreign,issues};
  });
  const unresolvedWeak=[];
  for(const c of weak){
    // Fixed distance from anchors, not iterative chains that can bridge slots.
    const matches=parts.filter(p=>p.anchorComponentIds.some(id=>gap(location.components[id].rect,c.rect)<=policy.attachmentGapLogicalPixels*location.scale));
    if(matches.length===1)matches[0].attachedWeakComponentIds.push(c.id);
    else unresolvedWeak.push({componentId:c.id,reason:matches.length?'multiple-anchor-groups':'no-nearby-anchor'});
  }
  for(const p of parts){
    p.proposedCrop=p.anchorRect&&!p.conflictComponentIds.length?union([...p.anchorComponentIds,...p.attachedWeakComponentIds,...p.attachedFringeComponentIds].map(id=>location.components[id].rect)):null;
    if(p.proposedCrop&&!inside(p.slot,p.proposedCrop))p.issues.push('proposal-crosses-slot');
    p.status=p.proposedCrop?'proposal-needs-review':'unresolved';
    delete p.anchorRect;
  }
  for(const p of parts)if(p.proposedCrop){
    const other=parts.filter(q=>q!==p&&q.proposedCrop&&overlap(p.proposedCrop,q.proposedCrop));
    if(other.length)p.issues.push('overlapping-proposals');
  }
  const accounting={sourceNonzeroPixels:0,sourceAlphaSum:0,coveredNonzeroPixels:0,coveredAlphaSum:0,outsideNonzeroPixels:0,outsideAlphaSum:0};
  for(const p of parts)p.outsideProposalWithinSlot={nonzeroPixels:0,alphaSum:0};
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const alpha=image.pixels[(y*image.width+x)*4+3];if(!alpha)continue;
    const hit=r=>r&&x>=r[0]&&y>=r[1]&&x<r[0]+r[2]&&y<r[1]+r[3];
    accounting.sourceNonzeroPixels++;accounting.sourceAlphaSum+=alpha;
    const covered=parts.some(p=>hit(p.proposedCrop));
    if(covered){accounting.coveredNonzeroPixels++;accounting.coveredAlphaSum+=alpha;}
    else{accounting.outsideNonzeroPixels++;accounting.outsideAlphaSum+=alpha;}
    for(const p of parts)if(hit(p.slot)&&!hit(p.proposedCrop)){p.outsideProposalWithinSlot.nonzeroPixels++;p.outsideProposalWithinSlot.alphaSum+=alpha;}
  }
  return{status:'needs-review',parts,ownership,fringeAssignments,unresolvedWeak,unassignedSubstantialComponentIds:ownership.filter(o=>!o.primary).map(o=>o.componentId),accounting,assemblyReady:false,semanticIdentity:'not-verified',pixelsModified:false};
}
