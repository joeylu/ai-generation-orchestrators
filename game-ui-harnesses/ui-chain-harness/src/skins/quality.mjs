import {suggestSlices} from '../../tools/panel-slicer/src/suggestion.mjs';

// Only exactly empty alpha is a hard failure. Low-opacity artwork is valid.
export function assertVisibleAsset(image,assetId,phase){
  for(let i=3;i<image.pixels.length;i+=4)if(image.pixels[i]>0)return;
  throw Object.assign(Error(`Empty transparent asset: ${assetId} (${phase})`),{code:'skin.empty-asset'});
}

// Narrow heuristic: repeated center bands only. Structural/fallback estimates
// are not strong enough for comparing a user's cuts. Never rewrite metadata.
export function sliceRisks({source,fit,suggestion,metadata,stretch,resolution}){
  const risks=[];
  if(suggestion.status==='supported'&&suggestion.method==='repeated-center-bands-v1'){
    const sides=stretch==='vertical'?['top','bottom']:stretch==='horizontal'?['left','right']:stretch==='nine-slice'?['left','right','top','bottom']:[];
    const affected=sides.filter(side=>suggestion.bordersPx[side]-metadata.nineSlice[side]*resolution>1);
    if(affected.length)risks.push({code:'skin.slice-decoration-risk',sides:affected,message:'配置切线浅于重复中心带边界，可能拉伸边缘装饰；仅提示，需核对。'});
  }
  if(['vertical-slice','horizontal-slice'].includes(fit?.method)){
    const original=suggestSlices(source,1);
    if(original.status==='supported'&&original.method==='repeated-center-bands-v1'){
      const affected=(fit.method==='vertical-slice'?['top','bottom']:['left','right']).filter((side,i)=>original.bordersPx[side]-fit.caps[i]>1);
      if(affected.length)risks.push({code:'skin.cap-decoration-risk',sides:affected,message:'源图端帽浅于重复中心带边界，端部细节可能进入拉伸段；仅提示，需核对。'});
    }
  }
  return risks;
}
