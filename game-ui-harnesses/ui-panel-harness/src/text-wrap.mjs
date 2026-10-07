/** Versioned, renderer-free wrapping. Source text stays authoritative in PanelSpec. */
const segmenter = new Intl.Segmenter('und', {granularity:'grapheme'});
const closingPunctuation = /^[，。！？：；、）》】」』”’]$/u;
const endsWithOpeningPunctuation = /[（《【「『“‘]$/u;
export const staticTextWidth = value => [...value].reduce((sum,char)=>sum+(/^[\x00-\x7f]$/.test(char)?0.8:1.1),0);
export const hasTextWrap = (spec,rowId) => Array.isArray(spec.textLayouts)&&spec.textLayouts.some(entry=>entry?.rowId===rowId&&entry.wrap==='word');
// Core Text nodes require trimmed strings. Keep indentation as geometry and
// blank paragraphs as empty line slots; the unmodified source remains in Spec.
export function wrappedLinePresentation(value, fontSize) {
  const text = value.trim();
  return {text, indent:text ? staticTextWidth(value.slice(0, value.length - value.trimStart().length))*fontSize : 0};
}
export function checkTextLayouts(spec,fail){
  if(!Array.isArray(spec.textLayouts)||spec.textLayouts.length>128)fail('text-layout-list','$.textLayouts','up to 128 text layouts required');
  const rows=new Map(spec.sections.flatMap(s=>s.rows).map(r=>[r.id,r])),seen=new Set();
  for(const [i,entry] of spec.textLayouts.entries()){
    const path=`$.textLayouts[${i}]`;
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).length!==2||!Object.hasOwn(entry,'rowId')||entry.wrap!=='word'||typeof entry.rowId!=='string')fail('text-layout-fields',path,'rowId and wrap:word required');
    if(rows.get(entry.rowId)?.kind!=='text'||seen.has(entry.rowId))fail('text-layout-target',path,'unique existing Text row required');
    seen.add(entry.rowId);
  }
}
export function checkWrappedText(value,fail,path){
  if(typeof value!=='string'||!value.trim()||[...value].length>1000||/[\p{Cc}\p{Cs}]/u.test(value.replace(/\r\n|\n/gu,'')))fail('text',path,'nonempty text up to 1000 code points; only LF/CRLF line controls allowed');
}
export function wrapStaticText(value,width,fontSize){
  const reject=()=>{const error=new Error('Text width must fit every complete grapheme without truncation');error.code='TEXT_WRAP_WIDTH';throw error;};
  if(!Number.isFinite(width)||width<=0||!Number.isFinite(fontSize)||fontSize<=0)reject();
  const lines=[];
  for(const paragraph of value.replace(/\r\n|\u2028|\u2029/gu,'\n').split('\n')){
    const graphemes=[...segmenter.segment(paragraph)].map(s=>s.segment),tokens=[];
    for(const g of graphemes){
      const ascii=/^[\x21-\x7e]+$/u.test(g),previous=tokens.at(-1);
      if(previous && (ascii&&previous.ascii || closingPunctuation.test(g)&&!/^\s+$/u.test(previous.text) || endsWithOpeningPunctuation.test(previous.text))) {
        previous.text+=g;previous.ascii=previous.ascii&&ascii;
      } else tokens.push({text:g,ascii});
    }
    let line='',used=0;
    const flush=()=>{lines.push(line.trimEnd());line='';used=0;};
    for(const token of tokens){
      if (/^\s+$/u.test(token.text)) { line+=token.text; used+=staticTextWidth(token.text)*fontSize; continue; }
      const tokenWidth=staticTextWidth(token.text)*fontSize;
      if(tokenWidth<=width){if(used+tokenWidth>width+1e-8)flush();line+=token.text;used+=tokenWidth;continue;}
      // Prefer whole English words; oversized tokens (e.g. URLs) may break at graphemes.
      if(line)flush();
      const pieces=[];
      for(const {segment:g} of segmenter.segment(token.text)) {
        if(pieces.length&&(closingPunctuation.test(g)||endsWithOpeningPunctuation.test(pieces.at(-1))))pieces[pieces.length-1]+=g;
        else pieces.push(g);
      }
      for(const g of pieces){
        const size=staticTextWidth(g)*fontSize;if(size>width+1e-8)reject();
        if(used+size>width+1e-8)flush();line+=g;used+=size;
      }
    }
    flush();
  }
  const lineHeight=Math.ceil(fontSize*1.5);
  return {lines,lineHeight,height:lines.length*lineHeight+4};
}
