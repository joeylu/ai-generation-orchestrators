import {scrollPadding} from '../runtime/scroll-geometry.mjs';
import {tabsContentBox} from '../runtime/tabs-geometry.mjs';
import {presentation,presetHeight} from './preset-presentation.mjs';
import { validateDocument } from './document.mjs';

// Preset compilation only: content, geometry and selected skin stay independent.
export function settingsDocument(content, layout, canvas, ctx) {
  if (content.version !== '1.0' || layout.version !== '1.0' || !Array.isArray(content.fields) || !content.fields.length)
    throw Error('Unsupported settings configuration.');
  const o = layout.orientations[canvas], board = ctx.canvases.presets[canvas];
  if (!o || !board) throw Error('Unknown orientation.');
  const nodes = [], bodyWidth = o.width - layout.padding * 2, policy = presentation(layout.presentation);
  if(content.overflow!==undefined&&!['error','scroll'].includes(content.overflow))throw Error('Unsupported settings overflow');
  const scrolling=content.overflow==='scroll';
  if((scrolling||content.tabs)&&ctx.binding.sourceKind==='imported'&&!ctx.scrollInsets)throw Error('Verified scroll insets required');
  const tabBox=content.tabs?tabsContentBox(ctx.profile,ctx.scrollInsets??{left:0,right:0,top:0,bottom:0},bodyWidth,o.height):null;
  const tabPad=tabBox?.pad??{left:0,right:0,top:0,bottom:0};
  const pageWidth=bodyWidth-tabPad.left-tabPad.right;
  const pad=scrolling?scrollPadding(ctx.profile,ctx.scrollInsets??{left:0,right:0,top:0,bottom:0}):null;
  const rowWidth=scrolling?pageWidth-pad.left-pad.right-ctx.profile.geometry.scrollbarWidth-ctx.profile.geometry.scrollbarGap:pageWidth;
  const add = (id, type, props, width, height, slots = {}, extra = {}) => {
    nodes.push({ id, name: id, recipeRef: `${type}@1.0.0`, props, size: { width, height }, slots, ...extra }); return id;
  };
  const title = add('heading','text',{text:content.title,textStyleRef:'body',align:policy.titleAlign,overflow:'ellipsis'},bodyWidth,layout.titleHeight);
  const groups=content.groups;
  if(groups!==undefined){
    const ordered=Array.isArray(groups)?groups.flatMap(g=>g.fieldIds??[]):[];
    if(!Array.isArray(groups)||!groups.length||groups.some(g=>typeof g.id!=='string'||typeof g.title!=='string'||!g.title.trim()||!Array.isArray(g.fieldIds)||!g.fieldIds.length)||new Set(groups.map(g=>g.id)).size!==groups.length||JSON.stringify(ordered)!==JSON.stringify(content.fields.map(f=>f.id)))throw Object.assign(Error('Invalid settings groups'),{code:'panel.settings-groups'});
  }
  const tabs=content.tabs;
  if(tabs!==undefined){
    if(!Array.isArray(tabs)||tabs.length<2||tabs.length>8||!groups||tabs.filter(t=>t.initial===true).length!==1||tabs.some(t=>typeof t.id!=='string'||!t.id.match(/^[A-Za-z][A-Za-z0-9_.-]*$/)||typeof t.label!=='string'||!t.label.trim()||typeof t.initial!=='boolean'||!Array.isArray(t.groupIds)||!t.groupIds.length)||new Set(tabs.map(t=>t.id)).size!==tabs.length||JSON.stringify(tabs.flatMap(t=>t.groupIds))!==JSON.stringify(groups.map(g=>g.id))||typeof content.tabsEnabled!=='boolean')throw Object.assign(Error('Invalid settings tabs'),{code:'panel.settings-tabs'});
  }
  const rows = content.fields.map(f => {
    const col = o.rowDirection === 'column', labelWidth = col ? rowWidth : o.labelWidth;
    const width = col ? rowWidth : rowWidth - labelWidth - o.rowGap;
    const label = add(`${f.id}-label`,'text',{text:f.label,textStyleRef:'body',overflow:'ellipsis'},labelWidth,layout.labelHeight);
    let type, props, height;
    if (f.type === 'switch' && typeof f.value === 'boolean') { type='switch'; props={label:'',checked:f.value}; height=layout.fieldHeight; }
    else if (f.type === 'slider' && typeof f.value === 'number') { type='slider'; props={value:f.value,min:f.min,max:f.max,step:f.step,showValue:true}; height=layout.controlHeight; }
    else if (f.type === 'select') { type='select'; props={options:f.options,selectedId:f.value,placeholder:f.label,maxVisibleItems:3}; height=layout.fieldHeight; }
    else throw Error(`Unsupported setting: ${f.id}`);
    if(f.type==='slider' && ![f.min,f.max,f.step].every(Number.isFinite)) throw Error(`Missing slider range: ${f.id}`);
    props.enabled=f.enabled ?? true;
    add(f.id,type,props,width,height,{}, {sizing:{widthMode:'fill'}});
    return add(`${f.id}-row`,'container',{},rowWidth,o.rowHeight,{children:[label,f.id]}, {sizing:{widthMode:'fill'},layout:{childrenMode:'flow',direction:o.rowDirection,gap:o.rowGap,padding:0}});
  });
  const sectionRows=[],groupRows=new Map();
  if(groups){
    for(const [index,group] of groups.entries()){
      const start=sectionRows.length;
      if(tabs||groups.length>1||policy.sectionHeading==='show')sectionRows.push(add('section-heading-'+index,'text',{text:group.title,textStyleRef:'body',overflow:'ellipsis'},rowWidth,layout.labelHeight));
      sectionRows.push(...group.fieldIds.map(id=>id+'-row'));
      groupRows.set(group.id,sectionRows.slice(start));
    }
  }else{
    if(content.sectionTitle&&policy.sectionHeading==='show')sectionRows.push(add('section-heading','text',{text:content.sectionTitle,textStyleRef:'body',overflow:'ellipsis'},bodyWidth,layout.labelHeight));
    sectionRows.push(...rows);
  }
  const close=add('close','button',{label:content.closeLabel},Math.min(layout.buttonWidth,bodyWidth),layout.buttonHeight);
  const footer=add('footer','container',{},bodyWidth,layout.buttonHeight,{children:[close]},{layout:{childrenMode:'flow',direction:'column',align:'center',gap:0,padding:0}});
  const sequences=tabs?tabs.map(t=>t.groupIds.flatMap(id=>groupRows.get(id))):[sectionRows];
  const natural=ids=>ids.reduce((sum,id)=>sum+nodes.find(n=>n.id===id).size.height,0)+Math.max(0,ids.length-1)*layout.gap;
  const headerHeight=tabBox?tabBox.headerHeight+tabPad.top+tabPad.bottom:0;
  const height=presetHeight({policy:scrolling?{...policy,height:'fixed'}:policy,width:o.width,height:o.height,board,padding:layout.padding,children:scrolling?[]:[layout.titleHeight,Math.max(...sequences.map(natural))+headerHeight,layout.buttonHeight],gap:layout.gap});
  const middleHeight=height-layout.padding*2-layout.titleHeight-layout.buttonHeight-layout.gap*2;
  const pageHeight=middleHeight-headerHeight;
  let middle=sectionRows;
  if(scrolling||tabs){
    if(rowWidth<=0||pageHeight-(scrolling?pad.top+pad.bottom:0)<o.rowHeight)throw Object.assign(Error('Scroll/page viewport too small'),{code:'panel.scroll-capacity'});
    const pages=sequences.map((ids,index)=>{
      const suffix=tabs?'-'+index:'';
      const contentId=add('scroll-content'+suffix,'container',{},rowWidth,scrolling?natural(ids):pageHeight,{children:ids},{...(scrolling?{sizing:{heightMode:'content'}}:{}),layout:{childrenMode:'flow',direction:'column',gap:layout.gap,padding:0}});
      return scrolling?add('settings-scroll'+suffix,'scroll-view',{axis:'vertical',scrollbar:'auto'},pageWidth,pageHeight,{content:[contentId]}):contentId;
    });
    middle=tabs?[add('settings-tabs','tabs',{enabled:content.tabsEnabled,tabs:tabs.map((t,i)=>({id:t.id,label:t.label,contentNodeId:pages[i],enabled:true})),activeId:tabs.find(t=>t.initial).id},bodyWidth,middleHeight,{pages})]:pages;
  }
  const body=add('body','container',{},bodyWidth,height-layout.padding*2,{children:[title,...middle,footer]},{layout:{childrenMode:'flow',direction:'column',gap:layout.gap,padding:0}});
  const panel=add('settings','panel',{title:'',contentPadding:{left:layout.padding,right:layout.padding,top:layout.padding,bottom:layout.padding}},o.width,height,{content:[body]}, {position:{x:(board.width-o.width)/2,y:(board.height-height)/2}});
  add('artboard','container',{},board.width,board.height,{children:[panel]},{layout:{childrenMode:'free',padding:0}});
  return validateDocument({kind:'ui_panel_document',version:'0.3',id:content.id+'-'+canvas,revision:0,title:content.title,canvas,bindings:structuredClone(ctx.binding),rootId:'artboard',nodes},ctx);
}
