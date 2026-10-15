import {fitAsset,fitSlicedAsset} from './assemble.mjs';
import {suggestSlices} from '../../tools/panel-slicer/src/suggestion.mjs';
import {assertMetadata} from './contract.mjs';
const sides=['left','top','right','bottom'];
const positive=n=>Number.isFinite(n)&&n>0;
const missingSlices=(kind,id)=>{const code='metadata.'+kind+'-override-required: '+id;return Object.assign(Error(code),{code});};
export function deriveMetadata(template,images,policy,overrides={}) {
  const defs=template.sheets.flatMap(s=>s.parts),ids=new Set(defs.map(p=>p.assetId));
  if(policy.version!=='1.0'||!positive(policy.defaultDensity)||!positive(policy.verticalLogicalWidth)||policy.automaticAcceptance!==false||!Array.isArray(policy.roundedEndHypotheses))throw Error('metadata.invalid-policy');
  for(const map of [policy.densityOverrides,policy.contentInsets,overrides])for(const id of Object.keys(map??{}))if(!ids.has(id))throw Error('metadata.unknown-asset');
  for(const id of policy.roundedEndHypotheses)if(!ids.has(id))throw Error('metadata.unknown-asset');
  const parts={},evidence=[];
  for(const part of defs){
    const id=part.assetId,o=overrides[id]??{},source=images.get(id),[w,h]=part.bodyRect.slice(2),scale=template.coordinates.outputScale;
    if(!source)throw Error('metadata.missing-image');
    if(Object.keys(o).some(k=>!['density','caps','nineSlice','contentInsets'].includes(k)))throw Error('metadata.unknown-override');
    const density=o.density??policy.densityOverrides?.[id]??(part.stretch==='vertical'?w/policy.verticalLogicalWidth:policy.defaultDensity);
    if(!positive(density)||density<.25||density>16)throw Error('metadata.invalid-density');
    const group=template.stateGroups?.find(g=>g.assetIds.includes(id)),members=(group?.assetIds??[id]).map(k=>images.get(k));
    if(members.some(m=>!m))throw Error('metadata.missing-state');
    let fit,fitted,capBasis=null;
    if(part.stretch==='vertical'||(part.stretch==='horizontal'&&(o.caps||policy.roundedEndHypotheses.includes(id)))){
      if(group)throw Error('metadata.slice-state-group-unsupported');
      if(!o.caps&&!policy.roundedEndHypotheses.includes(id))throw Error('metadata.caps-override-required: '+id);
      const vertical=part.stretch==='vertical',cap=Math.ceil((vertical?source.width:source.height)/2);fit={method:part.stretch+'-slice',caps:o.caps??[cap,cap]};
      capBasis=o.caps?'skin-override':vertical?'rounded-half-source-width-hypothesis':'rounded-half-source-height-hypothesis';
      fitted=fitSlicedAsset(source,w*scale,h*scale,fit);
    }else{
      if(o.caps)throw Error('metadata.caps-only-rails');
      fitted=fitAsset(source,w*scale,h*scale,[Math.max(...members.map(m=>m.width)),Math.max(...members.map(m=>m.height))]);
    }
    const suggestion=part.stretch==='uniform'?{status:'not-applicable'}:suggestSlices(fitted.image,scale*density,{axis:['horizontal','vertical'].includes(part.stretch)?part.stretch:'both'});
    let cuts={left:0,top:0,right:0,bottom:0},basis='uniform-no-cuts';
    if(o.nineSlice){cuts={...o.nineSlice};basis='skin-override';}
    else if(part.stretch==='nine-slice'){
      if(suggestion.status!=='supported')throw missingSlices('slices',id);
      cuts=Object.fromEntries(Object.entries(suggestion.nineSlice).map(([k,v])=>[k,Math.ceil(v)]));basis='panel-slicer-delivered-pixels';
    }else if(part.stretch==='horizontal'){
      if(fit){
        cuts.left=Math.ceil(fitted.operation.targetCaps[0]/(scale*density));cuts.right=Math.ceil(fitted.operation.targetCaps[1]/(scale*density));basis=capBasis;
      }else{
        if(suggestion.status!=='supported')throw missingSlices('ends',id);
        cuts.left=Math.ceil(suggestion.nineSlice.left);cuts.right=Math.ceil(suggestion.nineSlice.right);basis='panel-slicer-horizontal-ends';
      }
    }else if(part.stretch==='vertical'){
      cuts.top=Math.ceil(fitted.operation.targetCaps[0]/(scale*density));cuts.bottom=Math.ceil(fitted.operation.targetCaps[1]/(scale*density));basis=capBasis;
    }
    const insets={...(o.contentInsets??policy.contentInsets[id]??{left:0,top:0,right:0,bottom:0})};
    for(const map of [cuts,insets])if(Object.keys(map).length!==4||sides.some(k=>!Number.isInteger(map[k])||map[k]<0))throw Error('metadata.invalid-sides');
    const metadata={density,nineSlice:cuts,contentInsets:insets,minSize:{width:Math.max(cuts.left+cuts.right+1,insets.left+insets.right+1),height:Math.max(cuts.top+cuts.bottom+1,insets.top+insets.bottom+1)}};
    assertMetadata(metadata,w,h,part.stretch);
    parts[id]={...(fit?{fit}:{}),metadata};
    evidence.push({assetId:id,densityBasis:o.density?'skin-override':'common-design-default',cutsBasis:basis,capBasis,override:o,suggestion,fit:fitted.operation,metadata,requiresVisualReview:true});
  }
  return{parts,evidence};
}
