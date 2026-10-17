import defaultConfig from '../../configs/inventory-panel.json' with {type:'json'};
import {validateDocument} from './document.mjs';
import {panelOrientations} from './orientation.mjs';
import {upgradeInventoryRegistry,inventoryScrollMode,assertInventoryGridLimits,inventorySlotAssets} from '../runtime/inventory-policy.mjs';
import {inventoryLayout,inventoryMinimum} from '../runtime/inventory-geometry.mjs';
import {pngGeometry} from '../runtime/png-geometry.mjs';
import {upgradeTextStyleRegistry,isTextColor} from '../runtime/text-style.mjs';
import {headingPresentation} from './headings.mjs';
import {surfaceGeometryForContext} from '../runtime/surface-slots.mjs';
import {surfaceLayerInfo} from '../skins/surface-styles.mjs';
import {inventorySlotFit,inventoryViewportFit} from '../runtime/inventory-slot-fit.mjs';

export const inventoryPanelConfig=structuredClone(defaultConfig);
export const inventoryPresetChoice=Object.freeze({id:'inventory',name:'仓库面板',group:'inventory',groupName:'仓库面板',variant:'物品仓库',builder:'deterministic-inventory',defaultColumns:defaultConfig.columns,defaultRows:defaultConfig.rows,minimumCapacity:defaultConfig.items.length,description:'默认 5 列 4 行，可调整行列。选择物品查看图标、名称、数量和详情；含 8 件示例物品，图标为示意图，不含拖拽、交换或堆叠。'});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const bounded=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;

export function inventoryTitle(value=defaultConfig.defaultTitle){
  if(typeof value!=='string'||!value.trim()||[...value].length>40||/[\u0000-\u001f\u007f]/.test(value))fail('inventory.title','仓库标题须为 1–40 个字符的单行文字。');
  return value.trim();
}
export function validateInventoryConfig(input){
  const keys=['kind','version','presetId','columns','rows','gap','canvasMargin','contentGap','minPadding','headingHeight','defaultTitle','orientations','items'];
  const fixed=input?.version==='1.2',compact=['1.1','1.2'].includes(input?.version),allowed=compact?[...keys,'appearance','samplePlacement','cellTarget',...(fixed?['scrollMode']:[])]:keys;
  if(!exact(input,allowed)||input.kind!=='ui_inventory_panel_config'||!['1.0','1.1','1.2'].includes(input.version)||input.presetId!=='inventory'||!bounded(input.columns,1,fixed?32:10)||!bounded(input.rows,1,fixed?32:10)||input.columns*input.rows>(fixed?144:100)||fixed&&input.scrollMode!==inventoryScrollMode||(!compact&&(input.columns!==10||input.rows!==10))||!bounded(input.gap,0,16)||!bounded(input.canvasMargin,16,128)||!bounded(input.contentGap,0,32)||!bounded(input.minPadding,0,128)||!bounded(input.headingHeight,24,128)||!exact(input.orientations,['landscape','portrait'])||!Array.isArray(input.items)||input.items.length<1||input.items.length>input.columns*input.rows||compact&&(input.appearance!=='slots'||input.samplePlacement!=='preserve-default-or-sequential'||!bounded(input.cellTarget,48,88)))fail('inventory.config','仓库配置行列、格数、滚动版本或布局配置无效；新布局行列各最多 32、合计最多 144 格。');
  inventoryTitle(input.defaultTitle);
  for(const orientation of ['landscape','portrait']){
    const value=input.orientations[orientation];
    const width=compact?'maxWidth':'width',height=compact?'maxHeight':'height';
    if(!exact(value,[width,height,'details'])||!bounded(value[width],24,4096)||!bounded(value[height],24,4096)||value.details!==(orientation==='landscape'?'right':'below'))fail('inventory.config','仓库横竖版尺寸或详情布局配置无效。');
  }
  const ids=new Set(),slots=new Set(),icons=new Set(['gem','potion','coin','material','scroll','sword','shield','food']);
  for(const item of input.items){
    if(!exact(item,['id','label','enabled','slotIndex','quantity','description','icon'])||typeof item.id!=='string'||!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(item.id)||ids.has(item.id)||typeof item.label!=='string'||!item.label.trim()||[...item.label].length>40||typeof item.enabled!=='boolean'||!bounded(item.slotIndex,0,input.columns*input.rows-1)||slots.has(item.slotIndex)||!bounded(item.quantity,1,999999)||typeof item.description!=='string'||!item.description.trim()||[...item.description].length>240||!icons.has(item.icon))fail('inventory.items','仓库示例物品的标识、格位、图标、数量或说明无效。');
    ids.add(item.id);slots.add(item.slotIndex);
  }
  return structuredClone(input);
}
export function inventoryPresetContext(ctx){return {...ctx,registry:upgradeTextStyleRegistry(upgradeInventoryRegistry(ctx.registry))};}

export function inventoryGrid(config,grid={}){
  const fixed=config.version==='1.2',maximum=fixed?32:10;
  if(!grid||typeof grid!=='object'||Array.isArray(grid)||Object.keys(grid).some(key=>!['columns','rows'].includes(key))||Object.hasOwn(grid,'columns')!==Object.hasOwn(grid,'rows'))fail('inventory.grid','请同时指定整数列数与行数。');
  const columns=Object.hasOwn(grid,'columns')?grid.columns:config.columns,rows=Object.hasOwn(grid,'rows')?grid.rows:config.rows;
  if(!bounded(columns,1,maximum)||!bounded(rows,1,maximum)||columns*rows>(fixed?144:100))fail('inventory.grid',fixed?'列数与行数须各为 1–32 的整数，合计最多 144 格。':'旧布局列数与行数须为 1–10 的整数。');
  if(columns*rows<config.items.length)fail('inventory.capacity',`当前示例有 ${config.items.length} 件物品，需要至少 ${config.items.length} 个格子，不能截断物品。`);
  const changed=columns!==config.columns||rows!==config.rows;
  if(changed&&!['1.1','1.2'].includes(config.version))fail('inventory.grid-legacy','旧仓库计划须保留原有行列；请重新创建可配置的仓库面板。');
  // This is an explicit rule for creating a new preset template, never an
  // authoring migration: unchanged shape retains its declared slots; a new
  // shape places every sample in array order. Existing documents do not pass
  // through this builder when loaded, edited or saved.
  const items=config.items.map((item,index)=>({...item,...(changed?{slotIndex:index}:{})}));
  return {columns,rows,items,placement:changed?'template-order':'configured-slots'};
}

export function inventoryPresetDocument(ctx,input=defaultConfig,title,grid={}){
  const config=validateInventoryConfig(input),chosen=inventoryGrid(config,grid);
  const props={items:chosen.items,itemRecipeRef:'button@1.0.0',selection:'single',selectedId:chosen.items.find(item=>item.enabled)?.id??null,gapToken:'controlGap',inventory:{columns:chosen.columns,rows:chosen.rows,gap:config.gap,details:config.orientations[ctx.orientation]?.details,...(config.version!=='1.0'?{appearance:config.appearance}:{}),...(config.version==='1.2'?{scrollMode:inventoryScrollMode,cellSize:config.cellTarget}:{})}};
  return buildInventoryDocument(ctx,config,inventoryTitle(title??config.defaultTitle),props);
}

// Shared deterministic geometry for authored/model content. This contract has
// no sample items: caller data never passes through template placement rules.
export function inventoryLayoutConfig(input=defaultConfig,{reference=true}={}){
  const source=validateInventoryConfig(input);
  return {...Object.fromEntries(['gap','canvasMargin','contentGap','minPadding','headingHeight','orientations','appearance','cellTarget'].filter(key=>Object.hasOwn(source,key)).map(key=>[key,structuredClone(source[key])])),version:reference?'1.6':'1.3',scrollMode:inventoryScrollMode,surfaceLayer:reference?'inset':'content',...(reference?{frameScale:3,slotFit:inventorySlotFit,viewportFit:inventoryViewportFit,titleAlign:'center',slotAssets:inventorySlotAssets}:{})};
}
export function validateInventoryLayoutConfig(input){
  const dedicated=input?.version==='1.6',fitted=['1.5','1.6'].includes(input?.version),fixed=['1.2','1.3','1.4','1.5','1.6'].includes(input?.version),layered=['1.3','1.4','1.5','1.6'].includes(input?.version),reference=['1.4','1.5','1.6'].includes(input?.version);
  if(!exact(input,['version','gap','canvasMargin','contentGap','minPadding','headingHeight','orientations','appearance','cellTarget',...(fixed?['scrollMode']:[]),...(layered?['surfaceLayer']:[]),...(reference?['frameScale']:[]),...(fitted?['slotFit','viewportFit','titleAlign']:[]),...(dedicated?['slotAssets']:[])])||!['1.1','1.2','1.3','1.4','1.5','1.6'].includes(input.version)||fixed&&input.scrollMode!==inventoryScrollMode||layered&&input.surfaceLayer!==(reference?'inset':'content')||reference&&input.frameScale!==3||fitted&&(input.slotFit!==inventorySlotFit||input.viewportFit!==inventoryViewportFit||input.titleAlign!=='center')||dedicated&&input.slotAssets!==inventorySlotAssets)fail('inventory.layout-config','模型仓库需要明确的紧凑布局、滚动与底板版本配置。');
  // Reuse the existing layout policy validation; these examples are only a
  // schema witness and are never returned as document content.
  const {surfaceLayer,frameScale,slotFit,viewportFit,titleAlign,slotAssets,...witness}=input;
  validateInventoryConfig({...witness,version:layered?'1.2':input.version,kind:'ui_inventory_panel_config',presetId:'inventory',columns:1,rows:1,defaultTitle:'仓库',samplePlacement:'preserve-default-or-sequential',items:[{id:'validation',label:'验证',enabled:true,slotIndex:0,quantity:1,description:'验证',icon:'gem'}]});
  return structuredClone(input);
}
export function inventoryContentDocument(ctx,{title,sectionTitle=title,label=sectionTitle,props},layout){
  const config=validateInventoryLayoutConfig(layout),headings=[title,sectionTitle,label];
  for(const value of headings)if(inventoryTitle(value)!==value)fail('inventory.title','标题与分组标签不能包含首尾空白。');
  // One inventory has one semantic grid. Its upstream section/row wrappers stay
  // in exported content; only an explicit caller opts into visible group labels.
  const reference=['1.4','1.5','1.6'].includes(config.version)&&ctx.surfaceCompositionEnabled!==false&&ctx.surfaceLayersEnabled!==false;
  return buildInventoryDocument(ctx,config,title,structuredClone(props),reference&&ctx.inventoryShowGroupHeading!==true?[]:[...new Set(headings)].slice(1));
}
function buildInventoryDocument(ctx,config,title,props,extraHeadings=[]){
  const orientation=ctx.orientation;
  if(!orientation||panelOrientations(orientation).length!==1)fail('inventory.orientation','请先选择仓库面板的 16:9 或 9:16 画布。');
  ctx=inventoryPresetContext(ctx);
  if(ctx.inventoryHeadingColor!==undefined&&!isTextColor(ctx.inventoryHeadingColor))fail('inventory.color','仓库标题颜色证据无效。');
  if(['1.5','1.6'].includes(config.version))props={...props,inventory:{...props.inventory,slotFit:config.slotFit,viewportFit:config.viewportFit,...(config.version==='1.6'?{slotAssets:config.slotAssets}:{})}};
  const board=ctx.canvases.presets[orientation],surface=config.orientations[orientation],compact=['1.1','1.2','1.3','1.4','1.5','1.6'].includes(config.version),chosen=props.inventory,fixed=chosen.scrollMode===inventoryScrollMode,reference=['1.4','1.5','1.6'].includes(config.version)&&ctx.surfaceCompositionEnabled!==false&&ctx.surfaceLayersEnabled!==false,layered=['content','inset'].includes(config.surfaceLayer)&&ctx.surfaceLayersEnabled!==false,layer=reference?'inset':'content',frameScale=reference?config.frameScale:1,geometryOptions=layered?{surfaceLayer:layer}:undefined;
  if(!compact&&(surface.width>board.width-2*config.canvasMargin||surface.height>board.height-2*config.canvasMargin))fail('inventory.canvas','仓库面板超过所选画布的安全边界。');
  if(ctx.binding.sourceKind==='imported'&&!ctx.skinGeometry)fail('inventory.skin-geometry','仓库缺少经过核验的皮肤安全区证据。');
  const skin=ctx.binding.sourceKind==='imported'?pngGeometry(ctx.skinGeometry,ctx.profile):null;
  const layoutGeometry=layered?surfaceGeometryForContext(ctx):ctx.skinGeometry;
  const safe=reference?surfaceLayerInfo(layoutGeometry,'frame',frameScale).insets:skin?.insets('skin.surface.panel')??{left:ctx.profile.padding,right:ctx.profile.padding,top:ctx.profile.padding,bottom:ctx.profile.padding};
  const padding=Object.fromEntries(Object.entries(safe).map(([key,value])=>[key,Math.max(value,config.minPadding)]));
  const padWidth=padding.left+padding.right,padHeight=padding.top+padding.bottom;
  const headingStyle=(width,index)=>layered?headingPresentation(ctx,index?'section':'title',width,config.headingHeight,{layered,reference,centered:index===0&&config.titleAlign==='center'}):{height:config.headingHeight,insets:{left:0,right:0,top:0,bottom:0}};
  const headingFor=(width,value=title,index=0)=>{const style=headingStyle(width,index),p=style.insets,fontSize=style.fontSize??ctx.profile.fontSize,lineHeight=style.fontSize?Math.max(ctx.profile.geometry.lineHeight,Math.ceil(fontSize*1.7*(style.lineHeightScale??1))):ctx.profile.geometry.lineHeight;return Math.max(style.height,lineHeight*Math.max(1,Math.ceil((['1.5','1.6'].includes(config.version)?[...value].reduce((units,c)=>units+(/[a-z]/.test(c)?.8:c===' '?.6:1.1),0):[...value].length*1.1)*fontSize*(style.textWidthScale??1)/Math.max(1,width-p.left-p.right-fontSize)))+p.top+p.bottom);};
  const headingsFor=width=>[title,...extraHeadings].reduce((sum,value,index)=>sum+headingFor(width,value,index),0)+extraHeadings.length*config.contentGap;
  let surfaceWidth=surface.width,surfaceHeight=surface.height,width,height,headingHeight,bodyHeight;
  if(compact){
    const maxWidth=Math.min(surface.maxWidth,board.width-2*config.canvasMargin)-padWidth,maxHeight=Math.min(surface.maxHeight,board.height-2*config.canvasMargin)-padHeight;
    const minimum=inventoryMinimum(ctx.profile,props,layoutGeometry,geometryOptions),probe=inventoryLayout(ctx.profile,props,maxWidth,maxHeight-headingsFor(maxWidth)-config.contentGap,layoutGeometry,geometryOptions);
    const gap=config.gap,gridMinWidth=fixed?probe.cell.minimum:probe.cell.minimum*chosen.columns+gap*(chosen.columns-1),extraWidth=surface.details==='right'?minimum.width-gridMinWidth:0;
    const target=Math.max(probe.cell.minimum,props.inventory.cellSize??config.cellTarget);
    width=Math.min(maxWidth,Math.max(minimum.width,chosen.columns*target+gap*(chosen.columns-1)+extraWidth));
    const side=fixed?target:Math.max(probe.cell.minimum,Math.min(target,Math.floor((width-extraWidth-gap*(chosen.columns-1))/chosen.columns))),naturalHeight=chosen.rows*side+gap*(chosen.rows-1);
    const extraHeight=surface.details==='below'?minimum.height-probe.cell.minimum:0;
    headingHeight=headingsFor(width);height=Math.min(maxHeight-headingHeight-config.contentGap,Math.max(minimum.height,naturalHeight+extraHeight));
    if(['1.5','1.6'].includes(config.version))height=inventoryLayout(ctx.profile,props,width,height,layoutGeometry,geometryOptions).naturalHeight;
    bodyHeight=headingHeight+config.contentGap+height;surfaceWidth=width+padWidth;surfaceHeight=bodyHeight+padHeight;
  }else{
    width=surfaceWidth-padWidth;bodyHeight=surfaceHeight-padHeight;headingHeight=headingFor(width);height=bodyHeight-headingHeight-config.contentGap;
  }
  if(fixed)assertInventoryGridLimits({columns:chosen.columns,rows:chosen.rows,cellWidth:chosen.cellSize??config.cellTarget,cellHeight:chosen.cellSize??config.cellTarget,spacingX:chosen.gap,spacingY:chosen.gap,padding:0});
  // The same geometry module owns renderer placement, skin minima and scroll
  // policy. The preset never shrinks artwork or changes the selected canvas.
  inventoryLayout(ctx.profile,props,width,height,layoutGeometry??undefined,geometryOptions);
  skin?.assertComponent('List',props,width,height,geometryOptions);skin?.assertComponent('Panel',{title:'',contentPadding:padding},surfaceWidth,surfaceHeight,layered?{surfaceLayer:'frame',...(reference?{surfaceScale:frameScale}:{})}:undefined);
  const node=(id,type,p,w,h,slots={},extra={})=>({id,name:id,recipeRef:type+'@1.0.0',props:p,size:{width:w,height:h},slots,...extra});
  const headings=[title,...extraHeadings].map((value,index)=>{const style=headingStyle(width,index);return node(index?'inventory-heading-'+index:'inventory-heading','text',{text:value,textStyleRef:'body',align:index===0&&config.titleAlign==='center'?'center':layered?'left':'center',wrap:'word',overflow:'error',...(ctx.inventoryHeadingColor&&!style.surfaceStyle?{textColor:ctx.inventoryHeadingColor}:{})},width,headingFor(width,value,index),{},style.surfaceStyle?{surfaceStyle:style.surfaceStyle,...(style.surfaceTextInsets?{surfaceTextInsets:style.surfaceTextInsets}:{}),...(style.surfaceBand?{surfaceBand:style.surfaceBand}:{}),...(style.fontSize?{surfaceFontSize:style.fontSize}:{})}:{});});
  return validateDocument({kind:'ui_panel_document',version:'0.3',id:'inventory-'+orientation,revision:0,title,canvas:orientation,bindings:structuredClone(ctx.binding),rootId:'artboard',nodes:[
    ...headings,
    node('inventory-grid','list',props,width,height,{},layered?{surfaceLayer:layer}:{}),
    node('inventory-body','container',{},width,bodyHeight,{children:[...headings.map(heading=>heading.id),'inventory-grid']},{layout:{childrenMode:'flow',direction:'column',gap:config.contentGap,padding:0}}),
    node('inventory-surface','panel',{title:'',contentPadding:padding},surfaceWidth,surfaceHeight,{content:['inventory-body']},{position:{x:(board.width-surfaceWidth)/2,y:(board.height-surfaceHeight)/2},...(layered?{surfaceLayer:'frame',...(reference?{surfaceScale:frameScale}:{})}:{})}),
    node('artboard','container',{},board.width,board.height,{children:['inventory-surface']},{layout:{childrenMode:'free',padding:0}}),
  ]},ctx);
}

export function inventoryPreset(ctx,config=defaultConfig,title,grid={}){
  const document=inventoryPresetDocument(ctx,config,title,grid),chosen=inventoryGrid(config,grid);
  return {content:{version:'1.0',presetId:'inventory',id:'inventory',title:document.title,columns:chosen.columns,rows:chosen.rows,sampleItemCount:chosen.items.length,sampleData:true,samplePlacement:chosen.placement,iconSource:'deterministic-example-vectors',fields:[],actions:[]},behavior:{version:'1.0',fields:[],actions:[],dismissOnEmit:false},documents:{[document.canvas]:document}};
}
