// This is a bounded consumer of the public planning/v1 intent, not a planner.
// The catalog is public contract data; planning stays behind planning-client.
import {readPanelSdkJson} from './sdk.mjs';
import capabilities from '../../configs/inventory-planning.json' with {type:'json'};
import {inventoryPanelConfig,inventoryPresetContext,inventoryLayoutConfig,validateInventoryLayoutConfig,inventoryContentDocument} from './inventory-preset.mjs';
import {inventoryLayout} from '../runtime/inventory-geometry.mjs';
import {assertInventoryGridLimits,inventoryScrollMode} from '../runtime/inventory-policy.mjs';
import {validateSettingsResponse} from './settings-intent.mjs';

const upstreamCatalog=await readPanelSdkJson('examples/modern-readable-game-grid-layout.catalog.json');
// Exact legacy capability snapshot: existing immutable plans are verified with
// their original geometry policy rather than upgraded during conversion.
const legacyCapabilities=structuredClone(capabilities);
legacyCapabilities.version='1.0';legacyCapabilities.columns.maximum=10;legacyCapabilities.rows.maximum=10;
for(const key of ['maximumCells','maximumGridDimension','scrollMode'])delete legacyCapabilities[key];

const fail=(code,message)=>{throw Object.assign(new Error(message),{code:'panel.inventory-'+code});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
const same=(left,right)=>stable(left)===stable(right);
const gridKeys=['rows','columns','cellWidth','cellHeight','spacingX','spacingY','padding','startCorner','startAxis'];
const shape=(value,fixed=true)=>{
  if(!exact(value,['columns','rows']))fail('grid','仓库须同时指定列数和行数。');
  if(fixed){try{assertInventoryGridLimits(value);}catch{fail('grid','仓库行列须各为 1–32 的整数，合计最多 144 格。');}}
  else if(![value.columns,value.rows].every(n=>Number.isInteger(n)&&n>=1&&n<=10))fail('grid','旧仓库行列必须分别为 1–10 的整数。');
  return {columns:value.columns,rows:value.rows};
};
const propsFor=(grid,details,items=[],selectedSlot=null,enabled=true,scrollMode)=>({
  enabled,items:items.map(item=>({id:'inventory-slot-'+item.slot,label:item.name,enabled:true,slotIndex:item.slot,quantity:item.quantity,description:'',icon:item.icon})),
  itemRecipeRef:'button@1.0.0',selection:'single',selectedId:items.find(item=>item.slot===selectedSlot)?'inventory-slot-'+selectedSlot:null,gapToken:'controlGap',
  inventory:{columns:grid.columns,rows:grid.rows,gap:grid.spacingX,details,appearance:'slots',...(scrollMode?{scrollMode}:{}),...(grid.cellWidth?{cellSize:grid.cellWidth}:{}),...(selectedSlot===null?{}:{initialSlot:selectedSlot})},
});

/** A narrow catalog derived from the actual upstream inventory recipe. */
export function inventoryPlanningCatalog(config){
  if(config){validateInventoryActionConfig(config);return structuredClone(config.inventoryPlanning.catalog);}
  const catalog=structuredClone(upstreamCatalog),recipe=catalog.recipes.find(row=>row.id+'@'+row.version===capabilities.recipeKey&&row.kind==='inventory-row');
  const textRecipe=catalog.recipes.find(row=>row.kind==='text-row');
  if(!recipe||!textRecipe||!catalog.themes.length)fail('catalog','上游目录缺少已接入版本的 inventory-row 与基础文本能力。');
  // Context 0.12's public verifier requires the controls envelope. An original
  // text-row recipe enables that upstream capability; this consumer still
  // explicitly rejects additional Text rows rather than discarding them.
  return {...catalog,id:'chain-inventory-planning',themes:[catalog.themes[0]],recipes:[recipe,textRecipe]};
}

// Reserve the maximum upstream quantity before asking the model for content.
// Fixing cellSize afterwards makes width/height/scroll independent of item count
// and quantity digits; no returned intent is repaired into another geometry.
function programGrid(ctx,layout,chosen){
  const fixed=layout.scrollMode===inventoryScrollMode;
  shape(chosen,fixed);
  const details=layout.orientations[ctx.orientation]?.details;
  if(!details)fail('orientation','请先选择 16:9 或 9:16 画布。');
  const compile=props=>{try{return inventoryContentDocument(ctx,{title:'仓库',props},layout);}catch(error){if(fixed&&error.code==='inventory.grid-size')fail('grid',error.message);throw error;}};
  const probe={...chosen,spacingX:layout.gap},props=propsFor(probe,details,[{slot:0,name:'仓库',quantity:9999,icon:null}],null,true,layout.scrollMode);
  const document=compile(props),list=document.nodes.find(node=>node.id==='inventory-grid');
  const cell=inventoryLayout(ctx.profile,list.props,list.size.width,list.size.height,ctx.skinGeometry).cell;
  const size=Math.max(48,fixed?Math.max(layout.cellTarget,cell.minimum):cell.width),grid={rows:chosen.rows,columns:chosen.columns,cellWidth:size,cellHeight:size,spacingX:layout.gap,spacingY:layout.gap,padding:0,startCorner:'upper-left',startAxis:'horizontal'};
  if(fixed)try{assertInventoryGridLimits(grid);}catch{fail('grid','当前皮肤所需的固定格子超出 144 格或 4000 像素网格预算，请减少行列。');}
  compile(propsFor(grid,details,[{slot:0,name:'仓库',quantity:9999,icon:null}],null,true,layout.scrollMode));
  return grid;
}

/** Freeze the actual consumer geometry/capabilities alongside the AI plan. */
export function inventoryActionConfig(baseConfig,ctx){
  if(!ctx||!['landscape','portrait'].includes(ctx.orientation))fail('orientation','请先选择 16:9 或 9:16 画布。');
  const chosen=shape(ctx.grid===undefined?{columns:inventoryPanelConfig.columns,rows:inventoryPanelConfig.rows}:ctx.grid),layout=inventoryLayoutConfig(),catalog=inventoryPlanningCatalog(),theme=catalog.themes[0];
  return {
    ...structuredClone(baseConfig),intentVersion:capabilities.intentVersion,themeKey:theme.id+'@'+theme.version,
    recipes:{[capabilities.recipeKey]:{kind:'inventory',recipe:'list'}},
    presets:{inventory:{surface:'panel',maxFields:1,maxActions:0,kinds:['inventory'],dismissOnEmit:false}},
    inventoryPlanning:{kind:'ui_chain_inventory_planning',version:'1.1',orientation:ctx.orientation,catalog,layout,programGrid:programGrid(ctx,layout,chosen),capabilities:structuredClone(capabilities)},
  };
}

/** Recheck frozen plan data without replacing it with mutable current defaults. */
export function validateInventoryActionConfig(config,ctx){
  const policy=config?.inventoryPlanning,grid=policy?.programGrid;
  const fixed=policy?.version==='1.1',expectedCapabilities=fixed?capabilities:legacyCapabilities;
  if(config?.version!=='1.0'||config.intentVersion!=='0.13'||!exact(policy,['kind','version','orientation','catalog','layout','programGrid','capabilities'])||policy.kind!=='ui_chain_inventory_planning'||!['1.0','1.1'].includes(policy.version)||!['landscape','portrait'].includes(policy.orientation)||!same(policy.capabilities,expectedCapabilities)||policy.layout?.version!==(fixed?'1.2':'1.1'))fail('config','库存规划配置不受当前转换器支持。');
  if(!same(config.presets,{inventory:{surface:'panel',maxFields:1,maxActions:0,kinds:['inventory'],dismissOnEmit:false}})||!same(config.recipes,{[capabilities.recipeKey]:{kind:'inventory',recipe:'list'}}))fail('config','库存配方与控件能力必须显式匹配。');
  validateInventoryLayoutConfig(policy.layout);
  const catalog=policy.catalog,theme=catalog?.themes?.[0];
  if(catalog?.id!=='chain-inventory-planning'||catalog.catalogVersion!=='0.1'||catalog.themes?.length!==1||catalog.recipes?.length!==2||catalog.recipes[0].kind!=='inventory-row'||catalog.recipes[0].id+'@'+catalog.recipes[0].version!==capabilities.recipeKey||catalog.recipes[1].kind!=='text-row'||config.themeKey!==theme?.id+'@'+theme?.version)fail('catalog','库存规划必须保留授权计划中的专用目录与主题。');
  if(!exact(grid,gridKeys)||!same(shape({columns:grid.columns,rows:grid.rows},fixed),{columns:grid.columns,rows:grid.rows})||!Number.isInteger(grid.cellWidth)||grid.cellWidth<48||grid.cellWidth>256||grid.cellHeight!==grid.cellWidth||grid.spacingX!==policy.layout.gap||grid.spacingY!==grid.spacingX||grid.padding!==0||grid.startCorner!=='upper-left'||grid.startAxis!=='horizontal')fail('grid','库存只支持计划冻结的方格、等距、左上逐行布局。');
  if(fixed)try{assertInventoryGridLimits(grid);}catch{fail('grid','库存固定格子超出总格数或网格尺寸预算。');}
  if(ctx){
    if(ctx.orientation!==policy.orientation)fail('orientation','库存规划与当前选定画布不一致。');
    if(!same(grid,programGrid(ctx,policy.layout,{columns:grid.columns,rows:grid.rows})))fail('geometry','当前皮肤或画布无法复现计划冻结的格子几何；请重新准备计划。');
  }
  return structuredClone(config);
}

/** Convert supported inventory intent to the existing PixiUI List runtime. */
export async function inventoryPresetFromIntent(sessionInput,intentInput,config,presetId,ctx){
  validateInventoryActionConfig(config,ctx);
  if(presetId!=='inventory')fail('preset','库存转换器仅接受 inventory 预设。');
  const {session,intent}=await validateSettingsResponse(sessionInput,intentInput),policy=config.inventoryPlanning;
  if(!same(session.context.catalog,policy.catalog)||session.context.planningContextVersion!=='0.12'||intent.panelIntentVersion!=='0.13')fail('protocol','库存意图必须绑定授权计划的 context 0.12 / intent 0.13。');
  if(!intent.panel||intent.unresolved.length)fail('unresolved','请先解决库存规划中的问题。');
  const panel=intent.panel,section=panel.body?.children?.[0],row=section?.rows?.[0];
  if(panel.themeKey!==config.themeKey||panel.panelSurface!==null)fail('theme','库存素材与皮肤需要显式映射。');
  if(!same(panel.layout,{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'error'}))fail('layout','面板尺寸由程序计算；意图尺寸须为空，overflow:error。');
  if(panel.body.kind!=='column'||panel.body.children.length!==1||section.kind!=='section'||section.actionLayout!==null||section.rows.length!==1||row.kind!=='inventory'||row.recipeKey!==capabilities.recipeKey||row.sourceRef!=='request'||row.icon!==null)fail('unsupported','库存仅支持一个分组中的一个 inventory 行，不支持附加控件、动作或行图标。');
  if(!same(row.grid,policy.programGrid))fail('grid','模型网格必须逐字段等于 programGrid；不能更改行列、格子尺寸、间距或排列方向。');
  const occupied=new Set();
  for(const item of row.items){
    if(!exact(item,['slot','name','quantity','icon'])||!Number.isInteger(item.slot)||item.slot<0||item.slot>=row.grid.rows*row.grid.columns||occupied.has(item.slot))fail('slot','物品格位必须唯一且位于已选仓库内。');
    if(typeof item.name!=='string'||!item.name.trim()||item.name.length>64||/[\p{Cc}\p{Cs}]/u.test(item.name))fail('name','物品名称须为 1–64 个 UTF-16 字符的可读纯文字。');
    if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>9999)fail('quantity','物品数量必须为 1–9999 的整数。');
    if(item.icon!==null)fail('icon','当前库存模型路径未接入固定图片资产；图标必须为 null，不能替换成程序例图。');
    occupied.add(item.slot);
  }
  if(row.selectedSlot!==null&&(!Number.isInteger(row.selectedSlot)||row.selectedSlot<0||row.selectedSlot>=row.grid.rows*row.grid.columns))fail('selection','初始选择格位必须位于仓库内或为 null。');
  const details=policy.layout.orientations[ctx.orientation].details,props=propsFor(row.grid,details,row.items,row.selectedSlot,row.enabled,policy.layout.scrollMode),document=inventoryContentDocument(ctx,{title:panel.title,sectionTitle:section.title,label:row.label,props},policy.layout),derived=inventoryPresetContext(ctx),list=document.nodes.find(node=>node.id==='inventory-grid'),actual=inventoryLayout(ctx.profile,list.props,list.size.width,list.size.height,ctx.skinGeometry);
  if(actual.cell.width!==row.grid.cellWidth||actual.cell.height!==row.grid.cellHeight)fail('geometry','渲染几何与规划格子尺寸不一致。');
  // Selection stays local List state. No invented game actions or descriptions.
  return {
    content:{version:'1.0',presetId:'inventory',id:panel.id,title:panel.title,sectionTitle:section.title,label:row.label,columns:row.grid.columns,rows:row.grid.rows,items:structuredClone(row.items),selectedSlot:row.selectedSlot,enabled:row.enabled,sampleData:false,iconSource:'none-name-fallback',fields:[],actions:[]},
    behavior:{version:'1.0',fields:[],actions:[],dismissOnEmit:false},documents:{[ctx.orientation]:document},
    provenance:{source:'planning/v1',contextSha256:session.context.sha256,sessionSha256:session.sha256,intentVersion:intent.panelIntentVersion,skinSha256:derived.binding.sha256,automaticRetries:0},
  };
}
