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

export function applyReferenceCjkWrap(text,width,height,{enabled=false}={}){
 if(!enabled)return {changed:false,width,reason:'scope'};
 // Always start from the current full box, so a resize cannot accumulate a
 // previous balance adjustment. Preflight and actual drawing use this path.
 text.style.wordWrapWidth=width;
 const result=selectCjkClosingWrap({enabled:true,text:text.text,width,height,fontSize:text.style.fontSize,wordWrap:text.style.wordWrap,
  measure:wordWrapWidth=>{
   const style=text.style.clone();style.wordWrapWidth=wordWrapWidth;
   return CanvasTextMetrics.measureText(text.text,style);
  },
 });
 if(result.changed)text.style.wordWrapWidth=result.width;
 return result;
}
