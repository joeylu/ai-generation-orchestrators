// One optional List presentation. Item records remain authored data; selection
// is local play state. These sample icons never identify assets in a skin pack.
export const inventoryIcons=Object.freeze(['gem','potion','coin','material','scroll','sword','shield','food']);
export const inventoryScrollMode='fixed-cells-both-v1';
export const inventoryGridLimits=Object.freeze({maxAxis:32,maxCells:144,maxDimension:4000,minCell:48,maxCell:256,maxSpacing:64});
const legacyInventorySchema={type:'object',additionalProperties:false,properties:{columns:{type:'integer',enum:[10]},rows:{type:'integer',enum:[10]},gap:{type:'integer',minimum:0,maximum:32},details:{type:'string',enum:['right','below']}},required:['columns','rows','gap','details']};
const previousInventorySchema={type:'object',additionalProperties:false,properties:{columns:{type:'integer',minimum:1,maximum:10},rows:{type:'integer',minimum:1,maximum:10},gap:{type:'integer',minimum:0,maximum:32},details:{type:'string',enum:['right','below']},appearance:{type:'string',enum:['slots']}},required:['columns','rows','gap','details']};
const previousIconSchema={type:'string',enum:[...inventoryIcons]};
const previousAiInventorySchema={...previousInventorySchema,properties:{...previousInventorySchema.properties,cellSize:{type:'integer',minimum:48,maximum:256},initialSlot:{type:'integer',minimum:0,maximum:99}}};
const previousSlotSchema={type:'integer',minimum:0,maximum:99};
export const inventoryPropsSchema=Object.freeze({...previousAiInventorySchema,properties:{...previousAiInventorySchema.properties,columns:{type:'integer',minimum:1,maximum:32},rows:{type:'integer',minimum:1,maximum:32},gap:{type:'integer',minimum:0,maximum:64},initialSlot:{type:'integer',minimum:0,maximum:143},scrollMode:{type:'string',enum:[inventoryScrollMode]}}});
export const inventoryItemPropsSchema=Object.freeze({slotIndex:{type:'integer',minimum:0,maximum:143},quantity:{type:'integer',minimum:1,maximum:999999},description:{type:'string',maxLength:2048},icon:{type:['string','null'],enum:[...inventoryIcons,null]}});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const extras=Object.keys(inventoryItemPropsSchema);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

// Browser-safe mirror of the upstream uniform-grid numeric budget. The Chain
// still owns its own rendering and deliberately supports only square, row-major
// inventory cells. A shape-only call can precede the skin-derived cell size.
export function assertInventoryGridLimits(grid){
  if(!grid||![grid.columns,grid.rows].every(n=>Number.isInteger(n)&&n>=1&&n<=inventoryGridLimits.maxAxis))fail('inventory.grid','仓库行列须为 1–32 的整数。');
  const capacity=grid.columns*grid.rows;if(capacity>inventoryGridLimits.maxCells)fail('inventory.capacity','仓库总格数最多 144，不能通过缩小格子改变容量。');
  const fields=['cellWidth','cellHeight','spacingX','spacingY','padding'];
  if(!fields.some(key=>Object.hasOwn(grid,key)))return {columns:grid.columns,rows:grid.rows,capacity};
  for(const key of fields){const min=key.startsWith('cell')?48:0,max=key.startsWith('cell')?256:64;if(!Number.isInteger(grid[key])||grid[key]<min||grid[key]>max)fail('inventory.grid','固定格子须为 48–256，间距与内边距须为 0–64 的整数。');}
  const width=2*grid.padding+grid.columns*grid.cellWidth+(grid.columns-1)*grid.spacingX,height=2*grid.padding+grid.rows*grid.cellHeight+(grid.rows-1)*grid.spacingY;
  if(width>inventoryGridLimits.maxDimension||height>inventoryGridLimits.maxDimension)fail('inventory.grid-size','仓库自然宽高分别最多 4000；请明确调整格子尺寸、间距或行列。');
  return {columns:grid.columns,rows:grid.rows,capacity,width,height};
}

export function assertInventoryProps(props,{childIds=[],itemRecipeType}={}){
  const items=props.items??[];
  if(!Array.isArray(items))fail('inventory.item','List 条目必须是数组。');
  if(props.inventory===undefined){
    if(items.some(item=>extras.some(key=>Object.hasOwn(item,key))))fail('inventory.presentation','仓库物品字段需要显式 inventory 展示模式。');
    return;
  }
  const value=props.inventory;
  const both=value?.scrollMode===inventoryScrollMode,maxAxis=both?32:10,maxGap=both?64:32;
  if(!exact(value,['columns','rows','gap','details',...['appearance','cellSize','initialSlot','scrollMode'].filter(key=>Object.hasOwn(value??{},key))])||![value.columns,value.rows].every(number=>Number.isInteger(number)&&number>=1&&number<=maxAxis)||!Number.isInteger(value.gap)||value.gap<0||value.gap>maxGap||!['right','below'].includes(value.details)||(value.appearance!==undefined&&value.appearance!=='slots')||(value.scrollMode!==undefined&&!both)||(value.cellSize!==undefined&&(!Number.isInteger(value.cellSize)||value.cellSize<48||value.cellSize>256)))fail('inventory.layout',both?'新版仓库行列须为 1–32，间距 0–64；固定方格须为 48–256，并使用右侧或底部详情。':'旧版仓库行列须为 1–10，间距 0–32；双向固定格需要显式的新版本标记。');
  if(both)assertInventoryGridLimits({...value,...(value.cellSize===undefined?{}:{cellWidth:value.cellSize,cellHeight:value.cellSize,spacingX:value.gap,spacingY:value.gap,padding:0})});
  const capacity=value.columns*value.rows;
  if(childIds.length)fail('inventory.children','仓库展示不接受显式 List 子行。');
  if(itemRecipeType!==undefined&&itemRecipeType!=='Button')fail('inventory.recipe','仓库格子须使用 Button 条目配方。');
  if(items.length>capacity)fail('inventory.capacity',`${value.columns}×${value.rows} 仓库最多放置 ${capacity} 条单格物品。`);
  if(value.initialSlot!==undefined&&(!Number.isInteger(value.initialSlot)||value.initialSlot<0||value.initialSlot>=capacity))fail('inventory.selection','初始选中格位必须位于仓库内。');
  const ids=new Set(),slots=new Set();
  for(const item of items){
    if(item&&Object.keys(item).some(key=>!['id','label','enabled',...extras].includes(key)))fail('inventory.item','仓库物品只支持单格图标、名称、数量与说明，不接受多格占用或拖换字段。');
    if(!item||!extras.every(key=>Object.hasOwn(item,key))||!Number.isInteger(item.slotIndex)||item.slotIndex<0||item.slotIndex>=capacity||slots.has(item.slotIndex))fail('inventory.slot',`物品槽位须是唯一的 0–${capacity-1} 整数。`);
    if(typeof item.id!=='string'||!item.id||ids.has(item.id))fail('inventory.item','物品 ID 必须唯一且非空。');
    if(typeof item.label!=='string'||!item.label.trim()||item.label.length>64)fail('inventory.label','物品名称须为 1–64 个 UTF-16 字符的非空纯文字。');
    if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>999999)fail('inventory.quantity','物品数量须为 1–999999 的整数。');
    if(typeof item.description!=='string'||item.description.length>2048)fail('inventory.description','物品说明须为最多 2048 个 UTF-16 字符的纯文字。');
    if(item.icon!==null&&!inventoryIcons.includes(item.icon))fail('inventory.icon','物品图标须为 null 或已声明的程序示例图标；固定图片资产尚未接入。');
    slots.add(item.slotIndex);ids.add(item.id);
  }
  if(value.initialSlot!==undefined&&(items.find(item=>item.slotIndex===value.initialSlot)?.id??null)!==(props.selectedId??null))fail('inventory.selection','初始格位与选中物品 ID 不一致。');
}

const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
export function upgradeInventoryRegistry(registry){
  if(!Array.isArray(registry?.recipes))fail('inventory.registry','缺少可派生的组件合同。');
  const next=structuredClone(registry),recipes=next.recipes.filter(recipe=>recipe.type==='List');
  if(!recipes.length)fail('inventory.registry','组件合同缺少 List。');
  const add=(properties,key,schema)=>{
    if(Object.hasOwn(properties,key)&&stable(properties[key])!==stable(schema))fail('inventory.registry',`已有 ${key} 合同与仓库展示不兼容。`);
    if(!Object.hasOwn(properties,key))properties[key]=structuredClone(schema);
  };
  for(const recipe of recipes){
    const properties=recipe.propsSchema?.properties,itemProperties=properties?.items?.items?.properties;
    if(!properties||!itemProperties||properties.items.items.additionalProperties!==false)fail('inventory.registry','List 缺少可扩展的严格条目合同。');
    // Only the exact first inventory declaration is a known migration. Keep
    // original source bytes/bindings and reject unrelated schema conflicts.
    if([legacyInventorySchema,previousInventorySchema,previousAiInventorySchema].some(schema=>stable(properties.inventory)===stable(schema)))properties.inventory=structuredClone(inventoryPropsSchema);
    else add(properties,'inventory',inventoryPropsSchema);
    for(const [key,schema]of Object.entries(inventoryItemPropsSchema)){
      if(key==='icon'&&stable(itemProperties.icon)===stable(previousIconSchema)||key==='slotIndex'&&stable(itemProperties.slotIndex)===stable(previousSlotSchema))itemProperties[key]=structuredClone(schema);
      else add(itemProperties,key,schema);
    }
  }
  return next;
}
