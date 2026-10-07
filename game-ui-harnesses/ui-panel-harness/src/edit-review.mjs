import { canonicalJson } from './canonical.mjs';

export const EDIT_REQUEST_CHECK_POLICY = 'explicit-geometry-v1';
const labels = Object.freeze({ width:'面板宽度', height:'面板高度', ratio:'面板比例', padding:'内边距', gap:'布局间距', titleHeight:'标题区域高度', sectionTitleHeight:'分组标题高度', rowHeight:'行高度', labelWidth:'标签区域宽度' });
const number = '(\\d{1,4}(?:\\.\\d{1,3})?)';
const verb = '(?:设置为|调整为|改成|改为|设为|为|[:：=])?';
const targets = [
  ['width','(?:(?:面板|界面)的?)?(?:宽度|宽)'],
  ['height','(?:面板|界面)的?(?:高度|高)'],
  ['padding','(?:(?:面板|界面)的?)?内边距'],
  ['gap','(?:布局)?间距'],
  ['titleHeight','(?:面板)?标题区域(?:高度|高)'],
  ['sectionTitleHeight','分组标题(?:高度|高)'],
  ['rowHeight','(?:行高度|行高)'],
  ['labelWidth','标签区域(?:宽度|宽)'],
].map(([field,target]) => [field,new RegExp('^(?:把|将)?'+target+verb+number+'(?:像素|px)?$','iu')]);

/** Deliberately small, whole-clause grammar. Unknown prose is never marked checked.
 * Negations, quoted examples, relative changes and conflicting values are excluded.
 * The model does not author or amend this list. Offsets refer to the exact request.
 */
export function explicitEditRequirements(request, selection = null) {
  const candidates = [], unverified = [];
  const normalized = request.replace(/\r/g,' '); // Same length: preserve UTF-16 offsets.
  for (const match of normalized.matchAll(/[^，,；;\n。！？!?]+/gu)) {
    const raw = match[0], trimmed = raw.trim();
    if (!trimmed) continue;
    const start = match.index + raw.indexOf(trimmed), end = start + trimmed.length;
    const clause = trimmed.replace(/\s+/gu,'');
    let item;
    if (!selection) {
      for (const [field,pattern] of targets) {
        const found = clause.match(pattern);
        if (found) { item = {field,expected:Number(found[1])}; break; }
      }
      const ratio = clause.match(/^(?:(?:把|将)?(?:面板|界面)?(?:比例)?)?(?:设置为|调整为|改成|改为|设为|为|[:：=])?(\d{1,4})[:：](\d{1,4})(?:竖版|横版)?$/u);
      if (ratio && Number(ratio[1]) > 0 && Number(ratio[2]) > 0) item = {field:'ratio',expected:{width:Number(ratio[1]),height:Number(ratio[2])}};
    }
    const source = {start,end,quote:request.slice(start,end)};
    if (item) candidates.push({...source,...item});
    else unverified.push(source);
  }
  // Repeated/conflicting assignments and correction language are ambiguous. Do
  // not guess last-write-wins, or block a legitimate correction to an old value.
  const ambiguous = /不对|说错|更正|纠正|刚才|之前|原来|回答|问题|补充回答|例如|比如|示例|假设|引用|[“”"「」‘’']/u.test(request);
  const counts = new Map();
  for (const item of candidates) counts.set(item.field,(counts.get(item.field)??0)+1);
  const items = [];
  for (const item of candidates) {
    if (ambiguous || counts.get(item.field)>1) unverified.push({start:item.start,end:item.end,quote:item.quote});
    else items.push({...item,id:'geometry-'+item.field});
  }
  unverified.sort((a,b)=>a.start-b.start);
  if (unverified.length > 64) {
    const start=unverified[63].start,end=unverified.at(-1).end;
    unverified.splice(63,unverified.length-63,{start,end,quote:request.slice(start,end)});
  }
  return {policy:EDIT_REQUEST_CHECK_POLICY,items,unverified};
}

/** Read the resulting authored document, not operation counts or quoted claims. */
export function checkExplicitEditRequirements(requirements, spec) {
  const items = requirements.items.map(item => {
    const actual = item.field === 'ratio' ? spec.frame ?? null : item.field === 'height'
      ? spec.frame?.height ?? null : spec.layout[item.field] ?? null;
    const matched = item.field === 'ratio' ? actual !== null && Math.abs(actual.width * item.expected.height - actual.height * item.expected.width) < 1e-7
      : actual === item.expected;
    return {...item,label:labels[item.field],actual,matched};
  });
  return {policy:requirements.policy,status:items.some(item=>!item.matched)?'MISMATCH':items.length?'MATCHED':'NOT_CHECKED',
    items,unverifiedCount:requirements.unverified.length,semanticReview:'NOT_RUN'};
}

const names = {title:'面板标题',theme:'主题',frame:'固定面板尺寸',layout:'布局',appearance:'全局外观',titleBar:'标题样式',
  actionLayouts:'按钮排列',buttonStyles:'按钮样式',buttonFonts:'按钮字号',textLayouts:'文字换行',tabs:'页签',assets:'图片与图标',
  label:'标签',enabled:'启用状态',initial:'默认值',text:'正文',action:'点击行为',placeholder:'输入提示',validation:'输入校验',
  min:'最小值',max:'最大值',step:'步长',options:'选项',body:'内容排列',overflow:'溢出处理',maxHeight:'高度上限',...labels};

/** Actual before/after Spec differences. ID-based row comparison avoids insert
 * shifts being mislabeled as edits to all following controls. Derived canvas and
 * protocol versions are omitted; the summary never claims semantic completeness.
 */
export function describePanelChanges(before, after) {
  const changes = [], same = (a,b)=>canonicalJson(a??null)===canonicalJson(b??null);
  const add = (path,label,a,b)=>{if(!same(a,b))changes.push({path,label,before:a??null,after:b??null});};
  for (const key of new Set([...Object.keys(before),...Object.keys(after)])) {
    if (!['id','panelSpecVersion','canvas','layout','state','sections','provenance'].includes(key)) add(key,names[key]??key,before[key],after[key]);
  }
  for (const key of new Set([...Object.keys(before.layout),...Object.keys(after.layout)])) add('layout.'+key,names[key]??'布局 · '+key,before.layout[key],after.layout[key]);
  const oldRows = new Map(before.sections.flatMap(section=>section.rows).map(row=>[row.id,row]));
  const newRows = new Map(after.sections.flatMap(section=>section.rows).map(row=>[row.id,row]));
  for (const id of new Set([...oldRows.keys(),...newRows.keys()])) {
    const a=oldRows.get(id),b=newRows.get(id),label=(b??a).label||id;
    if (!a || !b) {add('row.'+id,`${a?'移除':'新增'}控件 · ${label}`,a?{id,kind:a.kind}:null,b?{id,kind:b.kind}:null);continue;}
    for (const key of new Set([...Object.keys(a),...Object.keys(b)])) if(key!=='id')add('row.'+id+'.'+key,label+' · '+(names[key]??key),a[key],b[key]);
  }
  const aState=new Map(before.state.map(field=>[field.id,field])),bState=new Map(after.state.map(field=>[field.id,field]));
  for (const id of new Set([...aState.keys(),...bState.keys()])) {
    const a=aState.get(id),b=bState.get(id),row=[...newRows.values(),...oldRows.values()].find(row=>row.bind===id),label=row?.label||id;
    if(!a||!b){add('state.'+id,`${a?'移除':'新增'}数据 · ${label}`,a,b);continue;}
    for(const key of new Set([...Object.keys(a),...Object.keys(b)]))if(key!=='id')add('state.'+id+'.'+key,label+' · '+(names[key]??key),a[key],b[key]);
  }
  add('sections.order','分组与控件顺序',before.sections.map(s=>({id:s.id,title:s.title,rows:s.rows.map(r=>r.id)})),after.sections.map(s=>({id:s.id,title:s.title,rows:s.rows.map(r=>r.id)})));
  return changes;
}

export function editChangeValue(value) {
  if(value && typeof value==='object' && Object.keys(value).length===2 && Number.isFinite(value.width) && Number.isFinite(value.height)) {
    return `${value.width} × ${Number(value.height.toFixed(2))}`;
  }
  const text = value === null ? '无' : value === '' ? '空字符串' : typeof value === 'boolean' ? value?'开启':'关闭' : typeof value === 'string' ? value : JSON.stringify(value);
  return text.length>100?text.slice(0,99)+'…':text;
}
