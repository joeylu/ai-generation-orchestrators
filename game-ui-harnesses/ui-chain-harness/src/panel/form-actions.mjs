const valueTypes=new Set(['input','check-box','switch','slider','select']);
const verbs={提交:'submit',保存:'submit',重置:'reset-initial',恢复:'reset-initial'};
const fail=(code,detail)=>{throw Object.assign(Error(code),{code,detail});};
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(v=>b.includes(v));
const caption=label=>String(label).trim().match(/^(提交|保存|重置|恢复)(全部|所有)?(?:表单|资料|数据|设置|字段|值|信息)?(?:按钮)?$/);

// Keep each instruction attached to its own verb. In particular, a sentence
// about what happens *after* submitting cannot turn the Submit button into Emit.
function instructions(text){
 const out=[];
 for(const clause of text.split(/[，,。；;：\n]/)){
  const matches=[...clause.matchAll(/提交|保存|重置|恢复/g)];
  for(let i=0;i<matches.length;i++){
   const m=matches[i],start=m.index+m[0].length;
   let end=matches[i+1]?.index??clause.length,tail=clause.slice(start,end).trim();
   if(/^(?:后|之后|前|之前|完成后|成功后)/.test(tail))continue;
   // “保存按钮只提交昵称” describes one Save action, not two buttons.
   if(matches[i+1]&&verbs[m[0]]===verbs[matches[i+1][0]]&&/^(?:按钮)?(?:时)?(?:只|仅)(?:允许)?$/.test(tail)){
    i++;end=matches[i+1]?.index??clause.length;tail=clause.slice(matches[i].index+matches[i][0].length,end).trim();
   }
   out.push({verb:m[0],kind:verbs[m[0]],tail,prefix:clause.slice(0,m.index)});
  }
 }
 return out;
}

function namedScope(tail,fields){
 let rest=tail.replace(/^(?:按钮)?(?:时)?(?:只|仅)?(?:允许|包含)?(?:指定的?|选定的?)?/,'').trim();
 const ids=[];
 for(const field of [...fields].sort((a,b)=>b.label.length-a.label.length)){
  if(!field.label||!rest.includes(field.label))continue;
  if(fields.filter(other=>other.label===field.label).length!==1)return null;
  if(rest.split(field.label).length!==2)return null;
  ids.push(field.id);rest=rest.replace(field.label,'');
 }
 rest=rest.replace(/(?:的值|字段|的字段)$/,'').replace(/[和及与、\s+&]/g,'');
 return ids.length&&!rest?ids:null;
}

function groupScope(body,actionId,all){
 if(!body)return null;
 const visit=node=>{
  if(node.kind==='section')return {hasAction:node.rowIds.includes(actionId),values:node.rowIds.filter(id=>all.includes(id)),scope:null};
  const children=node.children.map(visit),owner=children.find(c=>c.hasAction),values=children.flatMap(c=>c.values);
  return {hasAction:!!owner,values,scope:owner?(owner.scope??(owner.values.length?owner.values:node!==body&&node.kind==='column'?values:null)):null};
 };
 const root=visit(body);return root.hasAction?(root.scope??(body.kind==='section'?root.values:null)):null;
}

export function validateFormActionPolicy(policy){
 if(policy===undefined)return;
 if(!policy||policy.version!=='1.0'||policy.defaultScope!=='all-value-rows'||Object.keys(policy).some(k=>!['version','defaultScope'].includes(k)))fail('panel.action-form-policy');
}

// Validate the declared intent; never fill in targets or rewrite its actions.
export function validateFormActions({policy,request='',fields,actions,layoutBody}){
 validateFormActionPolicy(policy);if(!policy)return;
 const values=fields.filter(f=>valueTypes.has(f.type)),all=values.map(f=>f.id);if(!all.length)return;
 const mentions=instructions(String(request));
 for(const action of actions){
  const name=caption(action.label);if(!name)continue;
  const wanted=verbs[name[1]],explicitAll=!!name[2];
  let selected=mentions.filter(m=>m.verb===name[1]);
  if(!selected.length&&actions.filter(a=>verbs[caption(a.label)?.[1]]===wanted).length===1)selected=mentions.filter(m=>m.kind===wanted);
  const dataFree=m=>/^(?:按钮)?(?:时)?(?:只|仅)?(?:发出|触发)(?:一个)?(?:不带|不包含)(?:任何)?(?:数据|字段|值)的?(?:本地)?事件[。\s]*$/.test(m.tail)||/^(?:按钮)?\s*action\s*[:=]\s*emit\s*$/i.test(m.tail);
  if(!explicitAll&&selected.length&&selected.every(dataFree)){
   if(action.action!=='emit'||action.targets.length)fail('panel.action-form-scope',{id:action.id,label:action.label,expectedAction:'emit'});
   continue;
  }
  if(action.action!==wanted)fail('panel.action-form-scope',{id:action.id,label:action.label,expectedAction:wanted,actualAction:action.action});
  const scopes=explicitAll?[all]:selected.map(m=>{
   const grouped=/(?:每组|各组|各自|分别|本组|当前组)/.test(m.prefix+m.tail),owner=grouped?groupScope(layoutBody,action.id,all):null;
   if(grouped&&!owner?.length)fail('panel.action-form-scope',{id:action.id,label:action.label,reason:'group-owner-ambiguous'});
   const named=namedScope(m.tail,grouped?values.filter(f=>owner.includes(f.id)):values);if(named)return named;
   if(grouped)return owner;
   // An unnamed “specified fields” request does not authorize arbitrary targets.
   return all;
  });
  const expected=scopes[0]??all;
  if(scopes.some(scope=>!sameSet(scope,expected))||!sameSet(action.targets,expected))fail('panel.action-form-scope',{id:action.id,label:action.label,expectedTargets:expected,actualTargets:action.targets});
 }
}
