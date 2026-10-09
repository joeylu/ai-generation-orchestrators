import {canonicalJson} from './canonical.mjs';
import {explicitEditRequirements,checkExplicitEditRequirements} from './edit-review.mjs';
import {APPEARANCE_KEYS} from './appearance.mjs';
import {TITLE_BAR_KEYS} from './title-bar.mjs';
import {isSelectedEditOperation} from './edit-selection.mjs';

export const EDIT_PROPERTY_CHECK_POLICY='explicit-properties-v2';
export const EDIT_COPY_CHECK_POLICY='explicit-properties-v3';
export const EDIT_SCOPED_COPY_CHECK_POLICY='explicit-properties-v4';
const equal=(a,b)=>canonicalJson(a??null)===canonicalJson(b??null);
const quoted=/^(?:“([\s\S]*)”|"([\s\S]*)"|「([\s\S]*)」|'([\s\S]*)')$/u;
const verb='(?:设置为|调整为|改成|改为|设为|为|[:：=])';
const copyAssignment=new RegExp('^(?:只)?(?:把|将)?(.+?)(?:的)?按钮(?:的|上的)?(?:文字|文案)\\s*'+verb+'\\s*(.+)$','u');
const colors={面板背景色:['panelColor','surface'],强调色:['accentColor','accent'],文字颜色:['textColor','text'],控件背景色:['controlColor','control'],边框颜色:['borderColor','border']};
const splitClauses=request=>{
 const result=[];let begin=0,closing=null;
 const pairs={'“':'”','「':'」','"':'"',"'":"'"};
 for(let i=0;i<request.length;i++){
  const c=request[i];
  if(closing){if(c===closing)closing=null;continue;}
  if(pairs[c]){closing=pairs[c];continue;}
  if(/[，,；;\n。！？!?]/u.test(c)){result.push([begin,i]);begin=i+1;}
 }
 if(closing)return null;result.push([begin,request.length]);
 return result.map(([a,b])=>{const raw=request.slice(a,b),quote=raw.trim(),start=a+raw.indexOf(quote);return {start,end:start+quote.length,quote};}).filter(c=>c.quote);
};
const unquote=value=>{const match=value.match(quoted);return match?match.slice(1).find(v=>v!==undefined):null;};
// Copy assignments must end at the first matching closing quote. A compound
// sentence without a separator is unverified, not one oversized button label.
const unquoteCopy=value=>{const match=value.match(/^(?:“([^“”]*)”|"([^"]*)"|「([^「」]*)」|'([^']*)')$/u);return match?match.slice(1).find(v=>v!==undefined):null;};
const rowName=row=>row.buttonLabel||row.label||row.id;
function findRow(spec,name,selection,kind){
 const rows=spec.sections.flatMap(s=>s.rows);
 const matches=/^(?:这个|此)(?:按钮|控件)?$/u.test(name)&&selection
  ? rows.filter(r=>r.id===selection.rowId) : rows.filter(r=>rowName(r)===name);
 if(matches.length!==1||selection&&matches[0].id!==selection.rowId||kind&&matches[0].kind!==kind)return null;
 return matches[0];
}
function findScopedCopyRow(spec,source,selection){
 // A quoted complete name is literal even when it contains qualifier words.
 const literal=unquoteCopy(source);
 const qualified=literal===null?source.match(/^(.+?)分组(?:里的|中的|内的|的)(.+)$/u):null;
 let rows=spec.sections.flatMap(section=>section.rows),name=literal??source;
 if(qualified){
  const sectionName=unquoteCopy(qualified[1])??qualified[1];
  const sections=spec.sections.filter(section=>section.title===sectionName);
  if(sections.length!==1)return null;
  rows=sections[0].rows;name=unquoteCopy(qualified[2])??qualified[2];
 }else if(selection){
  // The program-owned selection disambiguates an exact duplicate name.
  const row=rows.find(row=>row.id===selection.rowId);
  return row?.kind==='button'&&(rowName(row)===name||literal===null&&/^(?:这个|此)(?:按钮|控件)?$/u.test(name))?row:null;
 }
 const matches=rows.filter(row=>row.kind==='button'&&rowName(row)===name);
 return matches.length===1&&(!selection||matches[0].id===selection.rowId)?matches[0]:null;
}
function propertyClause(source,spec,catalog,selection,policy){
 const text=source.quote;let m;
 if([EDIT_COPY_CHECK_POLICY,EDIT_SCOPED_COPY_CHECK_POLICY].includes(policy)){
  m=text.match(copyAssignment);
  if(m){
   const name=m[1].replace(/的$/u,''),row=policy===EDIT_SCOPED_COPY_CHECK_POLICY?findScopedCopyRow(spec,name,selection):findRow(spec,unquote(name)??name,selection,'button'),value=unquoteCopy(m[2]);
   if(row&&value!==null&&value.trim()&&!/[\p{Cc}\p{Cs}]/u.test(value))return {field:'buttonLabel',target:row.id,expected:value,label:rowName(row)+' · 按钮文字'};
  }
 }
 if(!selection){
  m=text.match(new RegExp('^(?:把|将)?(?:面板|界面)?标题\\s*'+verb+'\\s*(.+)$','u'));
  if(m){const value=unquote(m[1]);if(value!==null&&value.trim()&&!/[\p{Cc}]/u.test(value))return {field:'title',target:null,expected:value,label:'面板标题'};}
  m=text.replace(/\s/gu,'').match(new RegExp('^(?:把|将)?(?:面板)?标题字号'+verb+'?(\\d{1,2})(?:像素|px)?$','iu'));
  if(m)return {field:'titleFont',target:null,expected:Number(m[1]),label:'标题字号'};
  for(const[name,[key]]of Object.entries(colors)){
   m=text.replace(/\s/gu,'').match(new RegExp('^(?:把|将)?'+name+verb+'?(#[0-9a-fA-F]{6})$','u'));
   if(m)return {field:'color',target:key,expected:m[1].toUpperCase(),label:name};
  }
  m=text.replace(/\s/gu,'').match(/^(?:(?:把|将)?(?:面板|界面)?(?:主题)?(?:改成|改为|设为|设置为|为))?(绿色|薄荷绿|蓝色|紫色|橙色)主题$/u);
  if(m){
   const family={绿色:'mint',薄荷绿:'mint',蓝色:'blue',紫色:'violet',橙色:'orange'}[m[1]],mode=spec.theme.id.endsWith('-dark')?'dark':'light';
   const themes=catalog.themes.filter(t=>t.id===`modern-${family}-${mode}`);
   if(themes.length===1)return {field:'theme',target:null,expected:{id:themes[0].id,version:themes[0].version},label:'预设主题'};
  }
 }
 m=text.match(new RegExp('^(?:把|将)?(.+?)(?:的)?(?:按钮)?字号\\s*'+verb+'?\\s*(\\d{1,2})(?:\\s*(?:像素|px))?$','iu'));
 if(m){const row=findRow(spec,m[1].replace(/的$/u,''),selection,'button');if(row)return {field:'buttonFont',target:row.id,expected:Number(m[2]),label:rowName(row)+' · 字号'};}
 m=text.match(new RegExp('^(?:把|将)?(.+?)(?:的)?默认(?:值)?\\s*'+verb+'?\\s*(.+)$','u'));
 if(m){
  const row=findRow(spec,m[1].replace(/的$/u,''),selection),field=spec.state.find(f=>f.id===row?.bind);
  if(field){let expected;
   if(['number','progress'].includes(field.type)&&/^-?\d{1,10}(?:\.\d{1,6})?$/u.test(m[2]))expected=Number(m[2]);
   else if(field.type==='boolean'&&/^(开启|打开|关闭|true|false)$/u.test(m[2]))expected=['开启','打开','true'].includes(m[2]);
   else if(field.type==='string')expected=unquote(m[2]);
   if(expected!==undefined&&expected!==null)return {field:'initial',target:field.id,expected,label:rowName(row)+' · 默认值'};
  }
 }
 return null;
}

/** Recomputed from the immutable request and base IDs. This grammar remains
 * deliberately bounded; unrecognized prose is never declared semantically checked. */
export function explicitPropertyRequirements(request,spec,catalog,selection=null,policy=EDIT_PROPERTY_CHECK_POLICY){
 if(![EDIT_PROPERTY_CHECK_POLICY,EDIT_COPY_CHECK_POLICY,EDIT_SCOPED_COPY_CHECK_POLICY].includes(policy))throw new Error('EDIT_PROPERTY_CHECK_POLICY');
 const clauses=splitClauses(request),candidates=[],unverified=[];let preserve=null;
 const outer=request.replace(/“[^”]*”|"[^"]*"|「[^」]*」|'[^']*'/gu,'');
 const ambiguous=/不对|说错|更正|纠正|刚才|之前|原来|回答|问题|补充回答|例如|比如|示例|假设|引用/u.test(outer);
 if(!clauses||ambiguous)return {policy,items:[],unverified:[{start:0,end:request.length,quote:request}],preserveRest:{requested:false,enforced:false,source:null}};
 for(const source of clauses){
  if(/^(?:其他|其余)(?:全部|都)?(?:保持)?不变$/u.test(source.quote.replace(/\s/gu,''))){preserve=source;continue;}
  const property=propertyClause(source,spec,catalog,selection,policy);
  const geometry=property?null:explicitEditRequirements(source.quote,selection).items[0];
  if(property)candidates.push({...source,...property});
  else if(geometry){const checked=checkExplicitEditRequirements({policy:'explicit-geometry-v1',items:[geometry],unverified:[]},spec).items[0];candidates.push({...source,field:geometry.field,target:null,expected:geometry.expected,label:checked.label});}
  else unverified.push(source);
 }
 const keys=new Map();for(const item of candidates){const key=item.field+':'+item.target;keys.set(key,(keys.get(key)??0)+1);}
 const items=[];
 for(const item of candidates){if(keys.get(item.field+':'+item.target)>1)unverified.push({start:item.start,end:item.end,quote:item.quote});else items.push({...item,id:'property-'+items.length});}
 if(items.length>64||unverified.length>64)return {policy,items:[],unverified:[{start:0,end:request.length,quote:request}],preserveRest:{requested:Boolean(preserve),enforced:false,source:preserve}};
 return {policy,items,unverified:unverified.sort((a,b)=>a.start-b.start),preserveRest:{requested:Boolean(preserve),enforced:Boolean(preserve)&&!unverified.length&&items.length>0,source:preserve}};
}

/** Studio-only assistance for one exact duplicate-name rename. No public gate or context mutation. */
export function ambiguousButtonCopyChoices(context){
 if(context?.editContextVersion!=='0.14'||context.requestChecks?.policy!==EDIT_SCOPED_COPY_CHECK_POLICY||context.selection
  ||!['0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(context.spec.panelSpecVersion)
  ||!context.catalog.themes.some(t=>t.id===context.spec.theme.id&&t.version===context.spec.theme.version&&t.visualStyle==='modern-v3'))return [];
 const requirements=explicitPropertyRequirements(context.request.text,context.spec,context.catalog,null,EDIT_SCOPED_COPY_CHECK_POLICY);
 if(requirements.items.length||requirements.unverified.length!==1)return [];
 const match=requirements.unverified[0].quote.match(copyAssignment);if(!match)return [];
 const source=match[1].replace(/的$/u,''),literal=unquoteCopy(source),value=unquoteCopy(match[2]);
 if(value===null||!value.trim()||/[\p{Cc}\p{Cs}]/u.test(value)||literal===null&&/分组(?:里的|中的|内的|的)/u.test(source))return [];
 const name=literal??source,sections=context.spec.sections;
 const matches=sections.flatMap((section,sectionIndex)=>section.rows.flatMap((row,rowIndex)=>
  row.kind==='button'&&rowName(row)===name?[{row,section,sectionIndex,rowIndex}]:[]));
 if(matches.length<2)return [];
 return matches.map(({row,section,sectionIndex,rowIndex})=>{
  const repeatedSection=sections.filter(s=>s.title===section.title).length>1;
  const repeatedRow=section.rows.filter(r=>r.kind==='button'&&rowName(r)===name).length>1;
  const group=section.title||`第${sectionIndex+1}组`;
  return{rowId:row.id,label:`${group}${repeatedSection&&section.title?`（第${sectionIndex+1}组）`:''} · ${name}${repeatedRow?`（第${rowIndex+1}项）`:''}`};
 });
}

function projection(spec,items){
 const value=structuredClone(spec);
 delete value.panelSpecVersion;
 value.appearance={...Object.fromEntries(APPEARANCE_KEYS.map(k=>[k,null])),...value.appearance};
 value.titleBar={...Object.fromEntries(TITLE_BAR_KEYS.map(k=>[k,k==='padding'?0:null])),...value.titleBar};
 for(const object of [value.appearance,value.titleBar])for(const key of Object.keys(object))if(typeof object[key]==='string'&&/^#[0-9a-f]{6}$/iu.test(object[key]))object[key]=object[key].toUpperCase();
 for(const key of ['actionLayouts','buttonStyles','buttonFonts','textLayouts'])value[key]=[...(value[key]??[])].sort((a,b)=>{const x=a.rowId??a.sectionId,y=b.rowId??b.sectionId;return x<y?-1:x>y?1:0;});
 value.frame={width:value.frame?.width??value.layout.width,height:value.frame?.height??null};
 const frameChange=items.some(i=>['width','height','ratio'].includes(i.field));
 if(frameChange)delete value.canvas; // Canvas size is deterministically derived by frame edits.
 for(const item of items){
  if(item.field==='title')delete value.title;
  else if(item.field==='theme')delete value.theme;
  else if(item.field==='color')delete value.appearance[item.target];
  else if(item.field==='titleFont')delete value.titleBar.fontSize;
  else if(item.field==='buttonFont')value.buttonFonts=value.buttonFonts.filter(f=>f.rowId!==item.target);
  else if(item.field==='buttonLabel'){const row=value.sections.flatMap(s=>s.rows).find(r=>r.id===item.target);if(row)delete row.buttonLabel;}
  else if(item.field==='initial'){const field=value.state.find(f=>f.id===item.target);if(field)delete field.initial;}
  else if(item.field==='width'){delete value.layout.width;delete value.frame.width;}
  else if(item.field==='height'||item.field==='ratio'){delete value.frame.height;delete value.layout.maxHeight;}
  else delete value.layout[item.field];
 }
 return value;
}
const themeOf=(spec,catalog)=>catalog.themes.find(t=>t.id===spec.theme.id&&t.version===spec.theme.version);
function actualValue(item,spec,catalog){
 const theme=themeOf(spec,catalog);
 if(item.field==='title')return spec.title;
 if(item.field==='theme')return spec.theme;
 if(item.field==='color'){const token=Object.values(colors).find(([key])=>key===item.target)?.[1];return (spec.appearance?.[item.target]??theme?.tokens[token]??'').toUpperCase();}
 if(item.field==='titleFont')return spec.titleBar?.fontSize??theme?.tokens.titleSize??null;
 if(item.field==='buttonFont')return spec.sections.some(s=>s.rows.some(r=>r.id===item.target&&r.kind==='button'))?spec.buttonFonts?.find(f=>f.rowId===item.target)?.fontSize??theme?.tokens.fontSize??null:null;
 if(item.field==='buttonLabel')return spec.sections.flatMap(s=>s.rows).find(r=>r.id===item.target&&r.kind==='button')?.buttonLabel??null;
 if(item.field==='initial')return spec.state.find(f=>f.id===item.target)?.initial??null;
 return checkExplicitEditRequirements({policy:'explicit-geometry-v1',items:[item],unverified:[]},spec).items[0].actual;
}
function changedPaths(a,b,path='$',out=[]){
 if(equal(a,b))return out;
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b))for(const key of new Set([...Object.keys(a),...Object.keys(b)]))changedPaths(a[key],b[key],path+'.'+key,out);
 else out.push(path);
 return out;
}
export function checkExplicitPropertyRequirements(requirements,spec,catalog,before){
 const items=requirements.items.map(item=>{const actual=actualValue(item,spec,catalog);return {...item,actual,matched:item.field==='ratio'?actual!==null&&Math.abs(actual.width*item.expected.height-actual.height*item.expected.width)<1e-7:equal(actual,item.expected)};});
 const preserve=requirements.preserveRest;
 const paths=preserve.enforced?changedPaths(projection(before,requirements.items),projection(spec,requirements.items)):[];
 const friendly=path=>({title:'面板标题',theme:'主题',state:'默认值或数据',sections:'控件或分组',appearance:'外观',titleBar:'标题样式',buttonFonts:'按钮字号',canvas:'画布',layout:'布局'})[path.split('.')[1]]??'未指定属性';
 if(preserve.enforced)items.push({...preserve.source,id:'preserve-rest',field:'preserveRest',target:null,label:'其他属性',expected:'保持不变',actual:paths.length?'还修改了 '+[...new Set(paths.map(friendly))].slice(0,5).join('、'):'保持不变',matched:!paths.length});
 return {policy:requirements.policy,status:items.some(i=>!i.matched)?'MISMATCH':items.length?'MATCHED':'NOT_CHECKED',items,unverifiedCount:requirements.unverified.length,
  preserveRest:{requested:preserve.requested,enforced:preserve.enforced,status:preserve.enforced?paths.length?'MISMATCH':'MATCHED':'NOT_CHECKED',changedPaths:paths},semanticReview:'NOT_RUN'};
}

/** Studio preflight only: all bounded facts already match and the rest is explicitly preserved.
 * Recompute from the request, never trust cached items. This is not a model proposal or edit commit. */
export function alreadySatisfiedEditRequirements(context){
 if(context?.editContextVersion!=='0.14'||context.requestChecks?.policy!==EDIT_SCOPED_COPY_CHECK_POLICY)return null;
 const requirements=explicitPropertyRequirements(context.request.text,context.spec,context.catalog,context.selection,EDIT_SCOPED_COPY_CHECK_POLICY);
 if(!requirements.items.length||requirements.unverified.length||!requirements.preserveRest.enforced)return null;
 const report=checkExplicitPropertyRequirements(requirements,context.spec,context.catalog,context.spec);
 return report.status==='MATCHED'?report:null;
}

/** Studio preflight only. Reuse the bounded grammar without selection to find
 * explicit requirements that the selected-row contract cannot perform. Unknown
 * prose and corrections remain unverified; never infer or change the target. */
export function selectedEditScopeConflicts(context){
 if(context?.editContextVersion!=='0.14'||context.requestChecks?.policy!==EDIT_SCOPED_COPY_CHECK_POLICY||!context.selection)return [];
 const selected=explicitPropertyRequirements(context.request.text,context.spec,context.catalog,context.selection,EDIT_SCOPED_COPY_CHECK_POLICY);
 const whole=explicitPropertyRequirements(context.request.text,context.spec,context.catalog,null,EDIT_SCOPED_COPY_CHECK_POLICY);
 return whole.items.filter(item=>{
  if(selected.items.some(allowed=>allowed.start===item.start&&allowed.end===item.end))return false;
  const operation=item.field==='initial'?{op:'set-state-initial',fieldId:item.target}
   :item.field==='buttonLabel'?{op:'set-button-label',rowId:item.target}
   :item.field==='buttonFont'?{op:'set-button-font-size',rowId:item.target}:null;
  return !operation||!isSelectedEditOperation(context.spec,context.selection,operation);
 });
}
