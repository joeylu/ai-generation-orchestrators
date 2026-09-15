/** Explicit target-component-local text lines; no inferred content or font fitting. */
export interface ButtonLabelLines {
  version: '1.0';
  coordinateSpace: 'target-component-local';
  lines: Array<{text:string; fontSize:number; fontWeight:'normal'|'bold'; align:'left'|'center'|'right'; layout:{x:number;y:number;width:number;height:number}}>;
}
export function buttonLabelLinesError(value:unknown,label:unknown,width:number,height:number):string|undefined {
  const object=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  const v=value as ButtonLabelLines;
  if(!object(v,['version','coordinateSpace','lines'])||v.version!=='1.0'||v.coordinateSpace!=='target-component-local')return 'BUTTON_LABEL_LINES_VERSION';
  if(!Array.isArray(v.lines)||v.lines.length<1||v.lines.length>8)return 'BUTTON_LABEL_LINES_COUNT';
  for(const [i,line] of v.lines.entries()) {
    if(!object(line,['text','fontSize','fontWeight','align','layout'])||typeof line.text!=='string'||!line.text.trim()||/[\r\n]/.test(line.text))return 'BUTTON_LABEL_LINES_FIELDS';
    if(typeof line.fontSize!=='number'||!Number.isFinite(line.fontSize)||line.fontSize<=0||!['normal','bold'].includes(line.fontWeight)||!['left','center','right'].includes(line.align))return 'BUTTON_LABEL_LINES_STYLE';
    const r=line.layout;
    if(!object(r,['x','y','width','height'])||![r.x,r.y,r.width,r.height].every(n=>typeof n==='number'&&Number.isFinite(n))||r.x<0||r.y<0||r.width<=0||r.height<line.fontSize*1.25||r.x+r.width>width||r.y+r.height>height)return 'BUTTON_LABEL_LINES_BOUNDS';
    if(v.lines.slice(0,i).some(q=>r.x<q.layout.x+q.layout.width&&r.x+r.width>q.layout.x&&r.y<q.layout.y+q.layout.height&&r.y+r.height>q.layout.y))return 'BUTTON_LABEL_LINES_OVERLAP';
  }
  if(v.lines.map(l=>l.text).join('\n')!==label)return 'BUTTON_LABEL_LINES_TEXT_MISMATCH';
}
