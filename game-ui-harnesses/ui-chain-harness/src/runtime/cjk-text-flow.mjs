import {CanvasTextMetrics} from 'pixi.js';

const closingOnly=/^[，。！？、；：…）】》〉」』〕］｝”’,.!?;:)\]}]{1,2}$/u;
const closingTail=/\p{Script=Han}[，。！？、；：…）】》〉」』〕］｝”’,.!?;:)\]}]{1,2}\s*$/u;
const balancedTail=/^\p{Script=Han}[，。！？、；：…）】》〉」』〕］｝”’,.!?;:)\]}]{1,2}$/u;

// Only balance an automatically wrapped, otherwise empty closing-punctuation
// line. The authored string, font size, box and line count stay unchanged.
export function selectCjkClosingWrap({enabled=false,text,width,height,fontSize,wordWrap,measure}){
 const unchanged=reason=>({changed:false,width,reason});
 if(!enabled||!wordWrap||typeof text!=='string'||!Number.isFinite(width)||!Number.isFinite(height)||width<=1||height<=0||!Number.isFinite(fontSize)||fontSize<=0)return unchanged('scope');
 if(/[\r\n\u2028\u2029]/u.test(text))return unchanged('authored-newline');
 if(!closingTail.test(text))return unchanged('no-cjk-closing-tail');
 const original=measure(width),lines=original.lines;
 if(!Array.isArray(lines)||lines.length<2||!closingOnly.test(lines.at(-1).trim())||!/\p{Script=Han}$/u.test(lines.at(-2).trim()))return unchanged('no-orphan');
 const maxShrink=Math.floor(Math.min(fontSize,width-1));
 for(let shrink=1;shrink<=maxShrink;shrink++){
  const candidate=measure(width-shrink),last=candidate.lines?.at(-1)?.trim();
  if(candidate.lines?.length!==lines.length||!balancedTail.test(last??'')||!Number.isFinite(candidate.height)||!Number.isFinite(candidate.width)||Math.ceil(candidate.height)>height||Math.ceil(candidate.width)>width)continue;
  return {changed:true,width:width-shrink,shrink,reason:'cjk-closing-orphan',before:[...lines],after:[...candidate.lines],height:candidate.height};
 }
 return unchanged('no-safe-balance');
}

export const cjkTitleBalancePolicy=Object.freeze({version:'cjk-title-orphan-balance-v1',minimumHanRatio:.7,maximumCandidateMeasurements:32});
export const cjkBodyBalancePolicy=Object.freeze({version:'cjk-body-short-tail-balance-v1',minimumHanRatio:.7,maximumCandidateMeasurements:32,maximumCharacters:64});
// A real metrics callback must prove identical line count and a complete fit.
// Caller-specific guards keep automatic titles and short body copy separate.
function selectCjkBalancedWrap({enabled=false,text,width,height,fontSize,wordWrap,measure},{policy,tail,requiredLines,maximumCharacters,reason}){
 const unchanged=reason=>({changed:false,width,reason});
 if(!enabled||!wordWrap||typeof text!=='string'||!Number.isFinite(width)||!Number.isFinite(height)||width<=1||height<=0||!Number.isFinite(fontSize)||fontSize<=0)return unchanged('scope');
 if(/[\r\n\u2028\u2029]/u.test(text))return unchanged('authored-newline');
 const chars=Array.from(text.replace(/\s/gu,'')),han=chars.filter(c=>/\p{Script=Han}/u.test(c)).length;
 if(maximumCharacters&&Array.from(text).length>maximumCharacters)return unchanged('body-too-long');
 if(!chars.length||han/chars.length<policy.minimumHanRatio)return unchanged('not-cjk-copy');
 const original=measure(width),lines=original.lines;
 if(!Array.isArray(lines)||lines.length<2||requiredLines&&lines.length!==requiredLines||!tail.test(lines.at(-1).trim()))return unchanged('no-title-orphan');
 if(!Number.isFinite(original.height)||!Number.isFinite(original.width)||Math.ceil(original.height)>height||Math.ceil(original.width)>width)return unchanged('original-does-not-fit');
 const counts=ls=>ls.map(line=>Array.from(line.trim()).length),spread=ns=>Math.max(...ns)-Math.min(...ns),beforeSpread=spread(counts(lines));
 let best=null,bestSpread=beforeSpread,measurements=1;const visited=new Set();
 for(let step=1;step<=policy.maximumCandidateMeasurements;step++){
  const shrink=Math.ceil((width-1)*step/policy.maximumCandidateMeasurements);if(visited.has(shrink))continue;visited.add(shrink);measurements++;
  const candidate=measure(width-shrink),after=candidate.lines;
  if(!Array.isArray(after)||after.length!==lines.length||!Number.isFinite(candidate.height)||!Number.isFinite(candidate.width)||Math.ceil(candidate.height)>height||Math.ceil(candidate.width)>width)continue;
  const lengths=counts(after),difference=spread(lengths);
  if(Math.min(...lengths)<2||difference>=bestSpread)continue;
  bestSpread=difference;best={changed:true,width:width-shrink,shrink,reason,policy:policy.version,before:[...lines],after:[...after],height:candidate.height,measurements};
  if(difference<=1)break;
 }
 return best?{...best,measurements}:unchanged('no-safe-title-balance');
}
export function selectCjkTitleWrap(input){
 return selectCjkBalancedWrap(input,{policy:cjkTitleBalancePolicy,tail:/^\p{Script=Han}$/u,reason:'cjk-title-orphan'});
}
export function selectCjkBodyWrap(input){
 return selectCjkBalancedWrap(input,{policy:cjkBodyBalancePolicy,tail:/^(?:[，。！？、；：…）】》〉」』〕］｝”’,.!?;:)\]}]{1,2}|\p{Script=Han}[，。！？、；：…）】》〉」』〕］｝”’,.!?;:)\]}]{0,2})$/u,requiredLines:2,maximumCharacters:cjkBodyBalancePolicy.maximumCharacters,reason:'cjk-body-short-tail'});
}

export function applyReferenceCjkWrap(text,width,height,{enabled=false,titleEnabled=false,bodyEnabled=false}={}){
 if(!enabled&&!titleEnabled)return {changed:false,width,reason:'scope'};
 // Always start from the current full box, so a resize cannot accumulate a
 // previous balance adjustment. Preflight and actual drawing use this path.
 text.style.wordWrapWidth=width;
 const input={enabled:true,text:text.text,width,height,fontSize:text.style.fontSize,wordWrap:text.style.wordWrap,
  measure:wordWrapWidth=>{
   const style=text.style.clone();style.wordWrapWidth=wordWrapWidth;
   return CanvasTextMetrics.measureText(text.text,style);
  },
 };
 let result;
 if(titleEnabled)result=selectCjkTitleWrap(input);
 else{
  const balanced=bodyEnabled?selectCjkBodyWrap(input):null;
  result=balanced?.changed?balanced:selectCjkClosingWrap(input);
  if(bodyEnabled)text.runtimeBodyWrap=balanced?.changed?{...balanced,originalWidth:width}:undefined;
 }
 if(result.changed)text.style.wordWrapWidth=result.width;
 if(titleEnabled)text.runtimeTitleWrap={policy:cjkTitleBalancePolicy.version,...result,originalWidth:width};
 return result;
}
