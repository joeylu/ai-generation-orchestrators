// Horizontal content clearance is separate from stretch cuts and vertical layout.
// Analyze delivered pixels only; never modify textures or guess unsupported borders.
export function suggestContentInsets({assetId,width,resolution,suggestion,configured,policy}) {
  if(policy.version!=='1.0'||!Array.isArray(policy.assetPrefixes)||!policy.assetPrefixes.length||policy.assetPrefixes.some(p=>typeof p!=='string'||!p)||!['horizontalClearance','minimumHorizontalInset'].every(k=>Number.isInteger(policy[k])&&policy[k]>=0)||policy.automaticAcceptance!==false)throw Error('insets.invalid-policy');
  if(!policy.assetPrefixes.some(p=>assetId.startsWith(p)))return {status:'not-applicable'};
  if(!Number.isFinite(resolution)||resolution<=0||!Number.isInteger(width)||width<=0)throw Error('insets.invalid-geometry');
  let physical;
  if(suggestion.status==='supported'&&suggestion.method==='framed-texture-v2'){
    const {bounds,edges}=suggestion.evidence;
    physical={left:bounds.left+edges.left,right:width-1-bounds.right+edges.right};
  }else if(suggestion.status==='supported'&&suggestion.method==='repeated-center-bands-v1'){
    physical={left:suggestion.bordersPx.left,right:suggestion.bordersPx.right};
  }else return {status:'needs-review',reason:'No supported border evidence; preserve configured insets.'};
  if(Object.values(physical).some(v=>!Number.isFinite(v)||v<0))throw Error('insets.invalid-evidence');
  const proposed={...configured};
  for(const side of ['left','right'])proposed[side]=Math.max(policy.minimumHorizontalInset,Math.ceil(physical[side]/resolution)+policy.horizontalClearance);
  return {status:'suggested',basis:suggestion.method,physicalBorderExtent:physical,resolution,proposed,belowRecommended:['left','right'].filter(k=>configured[k]<proposed[k]),visualAcceptance:'unreviewed'};
}
