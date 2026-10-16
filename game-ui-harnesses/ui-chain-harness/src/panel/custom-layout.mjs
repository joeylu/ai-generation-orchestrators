import {validateDocument,indexDocument} from './document.mjs';
import {documentLayout} from './layout.mjs';
import {presentation} from './preset-presentation.mjs';
import {minimumSize} from '../runtime/geometry.mjs';
import {scrollPadding} from '../runtime/scroll-geometry.mjs';
import {pngGeometry} from '../runtime/png-geometry.mjs';
import {recipeRef} from '../contracts/props.mjs';
import {headingPresentation} from './headings.mjs';
import {surfaceLayerInfo} from '../skins/surface-styles.mjs';
import {surfaceGeometryForContext} from '../runtime/surface-slots.mjs';
import {customLayoutPolicy,adaptivePresentation,isDataField,hasContentSurface,contentInsets,adaptiveColumns,dataArrangement} from './custom-presentation.mjs';
export {customLayoutPolicy} from './custom-presentation.mjs';

const fail=(code,message)=>{throw Object.assign(new Error(message??code),{code:'panel.action-'+code});};
const keys=(value,allowed)=>Object.keys(value).every(k=>allowed.includes(k));

// Only native planning semantics enter this bridge. Fill/content sizing, padding
// and grid columns are deterministic consumer policy, never invented intent fields.
export function customIntentLayout(panel,preset){
  const policy=customLayoutPolicy(preset),sections=[];
  if(panel.layout.canvasWidth!==null||panel.layout.canvasHeight!==null||!['error','scroll'].includes(panel.layout.overflow))fail('layout','Custom panels require the selected canvas and explicit error/scroll overflow.');
  for(const key of ['width','maxHeight'])if(panel.layout[key]!==null&&(!Number.isInteger(panel.layout[key])||panel.layout[key]<24||panel.layout[key]>4096))fail('layout-dimensions','Panel width and maxHeight must be logical integers from 24 to 4096.');
  let ordinal=0,nodeCount=0;
  const visit=(node,depth)=>{
    if(depth>policy.maxDepth)fail('layout-depth','Custom layout exceeds the configured nesting depth.');
    if(++nodeCount>96)fail('layout-count','Custom layout contains more than 96 structural nodes.');
    if(node.kind==='section'){
      if(sections.length>=32)fail('layout-count','Custom layout contains more than 32 sections.');
      if(!keys(node,['kind','title','rows','actionLayout'])||!node.rows.length)fail('grouping');
      const actionLayout=node.actionLayout;
      if(actionLayout!==null&&(actionLayout.sourceRef!=='request'||actionLayout.shape!=='default'||node.rows.some(r=>r.kind!=='button')))fail('action-layout','Explicit action layout requires a Button-only section with the supported default shape.');
      const result={kind:'section',id:'group-'+sections.length,title:node.title,rowIds:node.rows.map(()=>`row${ordinal++}`),actionLayout:structuredClone(actionLayout)};
      sections.push({...result,rows:node.rows});return result;
    }
    if(!['column','row','grid'].includes(node.kind)||!keys(node,['kind','children'])||!node.children?.length)fail('grouping','Only column, row, grid and section layout nodes are supported.');
    return {kind:node.kind,children:node.children.map(n=>visit(n,depth+1))};
  };
  return {body:visit(panel.body,1),sections};
}

export function customPanelDocument(content,config,canvas,ctx){
  const preset=config.presets[content.presetId],l=customLayoutPolicy(preset),g=config.geometry,profile=ctx.profile,board=ctx.canvases.presets[canvas],o=preset[canvas],policy=presentation(config.presentation);
  const imported=ctx.binding.sourceKind==='imported',scrolling=content.layout.overflow==='scroll';
  if(scrolling&&imported&&!ctx.scrollInsets)fail('scroll-insets');
  if(imported&&(!ctx.skinGeometry||!ctx.panelInsets))fail('skin-geometry','Verified PNG component geometry and panel safe insets are required.');
  const skin=imported?pngGeometry(ctx.skinGeometry,profile):null;
  const layered=['3.0','4.0'].includes(l.version)&&ctx.surfaceLayersEnabled!==false,reference=l.version==='4.0'&&layered&&ctx.surfaceCompositionEnabled!==false;
  const layerGeometry=layered?surfaceGeometryForContext(ctx):null,frameScale=reference?3:1,frame=layerGeometry?surfaceLayerInfo(layerGeometry,'frame',frameScale):null;
  const padding=Object.fromEntries(['left','right','top','bottom'].map(side=>[side,Math.max(g.padding,frame?.insets[side]??ctx.panelInsets?.[side]??0)]));
  if(Object.values(padding).some(n=>!Number.isFinite(n)||n<0))fail('skin-geometry');
  const quietLayer=reference?'inset':'content',scrollLayer=layerGeometry?surfaceLayerInfo(layerGeometry,quietLayer):null;
  const pad=scrolling?scrollPadding(profile,scrollLayer?.insets??ctx.scrollInsets??{left:0,right:0,top:0,bottom:0}):{left:0,right:0,top:0,bottom:0};
  const scrollExtra=scrolling?pad.left+pad.right+profile.geometry.scrollbarWidth+profile.geometry.scrollbarGap:0;
  const fields=new Map([...content.fields,...content.actions.map(a=>({...a,type:'button'}))].map(f=>[f.id,f]));
  const modern=adaptivePresentation(l),panelPad=contentInsets(l,ctx,layered?quietLayer:undefined),insetPad=layered?contentInsets(l,ctx,'inset'):panelPad,zero={left:0,right:0,top:0,bottom:0};
  const dataRows=new Set(),allData=node=>node.rowIds.filter(id=>fields.get(id)?.type!=='button').every(id=>isDataField(fields.get(id)));
  const markData=node=>{if(node.kind==='section'){if(!layered||allData(node))for(const id of node.rowIds)if(isDataField(fields.get(id)))dataRows.add(id);}else node.children.forEach(markData);};markData(content.layoutBody);
  const oneSection=(node)=>node.kind==='section'?1:node.children.reduce((sum,n)=>sum+oneSection(n),0);
  const singleSection=oneSection(content.layoutBody)===1;
  const sectionSurface=node=>modern&&l.groupSurfaces&&!(reference&&singleSection)&&hasContentSurface(node.rowIds.map(id=>fields.get(id)),layered)&&!(layered&&allData(node));
  const sectionPad=node=>sectionSurface(node)?panelPad:layered?zero:{left:l.groupPadding,right:l.groupPadding,top:l.groupPadding,bottom:l.groupPadding};
  const dataPad=f=>modern&&l.dataSurfaces&&dataRows.has(f.id)?insetPad:zero;
  const layoutBody=structuredClone(content.layoutBody),footerRows=[];
  // Preserve the original single-section scrolling contract: trailing buttons
  // stay fixed. In rich structures buttons retain the section and order authored.
  if(scrolling&&layoutBody.kind==='column'&&layoutBody.children.length===1&&layoutBody.children[0].kind==='section'&&layoutBody.children[0].actionLayout===null){
    const rows=layoutBody.children[0].rowIds;
    while(rows.length&&fields.get(rows.at(-1)).type==='button')footerRows.unshift(fields.get(rows.pop()));
  }
  const sectionCount=(node)=>node.kind==='section'?1:node.children.reduce((sum,c)=>sum+sectionCount(c),0);
  const showHeadings=sectionCount(content.layoutBody)>1||policy.sectionHeading==='show';
  // A conservative em budget, including wide ASCII W/@. Actual bundled-font
  // measurement still runs in the renderer; never reduce font size or truncate.
  const widthOf=text=>Math.ceil([...String(text)].reduce((n,c)=>n+profile.fontSize*(c===' '?.6:1.1),0));
  const lineHeight=Math.max(profile.geometry.lineHeight,Math.ceil(profile.fontSize*1.7));
  const assetFor=role=>ctx.skinGeometry?.assets.find(a=>a.assetId===ctx.skinGeometry.roles.find(r=>r.role===role)?.assetId);
  const insetFor=role=>skin?skin.insets(role):{left:profile.padding,right:profile.padding,top:0,bottom:0};
  const roleMinimum=(role,axis)=>assetFor(role)?.minSize[axis]??0;
  const fieldMin=f=>{
    if(!f)fail('layout-content','Layout row does not exist.');
    let width=l.minColumnWidth;
    if(f.type==='button'){
      const roles=['normal','pressed'].map(s=>`skin.button.${f.variant}.${s}`),insets=roles.map(insetFor);
      width=Math.max(width,...roles.map(r=>roleMinimum(r,'width')),widthOf(f.label)+Math.max(...insets.map(p=>p.left+p.right)));
    }else if(f.type==='switch'||f.type==='check-box')width=Math.max(width,widthOf(f.label)+(f.type==='switch'?profile.markSize*2:profile.markSize)+profile.geometry.labelGap);
    else if(f.type==='select'||f.type==='input'){
      const p=insetFor('skin.field.normal'),copy=f.type==='select'?Math.max(...f.options.map(a=>widthOf(a.label))):Math.min(240,widthOf(f.value||f.placeholder));
      width=Math.max(width,roleMinimum('skin.field.normal','width'),p.left+p.right+copy+(f.type==='select'?profile.geometry.indicatorWidth+profile.geometry.labelGap:0));
    }else if(f.type==='text'&&f.wrap==='none')width=Math.max(width,widthOf(f.text),modern&&isDataField(f)?widthOf(f.label):0);
    else if(f.type==='slider')width=Math.max(width,profile.thumbSize+Math.max(profile.geometry.minContent,...['skin.bar.track','skin.bar.fill'].map(r=>roleMinimum(r,'width'))));
    else if(f.type==='progress-bar')width=Math.max(width,...['skin.bar.track','skin.bar.fill'].map(r=>roleMinimum(r,'width')));
    const p=dataPad(f);return width+p.left+p.right;
  };
  const treeMin=node=>{
    if(node.kind==='section'){
      const a=node.actionLayout,rows=node.rowIds.map(id=>fields.get(id)),p=sectionPad(node),extra=p.left+p.right;
      if(a){for(const f of rows)if(a.buttonWidth<fieldMin(f))fail('action-size','Requested button width cannot contain its skin and caption.');
        return extra+(a.direction==='row'?rows.length*a.buttonWidth+Math.max(0,rows.length-1)*a.gap:a.buttonWidth);}
      const required=[];
      for(let i=0;i<rows.length;){
        if(rows[i].type==='button'){
          let end=i+1;while(end<rows.length&&rows[end].type==='button')end++;
          // Default button runs share equal widths, matching the actual compiler.
          required.push((end-i)*Math.max(...rows.slice(i,end).map(fieldMin))+g.gap*Math.max(0,end-i-1));i=end;
        }else{required.push(fieldMin(rows[i]));i++;}
      }
      return extra+Math.max(l.minColumnWidth,...required);
    }
    const widths=node.children.map(treeMin),columns=node.kind==='grid'?(modern?1:l.gridColumns):widths.length;
    return node.kind==='column'?Math.max(...widths):columns*Math.max(...widths)+l.groupGap*(columns-1);
  };
  const footerMinimum=footerRows.length?footerRows.length*Math.max(...footerRows.map(fieldMin))+g.gap*(footerRows.length-1):0;
  const minimumWidth=Math.max(roleMinimum('skin.surface.panel','width'),padding.left+padding.right+Math.max(footerMinimum,scrollExtra+treeMin(layoutBody)));
  const preferred=node=>{
    if(node.kind==='section')return treeMin(node);
    const widths=node.children.map(preferred);
    if(node.kind==='column')return Math.max(...widths);
    const grid=node.kind==='grid'&&modern,columns=grid?(canvas==='portrait'?1:Math.min(l.maxColumns,node.children.length)):node.children.length;
    return columns*Math.max(grid?l.minCardWidth:0,...widths)+l.groupGap*(columns-1);
  };
  const width=content.layout.width??(modern?Math.min(board.width-policy.canvasMargin*2,Math.max(o.width,padding.left+padding.right+scrollExtra+preferred(layoutBody),Math.ceil(minimumWidth))):Math.max(o.width,Math.ceil(minimumWidth)));
  if(width<minimumWidth-.01)fail('layout-width','Requested width cannot contain the declared structure, captions and component minimum sizes.');
  if(width>board.width-policy.canvasMargin*2)fail('canvas-capacity','Panel width exceeds the selected canvas safe area.');
  const bodyWidth=width-padding.left-padding.right,contentWidth=bodyWidth-scrollExtra,nodes=[],byId=new Map();let flowId=0;
  const add=(id,type,props,w,h,slots={},extra={})=>{
    const recipe=ctx.registry.recipes.find(r=>r.recipeId===type);
    const typeName=recipe?.type??({'container':'Container','text':'Text','button':'Button','input':'Input','select':'Select','slider':'Slider','progress-bar':'ProgressBar','check-box':'CheckBox','switch':'Switch','panel':'Panel','scroll-view':'ScrollView'}[type]);
    const min=minimumSize(typeName,props,profile),node={id,name:id,recipeRef:type+'@1.0.0',props,size:{width:w,height:Math.max(24,h,min.height)},slots,...extra};
    if(w<Math.max(24,min.width)-.01)fail('layout-width',`${id}: component minimum width is not satisfied.`);
    nodes.push(node);byId.set(id,node);return id;
  };
  const natural=id=>byId.get(id).size.height;
  const stack=(id,children,w,{direction='column',gap=g.gap,padding=0,...layout}={},extra={})=>{
    // Yoga distributes grow space above component minima. Equalize that floor
    // for mixed Panel/Container peers so an authored equal row remains equal.
    if(modern&&direction==='row'&&children.length&&children.every(id=>byId.get(id).sizing?.widthMode==='fill')){
      const floor=Math.max(...children.map(id=>{const n=byId.get(id),type=ctx.registry.recipes.find(r=>recipeRef(r)===n.recipeRef).type;return minimumSize(type,n.props,profile).width;}));
      for(const id of children)byId.get(id).sizing.minWidth=Math.max(floor,byId.get(id).sizing.minWidth??0);
    }
    const height=padding*2+(direction==='row'?Math.max(24,...children.map(natural)):children.reduce((s,id)=>s+natural(id),0)+Math.max(0,children.length-1)*gap);
    return add(id,'container',{},w,Math.max(24,height),{children},{sizing:{widthMode:'fill',heightMode:'content'},layout:{childrenMode:'flow',direction,gap,padding,...layout},...extra});
  };
  const panel=(id,child,w,p,layer=layered?quietLayer:undefined)=>{
    // Panel content slots have a measured width; only Container flow owns fill.
    byId.get(child).sizing={heightMode:'content'};
    const minimum=layer&&layerGeometry?surfaceLayerInfo(layerGeometry,layer)?.minHeight:roleMinimum('skin.surface.panel','height');
    return add(id,'panel',{title:'',contentPadding:{...p}},w,Math.max(natural(child)+p.top+p.bottom,minimum??0,p.top+p.bottom+profile.geometry.minContent),{content:[child]},{sizing:{widthMode:'fill'},...(layer?{surfaceLayer:layer}:{})});
  };
  const text=(id,value,w,minHeight=g.labelHeight,wrap='word',extra={},surfaceStyle)=>{
    if(w<24)fail('layout-width');
    const style=surfaceStyle?headingPresentation(ctx,surfaceStyle,w,minHeight,{layered,reference,centered:surfaceStyle==='title'&&extra.align==='center'}):{height:minHeight,insets:{left:0,right:0,top:0,bottom:0}},p=style.insets,inner=w-p.left-p.right,fontSize=style.fontSize??profile.fontSize;
    const measure=value=>Math.ceil([...String(value)].reduce((sum,c)=>sum+fontSize*(c===' '?.6:1.1)*(style.textWidthScale??1),0)),line=Math.max(profile.geometry.lineHeight,Math.ceil(fontSize*1.7*(style.lineHeightScale??1)));
    if(wrap==='none'&&measure(value)>inner)fail('text-capacity',`${id}: single-line text does not fit without truncation.`);
    const lines=String(value).split(/\r\n|\r|\n/).reduce((n,line)=>n+Math.max(1,Math.ceil(measure(line)/Math.max(1,inner-fontSize))),0);
    return add(id,'text',{text:value,textStyleRef:'body',wrap,overflow:'error',...extra},w,Math.max(style.height,line*(wrap==='word'?lines:1)+p.top+p.bottom),{}, {sizing:{widthMode:'fill'},...(style.surfaceStyle?{surfaceStyle:style.surfaceStyle}:{}),...(style.surfaceBand?{surfaceBand:style.surfaceBand}:{}),...(style.fontSize?{surfaceFontSize:style.fontSize}:{}),...(style.surfaceTextInsets?{surfaceTextInsets:style.surfaceTextInsets}:{})});
  };
  const button=(f,w,h=g.buttonHeight,sizing={widthMode:'fill'},explicitHeight=false)=>{
    const p=['normal','pressed'].map(s=>insetFor(`skin.button.${f.variant}.${s}`));
    const required=Math.max(lineHeight+Math.max(...p.map(p=>p.top+p.bottom)),...['normal','pressed'].map(s=>roleMinimum(`skin.button.${f.variant}.${s}`,'height')));
    if(h<required&&explicitHeight)fail('action-size','Requested button height cannot contain its safe area and caption.');
    return add(f.id,'button',{label:f.label,enabled:f.enabled,variant:f.variant},w,Math.max(h,required),{}, {sizing});
  };
  const field=(f,w,data)=>{
    if(w<fieldMin(f)-.01)fail('layout-width',`${f.id}: control label or skin does not fit.`);
    if(f.type==='button')return button(f,w);
    if(modern&&isDataField(f)){
      const p=dataPad(f),inner=w-p.left-p.right,inline=f.wrap==='none'&&!data.stacked,inset=l.dataSurfaces&&dataRows.has(f.id);
      const label=text(f.id+'-label',f.label,inline?data.labelWidth:inner,g.labelHeight,inline?'none':'word');
      const value=text(f.id,f.text,inline?inner-data.labelWidth-g.gap:inner,layered||f.wrap==='none'?g.labelHeight:g.textHeight,f.wrap);
      if(inline){byId.get(label).sizing={};byId.get(value).sizing={};}
      const block=stack(f.id+(inset?'-data-content':'-block'),[label,value],inner,{direction:inline?'row':'column'});
      return inset?panel(f.id+'-block',block,w,p,layered?'inset':undefined):block;
    }
    const ids=[],labelWidth=Math.max(120,Math.min(200,widthOf(f.label)+8)),inline=reference&&['input','select','slider'].includes(f.type)&&f.label&&w>=500&&w>=labelWidth+g.gap+fieldMin(f),controlWidth=inline?w-labelWidth-g.gap:w;
    if(f.type==='switch'||f.type==='check-box')return add(f.id,f.type,{label:f.label,checked:f.type==='switch'?f.value:f.checked,enabled:f.enabled},w,f.type==='switch'?g.switchHeight:g.checkboxHeight,{}, {sizing:{widthMode:'fill'}});
    if(f.label&&!(f.type==='text'&&f.label===f.text))ids.push(text(f.id+'-label',f.label,inline?labelWidth:w));
    if(f.type==='text')ids.push(text(f.id,f.text,w,layered?g.labelHeight:g.textHeight,f.wrap));
    else if(f.type==='slider')ids.push(add(f.id,'slider',{min:f.min,max:f.max,value:f.value,step:f.step,showValue:true,enabled:f.enabled},controlWidth,g.sliderHeight,{}, {sizing:{widthMode:'fill'}}));
    else if(f.type==='progress-bar'){
      ids.push(add(f.id,'progress-bar',{min:0,max:f.max,value:f.value,showValue:false},w,g.progressHeight,{}, {sizing:{widthMode:'fill'}}));
      ids.push(text(f.id+'-value',(f.display==='percent'?f.value/f.max*100:f.value).toFixed(f.fractionDigits)+(f.display==='percent'?'%':''),w));
    }else{
      const inset=insetFor('skin.field.normal'),h=Math.max(f.type==='select'?g.selectHeight:g.inputHeight,inset.top+inset.bottom+lineHeight,roleMinimum('skin.field.normal','height'));
      const props=f.type==='select'?{options:f.options,selectedId:f.value,placeholder:f.label,maxVisibleItems:3,enabled:f.enabled}:{value:f.value,placeholder:f.placeholder,inputType:f.inputType,readOnly:f.readOnly,maxLength:f.maxLength,enabled:f.enabled};
      ids.push(add(f.id,f.type,props,controlWidth,h,{}, {sizing:{widthMode:'fill'}}));
    }
    if(inline)for(const id of ids)byId.get(id).sizing={};
    return stack(f.id+'-block',ids,w,inline?{direction:'row',align:'center'}:{});
  };
  const compile=(node,w)=>{
    if(node.kind==='section'){
      const p=sectionPad(node),inner=w-p.left-p.right,rows=node.rowIds.map(id=>fields.get(id)),ids=[],surface=sectionSurface(node),data=dataArrangement(rows,inner,l.dataSurfaces&&rows.some(f=>dataRows.has(f.id))?insetPad:zero,g.gap,widthOf);
      if(showHeadings&&(!reference||!content.sectionHeadingIds||content.sectionHeadingIds.includes(node.id)))ids.push(text(node.id+'-heading',node.title,inner,g.labelHeight,'word',{},'section'));
      if(node.actionLayout){
        const a=node.actionLayout,buttons=rows.map(f=>button(f,a.buttonWidth,a.buttonHeight,{},true));
        ids.push(stack(node.id+'-actions',buttons,inner,{direction:a.direction,gap:a.gap,align:a.direction==='column'?{start:'flex-start',center:'center',end:'flex-end'}[a.align]:'flex-start',justify:a.direction==='row'?{start:'flex-start',center:'center',end:'flex-end'}[a.align]:'flex-start'}));
      }else{
        for(let i=0;i<rows.length;){
          if(rows[i].type==='button'){
            let end=i+1;while(end<rows.length&&rows[end].type==='button')end++;
            const buttons=rows.slice(i,end),bw=(inner-g.gap*(buttons.length-1))/buttons.length;
            if(buttons.some(f=>bw<fieldMin(f)))fail('action-size','Buttons cannot share this section width without clipping.');
            ids.push(stack(node.id+'-actions-'+i,buttons.map(f=>button(f,bw)),inner,{direction:'row'}));i=end;
          }else{ids.push(field(rows[i],inner,data));i++;}
        }
      }
      if(surface){const child=stack(node.id+'-content',ids,inner);return panel(node.id,child,w,p);}
      return stack(node.id,ids,w,{padding:layered?0:l.groupPadding});
    }
    const id='layout-'+flowId++,column=node.kind==='column',columns=node.kind==='grid'?adaptiveColumns(l,canvas,node.children.length,w,Math.max(...node.children.map(treeMin))):node.children.length;
    const childWidth=column?w:(w-l.groupGap*(columns-1))/columns;
    if(childWidth<24)fail('layout-width');
    let children=node.children.map(child=>compile(child,childWidth));
    if(node.kind==='grid'){
      const cellHeight=Math.max(...children.map(natural));
      children=children.map((child,index)=>add(id+'-cell-'+index,'container',{},childWidth,cellHeight,{children:[child]},{sizing:{widthMode:'fill'},layout:{childrenMode:'flow',direction:'column',gap:0,padding:0}}));
      return add(id,'container',{},w,Math.ceil(children.length/columns)*cellHeight+Math.max(0,Math.ceil(children.length/columns)-1)*l.groupGap,{children},{sizing:{widthMode:'fill',heightMode:'content'},layout:{childrenMode:'flow',direction:'grid',columns,cellHeight,gap:l.groupGap,padding:0}});
    }
    return stack(id,children,w,{direction:column?'column':'row',gap:l.groupGap});
  };
  const heading=text('heading',content.title,bodyWidth,g.headingHeight,'word',{align:l.titleAlign??policy.titleAlign},'title');
  const contentId=compile(layoutBody,contentWidth);
  const footer=footerRows.length?stack('actions',footerRows.map(f=>button(f,(bodyWidth-g.gap*(footerRows.length-1))/footerRows.length)),bodyWidth,{direction:'row'}):null;
  const cap=Math.min(content.layout.maxHeight??board.height-policy.canvasMargin*2,board.height-policy.canvasMargin*2);
  const required=Math.max(roleMinimum('skin.surface.panel','height'),padding.top+padding.bottom+natural(heading)+g.gap+natural(contentId)+(layered&&scrolling?pad.top+pad.bottom:0)+(footer?natural(footer)+g.gap:0));
  const height=layered?(scrolling?Math.min(Math.ceil(required),cap):Math.ceil(required)):(scrolling?Math.min(o.height,cap):Math.max(Math.min(o.height,cap),Math.ceil(required)));
  if(height>cap||height<Math.max(24,roleMinimum('skin.surface.panel','height')))fail('canvas-capacity','Content exceeds maxHeight or the selected canvas. Use explicit scrolling or simplify the structure.');
  let middle=contentId;
  if(scrolling){
    const viewport=height-padding.top-padding.bottom-natural(heading)-g.gap-(footer?natural(footer)+g.gap:0);
    if(viewport-pad.top-pad.bottom<Math.max(24,profile.geometry.minThumbLength))fail('scroll-capacity');
    // Slot roots have fixed width; only flow children may use fill.
    byId.get(contentId).sizing={heightMode:'content'};
    middle=add('custom-scroll','scroll-view',{axis:'vertical',scrollbar:'auto'},bodyWidth,viewport,{content:[contentId]},{sizing:{widthMode:'fill'},...(layered?{surfaceLayer:quietLayer}:{})});
  }
  stack('body',[heading,middle,...(footer?[footer]:[])],bodyWidth,{}, {size:{width:bodyWidth,height:height-padding.top-padding.bottom},sizing:{}});
  add('surface','panel',{title:'',contentPadding:padding},width,height,{content:['body']},{position:{x:(board.width-width)/2,y:(board.height-height)/2},...(layered?{surfaceLayer:'frame',...(reference?{surfaceScale:frameScale}:{})}:{})});
  add('artboard','container',{},board.width,board.height,{children:['surface']},{layout:{childrenMode:'free',padding:0}});
  const doc=validateDocument({kind:'ui_panel_document',version:'0.3',id:content.id+'-'+canvas,revision:0,title:content.title,canvas,bindings:structuredClone(ctx.binding),rootId:'artboard',nodes},ctx);
  if(skin){
    const indexed=indexDocument(doc),recipes=new Map(doc.nodes.map(n=>[n.id,ctx.registry.recipes.find(r=>recipeRef(r)===n.recipeRef)])),resolved=documentLayout(indexed.nodes,recipes,indexed.parents,profile);
    for(const node of doc.nodes){const size=resolved.get(node.id)??node.size;try{skin.assertComponent(recipes.get(node.id).type,node.props,size.width,size.height,node.surfaceLayer?{surfaceLayer:node.surfaceLayer,surfaceScale:node.surfaceScale}:undefined);}catch(e){e.message=node.id+': '+e.message;throw e;}}
  }
  return doc;
}
