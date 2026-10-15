// Expectations are frozen from authored requests, never inferred from the result.
const controlSuffixes={switch:['开关'],slider:['音量','滑块']};
function baseLabel(label,suffixes){
 const suffix=suffixes.find(suffix=>label.endsWith(suffix)&&label.length>suffix.length);
 return suffix?label.slice(0,-suffix.length):label;
}
function sameLabel(actual,expected,suffixes=[],exact=false){
 if(typeof actual!=='string'||typeof expected!=='string'||!actual||!expected)return false;
 return exact?actual===expected:baseLabel(actual,suffixes)===baseLabel(expected,suffixes);
}
function ownership(content){
 const tree=[];function visit(node){if(!node)return;tree.push(node);for(const child of node.children??[])visit(child);}visit(content.layoutBody);
 const sections=tree.filter(node=>node.kind==='section'),rows=new Map(),owners=new Map();
 for(const row of [...(content.fields??[]),...(content.actions??[])])rows.set(row.id,[...(rows.get(row.id)??[]),row]);
 for(const section of sections)for(const id of section.rowIds??[])owners.set(id,[...(owners.get(id)??[]),section]);
 const validSection=section=>Array.isArray(section.rowIds)&&section.rowIds.length>0&&section.rowIds.every(id=>rows.get(id)?.length===1&&owners.get(id)?.length===1);
 const unambiguousField=field=>(field.id==null||rows.get(field.id)?.length===1)&&(owners.get(field.id)?.length??0)<=1;
 const owner=field=>{const candidates=owners.get(field.id)??[];return candidates.length===1&&validSection(candidates[0])?candidates[0]:null;};
 return {tree,sections,validSection,unambiguousField,owner};
}
export function semanticIssues(expected,content,documents){
 const issues=[],fields=content.fields??[],actions=content.actions??[],index=ownership(content),{tree}=index,display=[content.title,content.sectionTitle,...fields.flatMap(f=>[f.label,f.text,typeof f.value==='string'?f.value:null,...(f.options??[]).map(o=>o.label)]),...actions.map(a=>a.label),...(content.items??[]).map(i=>i.name),...tree.map(node=>node.title)].filter(v=>typeof v==='string');
 const issue=(code,detail)=>issues.push({code,...detail});
 const sectionLabel=(actual,label,exact=false)=>sameLabel(actual,label,['组'],exact||expected.sectionTitlesExact===true);
 const ownsLabel=(field,label,exact=false)=>field.label===label||sectionLabel(index.owner(field)?.title,label,exact);
 const pairCandidates=(pair,type,matches)=>fields.filter(field=>field.type===type&&index.unambiguousField(field)&&ownsLabel(field,pair.label,pair.labelExact===true)&&matches(field));
 for(const text of expected.literals??[])if(!display.some(v=>v.includes(text)))issue('literal-missing',{text});
 for(const pair of expected.textPairs??[])if(pairCandidates(pair,'text',field=>field.text===String(pair.value)).length!==1)issue('data-pair-missing',pair);
 for(const pair of expected.progressPairs??[]){
  const matches=pairCandidates(pair,'progress-bar',field=>['value','max','display'].every(key=>pair[key]===undefined||field[key]===pair[key])&&(pair.percent===undefined||Number.isFinite(pair.percent)&&Number.isFinite(field.value)&&Number.isFinite(field.max)&&field.max>0&&Math.abs(field.value/field.max*100-pair.percent)<1e-7));
  if(matches.length!==1)issue('progress-pair-missing',pair);
 }
 if(expected.title!==undefined&&content.title!==expected.title)issue('title',{expected:expected.title,actual:content.title});
 const matchedLabels=new Map();
 for(const e of expected.fields??[]){const candidates=fields.filter(f=>f.type===e.type&&sameLabel(f.label,e.label,controlSuffixes[e.type]??[],e.labelExact===true));if(candidates.length!==1){issue(candidates.length?'field-ambiguous':'field-missing',e);continue;}const f=candidates[0];matchedLabels.set(f.id,[...(matchedLabels.get(f.id)??[]),e.label]);for(const [key,value] of Object.entries(e)){
   if(key==='label'||key==='labelExact')continue;
   if(key==='options'){if(JSON.stringify(f.options?.map(o=>o.label))!==JSON.stringify(value))issue('field-options',{label:e.label,expected:value,actual:f.options});}
   else if(key==='selectedLabel'){if(f.options?.find(o=>o.id===f.value)?.label!==value)issue('field-selection',{label:e.label,expected:value});}
   else if(JSON.stringify(f[key])!==JSON.stringify(value))issue('field-value',{label:e.label,key,expected:value,actual:f[key]});
 }}
 if(expected.fieldCount!==undefined&&fields.length!==expected.fieldCount)issue('field-count',{expected:expected.fieldCount,actual:fields.length});
 if(expected.actionCount!==undefined&&actions.length!==expected.actionCount)issue('action-count',{expected:expected.actionCount,actual:actions.length});
 for(const e of expected.actions??[]){const a=actions.find(a=>a.label===e.label);if(!a){issue('action-missing',e);continue;}for(const key of ['action','enabled'])if(e[key]!==undefined&&a[key]!==e[key])issue('action-value',{label:e.label,key,expected:e[key],actual:a[key]});if(e.targets){const actual=a.targets.map(id=>fields.find(f=>f.id===id)?.label).sort(),logical=a.targets.map(id=>matchedLabels.get(id)?.length===1?matchedLabels.get(id)[0]:fields.find(f=>f.id===id)?.label).sort();if(JSON.stringify(logical)!==JSON.stringify([...e.targets].sort()))issue('action-targets',{label:e.label,expected:e.targets,actual});}}
 if(expected.sectionTitles){const actual=index.sections.map(n=>n.title);if(expected.sectionTitles.some(title=>{const candidates=index.sections.filter(section=>sectionLabel(section.title,title));return candidates.length!==1||!index.validSection(candidates[0]);}))issue('section-titles',{expected:expected.sectionTitles,actual});}
 for(const kind of expected.layoutKinds??[])if(!tree.some(n=>n.kind===kind))issue('layout-kind',{kind});
 if(expected.rowChildren!==undefined&&!tree.some(n=>n.kind==='row'&&n.children.length===expected.rowChildren))issue('row-child-count',{expected:expected.rowChildren});
 if(expected.progressValues){const actual=fields.filter(f=>f.type==='progress-bar').map(f=>f.value/f.max*100).sort((a,b)=>a-b);if(JSON.stringify(actual)!==JSON.stringify([...expected.progressValues].sort((a,b)=>a-b)))issue('progress-values',{expected:expected.progressValues,actual});}
 if(expected.groupActions){const actionIds=new Set(actions.map(a=>a.id)),groups=tree.filter(n=>n.kind==='section'&&n.rowIds?.some(id=>actionIds.has(id)));if(groups.length!==actions.length||groups.some(n=>n.rowIds.filter(id=>actionIds.has(id)).length!==1))issue('group-actions',{expectedGroups:actions.length,actualGroups:groups.length});}
 for(const e of expected.actionLayouts??[])if(!tree.some(n=>n.kind==='section'&&n.actionLayout?.direction===e.direction&&['align','gap','buttonWidth','buttonHeight'].every(key=>e[key]===undefined||n.actionLayout[key]===e[key])))issue('action-layout',e);
 if(expected.overflow&&content.overflow!==expected.overflow)issue('overflow',{expected:expected.overflow,actual:content.overflow});
 for(const [orientation,doc]of Object.entries(documents??{})){
  for(const wanted of expected.actionLayouts??[])for(const section of tree.filter(n=>n.kind==='section'&&n.actionLayout?.direction===wanted.direction)){
   for(const id of section.rowIds){const node=doc.nodes.find(n=>n.id===id);for(const [key,dimension]of [['buttonWidth','width'],['buttonHeight','height']])if(wanted[key]!==undefined&&(!node||Math.abs(node.size[dimension]-wanted[key])>.6))issue('compiled-button-size',{orientation,id,dimension,expected:wanted[key],actual:node?.size[dimension]});}
  }
  if(expected.maxHeight!==undefined){const outer=doc.nodes.find(n=>['surface','settings'].includes(n.id));if(!outer||outer.size.height>expected.maxHeight+.6)issue('panel-max-height',{orientation,maximum:expected.maxHeight,actual:outer?.size.height});}
  if(expected.width!==undefined){const outer=doc.nodes.find(n=>['surface','settings'].includes(n.id));if(!outer||Math.abs(outer.size.width-expected.width)>.6)issue('panel-width',{orientation,expected:expected.width,actual:outer?.size.width});}
 }
 if(expected.inventory){for(const key of ['columns','rows','selectedSlot'])if(expected.inventory[key]!==undefined&&content[key]!==expected.inventory[key])issue('inventory-value',{key,expected:expected.inventory[key],actual:content[key]});if(expected.inventory.items&&JSON.stringify(content.items)!==JSON.stringify(expected.inventory.items))issue('inventory-items',{expected:expected.inventory.items,actual:content.items});}
 return issues;
}
