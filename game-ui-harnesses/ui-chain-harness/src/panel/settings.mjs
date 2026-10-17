import {referenceLayoutDocument} from './reference-layout.mjs';
import {scrollPadding} from '../runtime/scroll-geometry.mjs';
import {tabsContentBox} from '../runtime/tabs-geometry.mjs';
import {presentation,presetHeight} from './preset-presentation.mjs';
import { validateDocument } from './document.mjs';
import {headingPresentation} from './headings.mjs';
import {presetSurfaceDocument} from './preset-surfaces.mjs';
import {surfaceLayerInfo} from '../skins/surface-styles.mjs';
import {surfaceGeometryForContext} from '../runtime/surface-slots.mjs';

// Preset compilation only: content, geometry and selected skin stay independent.
export function settingsDocument(content, layout, canvas, ctx) {
  if(layout.referenceLayout)return referenceLayoutDocument(content,layout,canvas,ctx);
  if (content.version !== '1.0' || layout.version !== '1.0' || !Array.isArray(content.fields) || !content.fields.length)
    throw Error('Unsupported settings configuration.');
  const o = layout.orientations[canvas], board = ctx.canvases.presets[canvas];
  if (!o || !board) throw Error('Unknown orientation.');
  const policy = presentation(layout.presentation),reference=policy.version==='3.0'&&ctx.surfaceLayersEnabled!==false&&ctx.surfaceCompositionEnabled!==false;
  const geometry=reference?surfaceGeometryForContext(ctx):null,frame=geometry?surfaceLayerInfo(geometry,'frame',3):null,quiet=geometry?surfaceLayerInfo(geometry,'inset'):null;
  const padding=reference?Math.max(layout.padding,...Object.values(frame?.insets??{})):layout.padding;
  const nodes = [], bodyWidth = o.width - padding * 2;
  if(content.overflow!==undefined&&!['error','scroll'].includes(content.overflow))throw Error('Unsupported settings overflow');
  const scrolling=content.overflow==='scroll';
  if((scrolling||content.tabs)&&ctx.binding.sourceKind==='imported'&&!ctx.scrollInsets)throw Error('Verified scroll insets required');
  const middleInsets=quiet?.insets??ctx.scrollInsets??{left:0,right:0,top:0,bottom:0};
  const tabBox=content.tabs?tabsContentBox(ctx.profile,middleInsets,bodyWidth,o.height):null;
  const tabPad=tabBox?.pad??{left:0,right:0,top:0,bottom:0};
  const pageWidth=bodyWidth-tabPad.left-tabPad.right;
  const pad=scrolling?scrollPadding(ctx.profile,middleInsets):null;
  const rowWidth=scrolling?pageWidth-pad.left-pad.right-ctx.profile.geometry.scrollbarWidth-ctx.profile.geometry.scrollbarGap:pageWidth;
  const add = (id, type, props, width, height, slots = {}, extra = {}) => {
    nodes.push({ id, name: id, recipeRef: `${type}@1.0.0`, props, size: { width, height }, slots, ...extra }); return id;
  };
  const heading=(id,text,width,height,key)=>{const style=headingPresentation(ctx,key,width,height,{layered:(policy.version==='2.0'||reference)&&ctx.surfaceLayersEnabled!==false,reference,centered:key==='title'&&policy.titleAlign==='center'}),node=add(id,'text',{text,textStyleRef:'body',align:key==='title'?policy.titleAlign:'left',overflow:'error'},width,style.height);if(style.surfaceStyle){const target=nodes.find(n=>n.id===node);target.surfaceStyle=style.surfaceStyle;if(style.surfaceTextInsets)target.surfaceTextInsets=style.surfaceTextInsets;if(style.surfaceBand){target.surfaceBand=style.surfaceBand;target.surfaceFontSize=style.fontSize;}}return node;};
  const title = heading('heading',content.title,bodyWidth,layout.titleHeight,'title');
  const titleHeight=nodes.find(n=>n.id===title).size.height;
  const groups=content.groups;
  if(groups!==undefined){
    const ordered=Array.isArray(groups)?groups.flatMap(g=>g.fieldIds??[]):[];
    if(!Array.isArray(groups)||!groups.length||groups.some(g=>typeof g.id!=='string'||typeof g.title!=='string'||!g.title.trim()||!Array.isArray(g.fieldIds)||!g.fieldIds.length)||new Set(groups.map(g=>g.id)).size!==groups.length||JSON.stringify(ordered)!==JSON.stringify(content.fields.map(f=>f.id)))throw Object.assign(Error('Invalid settings groups'),{code:'panel.settings-groups'});
  }
  const tabs=content.tabs;
  if(tabs!==undefined){
    if(!Array.isArray(tabs)||tabs.length<2||tabs.length>8||!groups||tabs.filter(t=>t.initial===true).length!==1||tabs.some(t=>typeof t.id!=='string'||!t.id.match(/^[A-Za-z][A-Za-z0-9_.-]*$/)||typeof t.label!=='string'||!t.label.trim()||typeof t.initial!=='boolean'||!Array.isArray(t.groupIds)||!t.groupIds.length)||new Set(tabs.map(t=>t.id)).size!==tabs.length||JSON.stringify(tabs.flatMap(t=>t.groupIds))!==JSON.stringify(groups.map(g=>g.id))||typeof content.tabsEnabled!=='boolean')throw Object.assign(Error('Invalid settings tabs'),{code:'panel.settings-tabs'});
  }
  if(['2.0','3.0'].includes(layout.presentation?.version)&&ctx.surfaceLayersEnabled!==false&&!tabs){
    const fields=content.fields.map(f=>({...f})),close={id:'close',label:content.closeLabel,enabled:true,variant:'primary',action:'emit',targets:[]};
    const config={geometry:{padding:layout.padding,gap:layout.gap,headingHeight:layout.titleHeight,labelHeight:layout.labelHeight,textHeight:layout.labelHeight,inputHeight:layout.fieldHeight,switchHeight:layout.fieldHeight,selectHeight:layout.fieldHeight,sliderHeight:layout.controlHeight,buttonHeight:layout.buttonHeight},presentation:layout.presentation,presets:{settings:{surface:'panel',...Object.fromEntries(Object.entries(layout.orientations).map(([key,value])=>[key,{width:value.width,height:value.height}]))}}};
    const body=groups?{kind:'column',children:groups.map((group,index)=>({kind:'section',id:'group-'+index,title:group.title,rowIds:[...group.fieldIds,...(index===groups.length-1?['close']:[])],actionLayout:null}))}:undefined;
    return presetSurfaceDocument({...content,presetId:'settings',sectionTitle:content.sectionTitle||content.title,fields,actions:[close]},config,canvas,ctx,body);
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
      if(tabs||groups.length>1||policy.sectionHeading==='show')sectionRows.push(heading('section-heading-'+index,group.title,rowWidth,layout.labelHeight,'section'));
      sectionRows.push(...group.fieldIds.map(id=>id+'-row'));
      groupRows.set(group.id,sectionRows.slice(start));
    }
  }else{
    if(content.sectionTitle&&policy.sectionHeading==='show')sectionRows.push(heading('section-heading',content.sectionTitle,bodyWidth,layout.labelHeight,'section'));
    sectionRows.push(...rows);
  }
  const close=add('close','button',{label:content.closeLabel},Math.min(layout.buttonWidth,bodyWidth),layout.buttonHeight);
  const footer=add('footer','container',{},bodyWidth,layout.buttonHeight,{children:[close]},{layout:{childrenMode:'flow',direction:'column',align:'center',gap:0,padding:0}});
  const sequences=tabs?tabs.map(t=>t.groupIds.flatMap(id=>groupRows.get(id))):[sectionRows];
  const natural=ids=>ids.reduce((sum,id)=>sum+nodes.find(n=>n.id===id).size.height,0)+Math.max(0,ids.length-1)*layout.gap;
  const headerHeight=tabBox?tabBox.headerHeight+tabPad.top+tabPad.bottom:0;
  const height=presetHeight({policy:scrolling?{...policy,height:'fixed'}:policy,width:o.width,height:o.height,board,padding,children:scrolling?[]:[titleHeight,Math.max(...sequences.map(natural))+headerHeight,layout.buttonHeight],gap:layout.gap});
  const middleHeight=height-padding*2-titleHeight-layout.buttonHeight-layout.gap*2;
  const pageHeight=middleHeight-headerHeight;
  let middle=sectionRows;
  if(scrolling||tabs){
    if(rowWidth<=0||pageHeight-(scrolling?pad.top+pad.bottom:0)<o.rowHeight)throw Object.assign(Error('Scroll/page viewport too small'),{code:'panel.scroll-capacity'});
    const pages=sequences.map((ids,index)=>{
      const suffix=tabs?'-'+index:'';
      const contentId=add('scroll-content'+suffix,'container',{},rowWidth,scrolling?natural(ids):pageHeight,{children:ids},{...(scrolling?{sizing:{heightMode:'content'}}:{}),layout:{childrenMode:'flow',direction:'column',gap:layout.gap,padding:0}});
      return scrolling?add('settings-scroll'+suffix,'scroll-view',{axis:'vertical',scrollbar:'auto'},pageWidth,pageHeight,{content:[contentId]},reference?{surfaceLayer:'inset'}:{}):contentId;
    });
    middle=tabs?[add('settings-tabs','tabs',{enabled:content.tabsEnabled,tabs:tabs.map((t,i)=>({id:t.id,label:t.label,contentNodeId:pages[i],enabled:true})),activeId:tabs.find(t=>t.initial).id},bodyWidth,middleHeight,{pages},reference?{surfaceLayer:'inset'}:{})]:pages;
  }
  const body=add('body','container',{},bodyWidth,height-padding*2,{children:[title,...middle,footer]},{layout:{childrenMode:'flow',direction:'column',gap:layout.gap,padding:0}});
  const panel=add('settings','panel',{title:'',contentPadding:{left:padding,right:padding,top:padding,bottom:padding}},o.width,height,{content:[body]}, {position:{x:(board.width-o.width)/2,y:(board.height-height)/2},...((layout.presentation?.version==='2.0'||reference)&&ctx.surfaceLayersEnabled!==false?{surfaceLayer:'frame',...(reference?{surfaceScale:3}:{})}:{})});
  add('artboard','container',{},board.width,board.height,{children:[panel]},{layout:{childrenMode:'free',padding:0}});
  return validateDocument({kind:'ui_panel_document',version:'0.3',id:content.id+'-'+canvas,revision:0,title:content.title,canvas,bindings:structuredClone(ctx.binding),rootId:'artboard',nodes},ctx);
}
