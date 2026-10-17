// Build experimental configuration only. Logical metadata is a trial baseline,
// never asserted to be visually correct for newly located artwork.
export function trialPart(baseline,source,crop,stretch,allowDifferentSource=false){
  const same=baseline.sha256===source.sha256;
  if(!same&&!allowDifferentSource)throw Error('trial.different-source-needs-explicit-trial-mode');
  const result={file:source.file,sha256:source.sha256,crop,metadata:structuredClone(baseline.metadata)};
  let capBasis='none';
  if(same&&baseline.fit){
    if(!baseline.crop||!['vertical','horizontal'].includes(stretch)||baseline.fit.method!==stretch+'-slice')throw Error('trial.unsupported-fit');
    const old=baseline.crop,caps=baseline.fit.caps,axis=stretch==='vertical'?1:0;
    result.fit={method:baseline.fit.method,caps:[old[axis]+caps[0]-crop[axis],crop[axis]+crop[axis+2]-(old[axis]+old[axis+2]-caps[1])]};
    capBasis='preserved-source-cut-coordinates';
  }else if(!same&&['vertical','horizontal'].includes(stretch)){
    // Explicit experimental rounded-rail hypothesis, not an automatic detector.
    const vertical=stretch==='vertical',cap=Math.ceil(crop[vertical?2:3]/2);
    result.fit={method:stretch+'-slice',caps:[cap,cap]};capBasis=vertical?'experimental-half-source-width':'experimental-half-source-height';
  }
  if(result.fit&&(result.fit.caps.some(n=>!Number.isInteger(n)||n<=0)||result.fit.caps[0]+result.fit.caps[1]>=crop[stretch==='vertical'?3:2]))throw Error('trial.invalid-source-caps');
  return{part:result,evidence:{sameSource:same,metadataBasis:'baseline-logical-trial',capBasis,oldCrop:baseline.crop??null,newCrop:crop,oldFit:baseline.fit??null,newFit:result.fit??null,visualAcceptance:'unreviewed'}};
}
