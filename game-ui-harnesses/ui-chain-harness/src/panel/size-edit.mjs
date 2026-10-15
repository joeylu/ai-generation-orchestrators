import {validateDocument,indexDocument,fail} from './document.mjs';
import {documentLayout} from './layout.mjs';
import {recipeRef} from '../contracts/props.mjs';
import {pngGeometry} from '../runtime/png-geometry.mjs';
import {scrollPadding} from '../runtime/scroll-geometry.mjs';
import {tabsContentBox} from '../runtime/tabs-geometry.mjs';
import {applyTextChanges,nonTextProps,textEditFields} from './text-edit.mjs';
import {textProfile,supportsTextStyle} from '../runtime/text-style.mjs';
import {surfaceTextBox} from '../skins/surface-styles.mjs';
import {inventoryLayout} from '../runtime/inventory-geometry.mjs';
export {textEditFields,textStyleEditState} from './text-edit.mjs';

const axes=['width','height'], near=(a,b)=>Math.abs(a-b)<.1;
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b)=>stable(a)===stable(b);
const mode=(n,axis)=>n.sizing?.[axis+'Mode']??'fixed';
const mainAxis=n=>n.layout?.direction==='row'?'width':'height';

function geometry(doc,ctx){
  const index=indexDocument(doc),recipes=new Map(doc.nodes.map(n=>[n.id,ctx.registry.recipes.find(r=>recipeRef(r)===n.recipeRef)]));
  // Add only an equivalent default on a calculation copy so legacy fixed-flow
  // trees also pass through the shared solver and expose local coordinates.
  const calculation=new Map([...index.nodes].map(([id,n])=>[id,recipes.get(id).type==='Container'?{...n,layout:{...n.layout,justify:n.layout?.justify??'flex-start'}}:n]));
  const resolved=documentLayout(calculation,recipes,index.parents,ctx.profile);
  return {...index,recipes,resolved,type:n=>recipes.get(n.id).type,size:n=>resolved.get(n.id)??n.size};
}

function skinFor(ctx){
  if(ctx.binding.sourceKind!=='imported')return null;
  if(!ctx.skinGeometry)fail('edit.skin-geometry','当前皮肤缺少经过核验的尺寸与安全区证据，不能调整尺寸。');
  return pngGeometry(ctx.skinGeometry,ctx.profile);
}

const tabsInsets=(ctx,skin)=>skin?(skin.roles.has('skin.surface.content')?skin.insets('skin.surface.content'):null):ctx.scrollInsets??{left:ctx.profile.padding,right:ctx.profile.padding,top:0,bottom:0};

function slotBox(node,size,type,ctx,skin){
  const p=node.props,s=textProfile(ctx.profile,p),g=s.geometry;
  if(type==='Panel'||type==='Dialog'){
    const pad=type==='Panel'?(p.contentPadding??skin?.insets('skin.surface.panel')??{left:s.padding,right:s.padding,top:s.padding,bottom:s.padding}):{left:s.padding,right:s.padding,top:s.padding,bottom:s.padding};
    return {width:size.width-pad.left-pad.right,height:size.height-pad.top-pad.bottom-(p.title?g.lineHeight+g.titleGap:0)-(type==='Dialog'&&p.actions.length?s.itemHeight+g.labelGap:0)};
  }
  if(type==='ScrollView'){
    const pad=scrollPadding(s,skin?.insets('skin.surface.content')??ctx.scrollInsets??{left:0,right:0,top:0,bottom:0});
    return {width:size.width-pad.left-pad.right-g.scrollbarWidth-g.scrollbarGap,height:size.height-pad.top-pad.bottom};
  }
  if(type==='Tabs')return tabsContentBox(s,tabsInsets(ctx,skin),size.width,size.height);
  return size;
}

function locked(node,info){
  for(let n=node;n;n=info.parents.get(n.id)?.node)if(n.locked)return true;
  return false;
}

function freeLayoutReason(node,doc,info){
  if(node.id===doc.rootId)return '画布根布局固定。';
  if(info.type(node)!=='Container')return '只有布局分组可切换为自由布局。';
  if(node.layout?.childrenMode==='free')return '当前分组已是自由布局。';
  if(locked(node,info))return '节点或父级已锁定。';
  const children=(node.slots.children??[]).map(id=>info.nodes.get(id));
  if(!children.length)return '空分组没有可冻结的子项。';
  if(children.some(child=>locked(child,info)))return '分组中有已锁定的直接子项。';
  if(children.some(child=>child.props.visible===false))return '分组有隐藏的直接子项，缺少可冻结的当前坐标。';
  return undefined;
}

function freeLayout(layout={}){
  const next={...layout,childrenMode:'free'};
  if(next.direction==='grid'){next.direction='column';for(const key of ['columns','cellWidth','cellHeight'])delete next[key];}
  return next;
}

// The actual dimensions come from the same Yoga calculation as the renderer.
// Fixed grid cells intentionally expose the shared parent, rather than accepting
// a child dimension which the runtime would ignore.
export function sizeEditTargets(input,ctx){
  const doc=validateDocument(input,ctx),info=geometry(doc,ctx);
  return doc.nodes.map(n=>{
    const owner=info.parents.get(n.id)?.node,isGrid=owner&&info.type(owner)==='Container'&&owner.layout?.direction==='grid';
    const reason=n.id===doc.rootId?'画布比例与尺寸已固定。':locked(n,info)?'节点或父级已锁定。':isGrid?'此节点由统一网格单元格控制，请调整上级容器。':undefined;
    const size=info.size(n),position=info.resolved.get(n.id)??n.position??{x:0,y:0};
    const positionReason=n.id===doc.rootId?'画布不能移动。':locked(n,info)?'节点或父级已锁定。':n.props.visible===false?'隐藏节点不能在画布移动。':!owner||info.type(owner)!=='Container'?'内容槽的位置由所属控件管理。':owner.layout?.childrenMode!=='free'?'自动排版中的位置由分组控制；先显式将上级分组切换为自由布局。':undefined;
    const freeReason=freeLayoutReason(n,doc,info);
    return {id:n.id,name:n.name,type:info.type(n),width:size.width,height:size.height,x:position.x??0,y:position.y??0,editableWidth:!reason,editableHeight:!reason,...(reason?{reason}:{}),editablePosition:!positionReason,...(positionReason?{positionReason}:{}),canFreeLayout:!freeReason,...(freeReason?{freeLayoutReason:freeReason}:{}),...(owner?{parentId:owner.id}:{})};
  });
}

function assertTextCapacity(node,type,size,ctx,skin,changedFields=null){
  const p=node.props,s=textProfile(ctx.profile,p),g=s.geometry,line=Math.max(g.lineHeight,Math.ceil(s.fontSize*1.2));
  const changed=id=>!changedFields||changedFields.has(id);
  const width=text=>[...String(text??'')].reduce((sum,c)=>sum+s.fontSize*(c===' '?.6:1.1),0);
  const check=(text,w,h,wrap=false)=>{
    if(!text)return;
    const lines=String(text).split(/\r\n|\r|\n/).reduce((sum,part)=>sum+(wrap?Math.max(1,Math.ceil(width(part)/Math.max(1,w-s.fontSize))):1),0);
    if(w<1||h<line*lines-.1||(!wrap&&String(text).split(/\r\n|\r|\n/).some(part=>width(part)>w+.1)))
      fail('edit.text-capacity','调整后的尺寸无法容纳现有文字。请扩大控件或其面板。',node.id);
  };
  const pad=role=>skin?.insets(role)??{left:s.padding,right:s.padding,top:0,bottom:0};
  if(type==='Text'&&changed('text')){const box=node.surfaceStyle?surfaceTextBox(ctx.skinGeometry,node.surfaceStyle,size.width,size.height):size;check(p.text,box.width,box.height,p.wrap==='word');}
  if(type==='Button'&&changed('label'))for(const state of ['normal','pressed']){const a=pad(`skin.button.${p.variant}.${state}`);check(p.label,size.width-a.left-a.right,size.height-a.top-a.bottom);}
  if((type==='Switch'||type==='CheckBox')&&changed('label'))check(p.label,size.width-(type==='Switch'?s.markSize*2:s.markSize)-g.labelGap,size.height);
  if(type==='Input'||type==='Select'){
    const a=pad('skin.field.normal'),w=size.width-a.left-a.right-(type==='Select'?g.indicatorWidth+g.labelGap:0);
    // Native text entry can scroll horizontally; its placeholder and visible
    // options still need a readable content area. Do not rewrite user values.
    if(changed('placeholder'))check(p.placeholder,w,size.height-a.top-a.bottom);
    if(type==='Select')for(const [index,option]of p.options.entries())if(changed(`options.${index}.label`)){
      check(option.label,w,size.height-a.top-a.bottom);
      for(const state of ['normal','selected']){const b=pad(`skin.item.${state}`);check(option.label,size.width-b.left-b.right,s.itemHeight-b.top-b.bottom);}
    }
  }
  if(type==='Panel'||type==='Dialog'){
    const box=slotBox(node,size,type,ctx,skin);if(changed('title'))check(p.title,box.width,g.lineHeight);
    if(type==='Dialog')for(const [index,action]of p.actions.entries())if(changed(`actions.${index}.label`)){
      const w=(size.width-s.padding*2-Math.max(0,p.actions.length-1)*g.labelGap)/Math.max(1,p.actions.length);
      for(const state of ['normal','pressed']){const a=pad(`skin.button.${action.variant}.${state}`);check(action.label,w-a.left-a.right,s.itemHeight-a.top-a.bottom);}
    }
  }
  if((type==='Slider'||type==='ProgressBar')&&p.showValue)check('100%',size.width,g.lineHeight);
  if(type==='Tabs'){
    const box=tabsContentBox(s,tabsInsets(ctx,skin),size.width,size.height);
    const w=(box.surface.width-Math.max(0,p.tabs.length-1)*g.tabGap)/Math.max(1,p.tabs.length);
    for(const [index,tab]of p.tabs.entries())if(changed(`tabs.${index}.label`))for(const state of ['normal','selected']){const a=pad(`skin.tab.${state}`);check(tab.label,w-a.left-a.right,s.itemHeight-a.top-a.bottom);}
  }
  if(type==='List'&&!(node.slots.items??[]).length){
    if(p.inventory){
      const box=inventoryLayout(ctx.profile,p,size.width,size.height,ctx.skinGeometry).detailName;
      // Inventory names wrap in a vertically scrollable detail region. They
      // are not labels squeezed into the item cell or the old List row height.
      for(const [index,item]of p.items.entries())if(changed(`items.${index}.label`))check(item.label,box.width,1e9,true);
    }else for(const [index,item]of p.items.entries())if(changed(`items.${index}.label`))for(const state of ['normal','selected']){const a=pad(`skin.item.${state}`);check(item.label,size.width-a.left-a.right,s.itemHeight-a.top-a.bottom);}
  }
  if(type==='RadioGroup')for(const [index,option]of p.options.entries())if(changed(`options.${index}.label`))check(option.label,(p.direction==='row'?size.width/Math.max(1,p.options.length):size.width)-s.markSize-g.labelGap,p.direction==='row'?size.height:Math.max(s.markSize,g.lineHeight));
}

function assertGeometry(doc,ctx,base){
  const skin=skinFor(ctx),info=geometry(doc,ctx),old=base?geometry(base,ctx):null;
  for(const n of doc.nodes){
    const type=info.type(n),size=info.size(n),before=old?.nodes.get(n.id),previous=before?old.size(before):null;
    try{skin?.assertComponent(type,n.props,size.width,size.height);}catch(e){e.message=n.id+': '+e.message;throw e;}
    if(previous){
      const shrunk=size.width<previous.width-.1||size.height<previous.height-.1,fontChanged=n.props.fontSize!==before.props.fontSize;
      const original=new Map(textEditFields({...before,locked:false},ctx).map(field=>[field.id,field.value]));
      const changedFields=new Set(textEditFields({...n,locked:false},ctx).filter(field=>field.value!==original.get(field.id)).map(field=>field.id));
      if(shrunk||fontChanged||changedFields.size)assertTextCapacity(n,type,size,ctx,skin,shrunk||fontChanged?null:changedFields);
    }
    if(['Panel','Dialog','ScrollView','Tabs','List'].includes(type)){
      const box=slotBox(n,size,type,ctx,skin),ids=Object.values(n.slots).flat();
      for(const id of ids){const child=info.nodes.get(id),r=info.size(child);
        if(r.width>box.width+.1||(!['ScrollView','Dialog','List'].includes(type)&&r.height>box.height+.1))fail('edit.slot-bounds','内容超过控件的安全内容区，请先缩小内部内容或扩大面板。',id);
      }
    }
  }
  return info;
}

// This is also the server-side save gate. A submitted copy may change a
// rectangle, explicitly freeze one flow group, or replace automatic sizing with
// fixed. Only listed display strings and node-local font/color may change in
// props; ownership, behavior, resources and unrelated layout rules stay bound.
export function validateSizeEdit(baseInput,candidateInput,ctx){
  const base=validateDocument(baseInput,ctx),candidate=validateDocument(candidateInput,ctx),info=geometry(base,ctx);
  const nextInfo=indexDocument(candidate),converted=new Set();
  for(let i=0;i<base.nodes.length;i++){
    const a=base.nodes[i],b=candidate.nodes[i];
    if(b&&a.id===b.id&&a.layout?.childrenMode!=='free'&&b.layout?.childrenMode==='free'){
      const reason=freeLayoutReason(a,base,info);
      if(reason)fail('edit.free-layout',reason,a.id);
      if(!equal(freeLayout(a.layout),b.layout))fail('edit.layout-only','切换自由布局只能冻结现有排版，不能修改其他布局规则。',a.id);
      converted.add(a.id);
    }
  }
  const stripDoc=d=>Object.fromEntries(Object.entries(d).filter(([k])=>!['revision','version','nodes'].includes(k)));
  if(!equal(stripDoc(base),stripDoc(candidate))||base.nodes.length!==candidate.nodes.length||(![base.version,'0.3'].includes(candidate.version)))fail('edit.size-only','编辑副本不能修改行为、素材或文档结构。');
  for(let i=0;i<base.nodes.length;i++){
    const a=base.nodes[i],b=candidate.nodes[i],parent=info.parents.get(a.id)?.node,newParent=nextInfo.parents.get(b.id)?.node;
    const canMove=newParent&&info.recipes.get(newParent.id)?.type==='Container'&&newParent.layout?.childrenMode==='free';
    const strip=n=>Object.fromEntries(Object.entries(n).filter(([k])=>!['size','sizing',...(canMove?['position']:[]),...(converted.has(a.id)?['layout']:[])].includes(k)).map(([key,value])=>[key,key==='props'?nonTextProps(n,ctx):value]));
    if(!equal(strip(a),strip(b)))fail('edit.size-only','编辑副本只能修改列出的显示文案、字号颜色及允许的几何字段。',a.id);
    // The save route must enforce the same changed-string limits as the UI.
    const originals=new Map(textEditFields({...a,locked:false},ctx).map(field=>[field.id,field.value]));
    const copyChanges=Object.fromEntries(textEditFields({...b,locked:false},ctx).filter(field=>field.value!==originals.get(field.id)).map(field=>[field.id,field.value]));
    if(supportsTextStyle(info.type(a)))for(const field of ['fontSize','textColor'])if(a.props[field]!==b.props[field])copyChanges[field]=b.props[field]??null;
    if(Object.keys(copyChanges).length)applyTextChanges({...a,locked:false},copyChanges,ctx);
    const original=a.sizing??{},next=b.sizing??{},parentConverted=converted.has(parent?.id),allowed=['widthMode','heightMode','grow','shrink',...(parentConverted?['alignSelf']:[])];
    const without=s=>Object.fromEntries(Object.entries(s).filter(([k])=>!allowed.includes(k)));
    if(!equal(without(original),without(next)))fail('edit.size-only','尺寸编辑必须保留原有最小/最大尺寸与对齐约束。',a.id);
    for(const axis of axes)if(mode(a,axis)!==mode(b,axis)&&mode(b,axis)!=='fixed')fail('edit.size-only','尺寸编辑只允许将自动尺寸明确改为固定尺寸。',a.id);
    for(const key of ['grow','shrink'])if(next[key]!==undefined&&next[key]!==original[key])fail('edit.size-only','尺寸编辑不能新增或改变弹性权重。',a.id);
    if(parentConverted&&next.alignSelf!==undefined)fail('edit.free-layout','自由布局直接子项不能保留单项对齐规则。',a.id);
    if(converted.has(a.id)||parentConverted){
      if(axes.some(axis=>mode(b,axis)!=='fixed')||next.grow||next.shrink)fail('edit.free-layout','自由布局转换必须冻结当前尺寸并移除弹性分配。',a.id);
    }
    if(!equal(a,b)&&locked(a,info))fail('edit.locked','节点或父级已锁定。',a.id);
    if(a.props.visible===false&&!equal(a.position,b.position))fail('edit.position-unavailable','隐藏节点不能在画布移动。',a.id);
    if(parent?.layout?.direction==='grid'&&!parentConverted&&(!equal(a.size,b.size)||!equal(a.sizing,b.sizing)))fail('edit.grid-size','统一网格直接子项的尺寸由网格控制，请调整其容器。',a.id);
  }
  const actual=assertGeometry(candidate,ctx,base);
  for(const n of candidate.nodes){const previous=info.nodes.get(n.id);for(const axis of axes){
    if(!near(n.size[axis],previous.size[axis])||mode(n,axis)!==mode(previous,axis)){
      if(mode(n,axis)!=='fixed'||!near(actual.size(n)[axis],n.size[axis]))fail('edit.size-managed','请求尺寸仍受自动布局控制，无法按该数值应用。',n.id);
    }
  }}
  return candidate;
}

// A resize is a pure candidate transaction. The caller publishes it only after
// preparing the complete Pixi renderer; failed layout or skin checks leave the
// original document and history untouched.
export function rectangleEditDocument(input,edit,ctx){
  if(ctx.binding?.sourceKind==='imported'&&!ctx.skinGeometry)skinFor(ctx);
  const base=validateDocument(input,ctx),doc=structuredClone(base),before=geometry(base,ctx),skin=skinFor(ctx),index=indexDocument(doc),node=index.nodes.get(edit.nodeId);
  if(!node)fail('edit.node','节点不存在。');
  const target=sizeEditTargets(base,ctx).find(n=>n.id===edit.nodeId);
  const changed=axes.filter(axis=>edit[axis]!==undefined&&!near(edit[axis],before.size(before.nodes.get(node.id))[axis]));
  const moving=edit.x!==undefined||edit.y!==undefined;
  if(changed.length&&(!target.editableWidth||!target.editableHeight))fail('edit.size-unavailable',target.reason,node.id);
  if(moving&&!target.editablePosition)fail('edit.position-unavailable',target.positionReason,node.id);
  if(!changed.length&&!moving)return base;
  for(const axis of changed){
    const value=edit[axis];if(!Number.isFinite(value)||value<24||value>16384)fail('edit.size','尺寸须为 24–16384 之间的逻辑像素。',node.id);
    node.size[axis]=value;
    if(mode(node,axis)!=='fixed')node.sizing={...node.sizing,[axis+'Mode']:'fixed'};
    if(mainAxis(index.parents.get(node.id)?.node??{})===axis&&node.sizing){delete node.sizing.grow;delete node.sizing.shrink;}
  }
  const oldSize=n=>before.size(before.nodes.get(n.id)),oldType=n=>before.type(before.nodes.get(n.id));
  // Legacy generated documents used fixed dimensions for full-width children.
  // Follow that exact old fit, while leaving independently authored sizes alone.
  function reflow(n,nextSize){
    const previous=oldSize(n),type=oldType(n);
    if(type==='Container'){
      const l=n.layout??{},pad=l.padding??0,ids=n.slots.children??[],children=ids.map(id=>index.nodes.get(id));
      const flow=l.childrenMode!=='free',main=mainAxis(n);
      for(const axis of axes){
        const delta=nextSize[axis]-previous[axis];if(near(delta,0))continue;
        for(const child of children){
          if(child.id===node.id&&changed.includes(axis))continue;
          if(flow&&l.direction!=='grid'&&mode(child,axis)==='fixed'&&near(oldSize(child)[axis],previous[axis]-pad*2))child.size[axis]=Math.max(24,nextSize[axis]-pad*2);
        }
        // A viewport occupies the remaining column/row extent. Other controls
        // keep their authored height instead of being scaled with the surface.
        if(flow&&axis===main){
          const flexible=children.filter(c=>['ScrollView','Tabs'].includes(oldType(c))&&mode(c,axis)==='fixed');
          if(flexible.length===1&&flexible[0].id!==node.id){const c=flexible[0];c.size[axis]=oldSize(c)[axis]+delta;}
        }
      }
      const active=children.filter(c=>c.props.visible!==false),mainFill=active.filter(c=>mode(c,main)==='fill');
      const gap=l.gap??8,available=nextSize[main]-pad*2-gap*Math.max(0,active.length-1)-active.filter(c=>mode(c,main)!=='fill').reduce((sum,c)=>sum+c.size[main],0);
      const totalWeight=mainFill.reduce((sum,c)=>sum+(c.sizing?.grow??1),0);
      for(const child of children){
        const size={...oldSize(child)};
        for(const axis of axes){
          if(mode(child,axis)==='fixed')size[axis]=child.size[axis];
          else if(mode(child,axis)==='fill'&&flow){size[axis]=axis===main?available*(child.sizing?.grow??1)/Math.max(.001,totalWeight):nextSize[axis]-pad*2;const suffix=axis==='width'?'Width':'Height';size[axis]=Math.max(child.sizing?.['min'+suffix]??24,Math.min(child.sizing?.['max'+suffix]??16384,size[axis]));}
        }
        if(l.direction==='grid'){size.width=l.cellWidth??(nextSize.width-pad*2-gap*(l.columns-1))/l.columns;size.height=l.cellHeight;}
        reflow(child,size);
      }
    }else if(['Panel','Dialog','ScrollView','Tabs'].includes(type)){
      const a=slotBox(n,previous,type,ctx,skin),b=slotBox(n,nextSize,type,ctx,skin);
      for(const id of Object.values(n.slots).flat()){
        const child=index.nodes.get(id),size={...oldSize(child)};
        for(const axis of axes){
          const fitting=near(size[axis],a[axis]);
          if(mode(child,axis)==='fixed'&&(fitting||(axis==='width'&&type==='ScrollView'))&&!(type==='ScrollView'&&axis==='height'))child.size[axis]=b[axis];
          if(mode(child,axis)==='fixed')size[axis]=child.size[axis];
        }
        reflow(child,size);
      }
    }
  }
  if(changed.length)reflow(node,{...oldSize(node),...Object.fromEntries(changed.map(a=>[a,node.size[a]]))});
  // Tight fixed row/column wrappers follow a resized child, exactly as content
  // wrappers do. The outer surface remains an explicit user decision.
  for(let parent=changed.length?index.parents.get(node.id)?.node:null;parent&&parent.id!==doc.rootId;parent=index.parents.get(parent.id)?.node){
    if(oldType(parent)!=='Container'||parent.layout?.childrenMode==='free'||parent.layout?.direction==='grid'||parent.layout?.direction==='wrap')continue;
    const children=(parent.slots.children??[]).map(id=>index.nodes.get(id)).filter(c=>c.props.visible!==false),pad=(parent.layout?.padding??0)*2,gap=(parent.layout?.gap??8)*Math.max(0,children.length-1),main=mainAxis(parent),cross=main==='width'?'height':'width';
    const oldNatural=pad+gap+children.reduce((sum,c)=>sum+oldSize(c)[main],0),newNatural=pad+gap+children.reduce((sum,c)=>sum+c.size[main],0);
    if(mode(parent,main)==='fixed'&&near(oldSize(parent)[main],oldNatural))parent.size[main]=Math.max(24,newNatural);
    if(mode(parent,cross)==='fixed'&&near(oldSize(parent)[cross],pad+Math.max(0,...children.map(c=>oldSize(c)[cross]))))parent.size[cross]=Math.max(24,pad+Math.max(0,...children.map(c=>c.size[cross])));
  }
  if(changed.length&&!moving&&!edit.keepPosition&&index.parents.get(node.id)?.node.id===doc.rootId&&['Panel','Dialog'].includes(oldType(node))){
    const board=ctx.canvases.presets[doc.canvas],old=oldSize(node);
    // Retain the numeric editor's centered default, but respect a panel that
    // the user has already moved away from the center of the fixed canvas.
    if(near(target.x,(board.width-old.width)/2)&&near(target.y,(board.height-old.height)/2))node.position={x:(board.width-node.size.width)/2,y:(board.height-node.size.height)/2};
  }
  if(moving){
    const position={x:edit.x??target.x,y:edit.y??target.y};
    if(Object.values(position).some(v=>!Number.isFinite(v)||v<0||v>16384))fail('edit.position','位置须为 0–16384 之间的逻辑像素。',node.id);
    node.position=position;
  }
  if(doc.nodes.some(n=>Object.keys(n.sizing??{}).length))doc.version='0.3';
  const candidate=validateSizeEdit(base,doc,ctx),actual=geometry(candidate,ctx).size(indexDocument(candidate).nodes.get(node.id));
  for(const axis of changed)if(!near(actual[axis],edit[axis]))fail('edit.size-managed','该轴仍受父级布局或最小/最大约束控制，无法应用请求尺寸。',node.id);
  return candidate;
}

export function sizeEditDocument(input,edit,ctx){return rectangleEditDocument(input,edit,ctx);}
export function positionEditDocument(input,edit,ctx){return rectangleEditDocument(input,{nodeId:edit.nodeId,x:edit.x,y:edit.y},ctx);}

// Pure atomic authoring candidate; the session still prepares real-font Pixi
// rendering before publication. HTML-like strings remain literal display copy.
export function textEditDocument(input,edit,ctx){
  const base=validateDocument(input,ctx),info=indexDocument(base),node=info.nodes.get(edit.nodeId);
  if(!node)fail('edit.node','节点不存在。');
  if(locked(node,info))fail('edit.locked','节点或父级已锁定。',node.id);
  const next=applyTextChanges(node,edit.changes,ctx),doc=structuredClone(base);
  doc.nodes[doc.nodes.findIndex(value=>value.id===node.id)]=next;
  return validateSizeEdit(base,doc,ctx);
}

// Explicitly release a single group's automatic arrangement. Freeze only that
// group's direct children; nested ownership and each child's own layout remain
// intact. Current solved coordinates, rather than screen pixels, are serialized.
export function freeLayoutDocument(input,edit,ctx){
  const base=validateDocument(input,ctx),info=geometry(base,ctx),original=info.nodes.get(edit.nodeId);
  if(!original)fail('edit.node','节点不存在。');
  const reason=freeLayoutReason(original,base,info);
  if(reason)fail('edit.free-layout',reason,original.id);
  const doc=structuredClone(base),index=indexDocument(doc),node=index.nodes.get(original.id);
  const freeze=n=>{
    const size=info.size(info.nodes.get(n.id));n.size={width:size.width,height:size.height};
    n.sizing={...n.sizing,widthMode:'fixed',heightMode:'fixed'};delete n.sizing.grow;delete n.sizing.shrink;
  };
  freeze(node);node.layout=freeLayout(node.layout);
  for(const id of node.slots.children??[]){
    const child=index.nodes.get(id),position=info.resolved.get(id);
    if(!position)fail('edit.free-layout','缺少当前排版坐标，不能冻结该子项。',id);
    freeze(child);delete child.sizing.alignSelf;child.position={x:position.x,y:position.y};
  }
  doc.version='0.3';
  return validateSizeEdit(base,doc,ctx);
}
