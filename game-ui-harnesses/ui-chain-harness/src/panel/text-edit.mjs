// Display-copy policy only. Document/layout validation stays in size-edit.mjs,
// so the browser and save gate share this allowlist without an import cycle.
import {supportsNodeTextStyle,assertTextStyle,surfaceTextMetrics,isTextColor} from '../runtime/text-style.mjs';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const scalarFields={Text:['text','文字内容',true],Panel:['title','面板标题',false],Dialog:['title','弹窗标题',false],Button:['label','按钮文案',false],Switch:['label','开关文案',false],CheckBox:['label','勾选框文案',false],Input:['placeholder','输入提示',false],Select:['placeholder','选择提示',false]};
const collectionFields={Select:['options','选项'],RadioGroup:['options','选项'],Tabs:['tabs','页签'],List:['items','条目'],Dialog:['actions','操作按钮']};

function typeOf(node,ctx){
  const recipe=ctx?.registry?.recipes.find(recipe=>`${recipe.recipeId}@${recipe.recipeVersion}`===node?.recipeRef);
  if(!recipe)fail('edit.text-context','缺少有效的节点配方，不能读取文案字段。');
  return recipe.type;
}
function fields(node,ctx){
  const type=typeOf(node,ctx),result=[],scalar=scalarFields[type],collection=collectionFields[type];
  if(scalar){const [id,label,multiline]=scalar;result.push({id,label,value:node.props[id]??'',multiline,maxLength:type==='Text'?32768:4096});}
  // Explicit List rows draw their child controls; changing this data label has
  // no visible effect. Those rows must edit their actual Button/Text children.
  if(collection&&!(type==='List'&&(node.slots.items??[]).length)){
    const [property,label]=collection;
    for(const [index,item]of (node.props[property]??[]).entries())result.push({id:`${property}.${index}.label`,label:`${label} ${index+1} 文案`,value:item.label??'',multiline:false,maxLength:4096});
  }
  return result;
}
function target(input,idOrContext,context){
  if(input?.kind!=='ui_panel_document')return {node:input,ctx:idOrContext,locked:!!input?.locked};
  const node=input.nodes.find(node=>node.id===idOrContext);
  if(!node)fail('edit.node','节点不存在。');
  const parents=new Map();for(const owner of input.nodes)for(const id of Object.values(owner.slots).flat())parents.set(id,owner);
  let isLocked=false;const visited=new Set();
  for(let current=node;current&&!visited.has(current.id);current=parents.get(current.id)){visited.add(current.id);if(current.locked){isLocked=true;break;}}
  return {node,ctx:context,locked:isLocked};
}

export function textEditFields(documentOrNode,nodeIdOrContext,context){
  const value=target(documentOrNode,nodeIdOrContext,context);
  return value.locked?[]:fields(value.node,value.ctx);
}

export function textStyleEditState(documentOrNode,nodeIdOrContext,context,options={}){
  const value=target(documentOrNode,nodeIdOrContext,context),type=typeOf(value.node,value.ctx),supported=supportsNodeTextStyle(type,value.node),props=value.node.props;
  const metrics=surfaceTextMetrics(value.ctx.profile,props,value.node.surfaceFontSize),fallback=options.defaultTextColor;
  return {supported,editable:supported&&!value.locked,fontSize:metrics.fontSize,fontSizeOverride:props.fontSize??null,textColor:props.textColor??(isTextColor(fallback)?fallback:value.ctx.profile.palette.text),textColorOverride:props.textColor??null,isAutomaticColor:props.textColor===undefined};
}

// Strip exactly the drawn strings; retain collection identity, ordering, count,
// selection, enabled flags, validators, initial values and action semantics.
export function nonTextProps(node,ctx){
  const props=structuredClone(node.props);
  if(supportsNodeTextStyle(typeOf(node,ctx),node)){delete props.fontSize;delete props.textColor;}
  for(const field of fields(node,ctx)){
    const parts=field.id.split('.');
    if(parts.length===1)delete props[field.id];
    else delete props[parts[0]][Number(parts[1])].label;
  }
  return props;
}

export function applyTextChanges(node,changes,ctx){
  if(node.locked)fail('edit.locked','节点已锁定。');
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||![Object.prototype,null].includes(Object.getPrototypeOf(changes)))fail('edit.text-field','文案修改必须是字段与纯文本字符串的对应表。');
  const available=new Map(fields(node,ctx).map(field=>[field.id,field])),next=structuredClone(node);
  for(const [id,value]of Object.entries(changes)){
    if(id==='fontSize'||id==='textColor'){
      if(!supportsNodeTextStyle(typeOf(node,ctx),node))fail('edit.text-style','该组件没有独立绘制的可编辑文字样式，请选择实际绘制文字的子控件。');
      if(value===null)delete next.props[id];
      else {assertTextStyle({[id]:value});next.props[id]=value;}
      continue;
    }
    const field=available.get(id);
    if(!field)fail('edit.text-field','该字段不是可编辑的显示文案，请选择实际绘制文字的子控件。');
    if(typeof value!=='string')fail('edit.text-value','文案必须是纯文本字符串。');
    if(value!==field.value&&value.length>field.maxLength)fail('edit.text-limit',`文案超过编辑上限 ${field.maxLength} 个 UTF-16 字符。`);
    const parts=id.split('.');
    if(parts.length===1)next.props[id]=value;
    else next.props[parts[0]][Number(parts[1])].label=value;
  }
  return next;
}
