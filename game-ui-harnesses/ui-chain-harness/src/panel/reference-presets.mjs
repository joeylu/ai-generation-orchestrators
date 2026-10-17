// One read-only bridge to ui-reference's selected SDK suite. No copied catalog.
import {templateList,templateInput} from '../../../ui-reference-harness/web/template-previews.mjs';
import {json,hash} from '../skins/package.mjs';

export function referencePreset(id){
 const meta=templateList.find(p=>p.id===id);if(!meta)throw Error('REFERENCE_PRESET_UNKNOWN');
 const input=templateInput(id),sourceSha256=hash(json(input));
 return {...meta,input,sourceSha256};
}
export const referencePresetList=()=>templateList.map(({id,name,group,groupName,variant})=>{const e=referenceExample(id);return {id,name,group,groupName,variant,description:'预设内容：'+[e.title,...e.rows.map(r=>r.label+(r.kind==='progress'?'（'+Math.round(r.initial/r.max*100)+'%）':'')),...(id==='sdk-settings'?['关闭']:[])].join('；')+'。'};});
export function referenceSettingsPolicy(base){const p=referencePreset('sdk-settings');return {...structuredClone(base),reference:{id:p.id,sourceSha256:p.sourceSha256},shape:{switch:3,select:1}};}

export function referenceExample(id){
 const p=referencePreset(id),spec=p.input.spec;
 if(id==='sdk-settings')return {id,title:spec.title,sectionTitle:spec.title,rows:spec.sections.flatMap(s=>s.rows).filter(r=>r.kind!=='button').map(r=>{
  if(!['switch','select'].includes(r.kind))throw Error('REFERENCE_CONTROL_UNSUPPORTED');
  const state=spec.state.find(s=>s.id===r.bind),base={kind:r.kind,recipeKey:r.recipe.id+'@'+r.recipe.version,label:r.label,enabled:r.enabled};
  return r.kind==='switch'?{...base,initial:state.initial}:{...base,options:state.options.map(o=>({label:o.label,initial:o.id===state.initial}))};
 }),request:p.description};
 const nodes=[];function visit(n){nodes.push(n);for(const c of n.children??[])visit(c);}visit(spec.document.root);
 if(nodes.some(n=>!['Container','Text','Button','ProgressBar'].includes(n.type)))throw Error('REFERENCE_CONTROL_UNSUPPORTED');
 const title=nodes.find(n=>n.id.endsWith('.title'))?.props.text??spec.title,rows=[];
 const text=(label,value)=>rows.push({kind:'text',recipeKey:'settings.text@0.1.0',label,text:value,wrap:'word'});
 for(const n of nodes){
  if(n.type==='Text'&&!n.id.endsWith('.title')&&!n.id.endsWith('.percentage')){
   if(n.id.endsWith('.label')){const value=nodes.find(v=>v.id===n.id.replace(/\.label$/,'.value'));if(value){text(n.props.text,value.props.text);continue;}}
   if(n.id.endsWith('.value')&&nodes.some(v=>v.id===n.id.replace(/\.value$/,'.label')))continue;
   text(n.props.text,n.props.text);
  }
  if(n.type==='ProgressBar')rows.push({kind:'progress',recipeKey:'settings.progress@0.1.0',label:'加载进度',max:n.props.max,initial:n.props.value,display:'percent',fractionDigits:0});
 }
 for(const n of nodes.filter(n=>n.type==='Button'))rows.push({kind:'button',recipeKey:'settings.button.'+(n.id.endsWith('.back')||n.id.endsWith('.menu')?'secondary':'primary')+'@0.1.0',label:n.props.label,enabled:n.props.enabled,action:'emit',resetRows:[],submitRows:[]});
 return {id,presetId:id,title,sectionTitle:title,rows,request:'所选状态：'+p.name+'。几何由消费端横竖版排版提供。'};
}

export function referenceRequest(id,text){
 const p=referencePreset(id),example=referenceExample(id);
 return {source:{id,sourceSha256:p.sourceSha256},text:'选用 ui-reference 预设：'+p.name+'。\n以下是用户选定的预设默认内容；未补充的内容沿用明确示例值，不代表真实游戏数据。只生成静态界面和本地交互，不执行游戏业务。保持该状态的控件种类与数量，补充需求可修改文案和初始值；结构冲突须澄清。'+(id==='sdk-settings'?'关闭按钮由消费端固定提供，不在意图 rows 内重复输出；使用一个 section，包含三个 switch 和一个 select。':'使用一个 section；标题单独输出，不重复为 text row。所有按钮排在内容行后。')+'\n预设内容：\n'+json(example)+'\n用户补充：\n'+(text.trim()||'无，使用预设默认内容。')};
}

export function referenceActionConfig(base,id){
 const p=referencePreset(id),e=referenceExample(id);if(id==='sdk-settings')throw Error('REFERENCE_SETTINGS_ADAPTER');
 const fields=e.rows.filter(r=>r.kind!=='button'),actions=e.rows.filter(r=>r.kind==='button'),shape={};for(const r of e.rows)shape[r.kind]=(shape[r.kind]??0)+1;
 const surface=p.input.spec.document.root.children[0].layout;
 return {...structuredClone(base),reference:{id,sourceSha256:p.sourceSha256},geometry:{...base.geometry,textHeight:32,progressHeight:36},recipes:{...base.recipes,'settings.progress@0.1.0':{kind:'progress',recipe:'progress-bar'}},presets:{[id]:{surface:'panel',minFields:fields.length,maxFields:fields.length,minActions:actions.length,maxActions:actions.length,kinds:Object.keys(shape),shape,dismissOnEmit:false,landscape:{width:surface.width,height:surface.height},portrait:{width:Math.min(600,surface.width),height:surface.height}}}};
}
