import {measureUniformGrid,MAX_GRID_CELLS} from './uniform-grid.mjs';
export const hasInventory = spec=>spec?.sections?.some(section=>section.rows.some(row=>row.kind==='inventory'));
export const inventorySlotId = slot=>'slot'+slot;
export const inventoryCellId = (control,slot)=>control+'.slot.'+slot;
export const inventoryMarkerId = (control,slot)=>inventoryCellId(control,slot)+'.selected';
const asset=/^[a-z][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}@\d+\.\d+\.\d+$(?![\s\S])/u;
export function checkInventory(row,field,fail,path){
  let geometry;try{geometry=measureUniformGrid(row.grid);}catch(error){fail('inventory-grid',path+'.grid',error.message);}
  if(!Array.isArray(row.items)||row.items.length>geometry.count)fail('inventory-items',path+'.items','Sparse items must fit the declared capacity');
  const occupied=new Set();
  for(const [index,item]of row.items.entries()){
    const p=path+'.items['+index+']';
    if(!item||Object.getPrototypeOf(item)!==Object.prototype||Object.keys(item).sort().join('|')!=='icon|name|quantity|slot')fail('inventory-item',p,'Expected slot, name, quantity and icon');
    if(!Number.isInteger(item.slot)||item.slot<0||item.slot>=geometry.count||occupied.has(item.slot))fail('inventory-slot',p+'.slot','Slot indices must be unique and in range');
    occupied.add(item.slot);
    if(typeof item.name!=='string'||!item.name.trim()||[...item.name].length>120||/[\p{Cc}\p{Cs}]/u.test(item.name))fail('inventory-name',p+'.name','Item name must be readable text');
    if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>9999)fail('inventory-quantity',p+'.quantity','Quantity must be 1..9999');
    if(item.icon!==null&&(typeof item.icon!=='string'||!asset.test(item.icon)))fail('inventory-icon',p+'.icon','Expected a pinned asset key or null');
  }
  const options=inventoryOptions(row);
  if(field&&(field.type!=='enum'||JSON.stringify(field.options)!==JSON.stringify(options)))fail('inventory-state',path+'.bind','Selection options must exactly cover none and every slot');
  return geometry;
}
export function inventoryOptions(row){return [{id:'none',label:'未选择'},...Array.from({length:row.grid.rows*row.grid.columns},(_,slot)=>({id:inventorySlotId(slot),label:'格子'+(slot+1)}))];}
export function inventoryGridSchema(assetSchema){
  const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
  const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
  return {grid:object({rows:integer(1,32),columns:integer(1,32),cellWidth:integer(48,256),cellHeight:integer(48,256),spacingX:integer(0,64),spacingY:integer(0,64),padding:integer(0,64),startCorner:{type:'string',enum:['upper-left','upper-right','lower-left','lower-right']},startAxis:{type:'string',enum:['horizontal','vertical']}}),
    items:{type:'array',minItems:0,maxItems:MAX_GRID_CELLS,items:object({slot:integer(0,MAX_GRID_CELLS-1),name:{type:'string',minLength:1,maxLength:120},quantity:integer(1,9999),icon:assetSchema})},
    selectedSlot:{anyOf:[{type:'null'},integer(0,MAX_GRID_CELLS-1)]}};
}

/** Composite lowering uses only the existing foundation components. */
export function compileInventory({row,id,rect,state,t,node,text,style,image,assets,fail}){
  const grid=measureUniformGrid(row.grid),items=new Map(row.items.map(item=>[item.slot,item]));
  if(grid.width>rect.width+.01)fail('INVENTORY_GRID_FIT','$.layout','Fixed cells need their declared width; do not collapse the column count');
  const cells=grid.cells.map(cell=>{
    const cellId=inventoryCellId(id,cell.slot),item=items.get(cell.slot),inside=[];
    inside.push(node(cellId,'Button',{x:2,y:2,width:cell.width-4,height:cell.height-4},{label:'',enabled:row.enabled,style:style(t.control,{cornerRadius:6})},[]));
    if(item?.icon){const record=assets.get(item.icon);if(!record)fail('INVENTORY_ICON','$.assets','Pinned inventory artwork is missing');inside.push(image(cellId+'.icon',record,{x:8,y:6,width:cell.width-16,height:cell.height-24},null,false));}
    else if(item){const name=text(cellId+'.name',item.name,{x:8,y:Math.max(4,(cell.height-42)/2),width:cell.width-16,height:24},18);name.props.overflow='ellipsis';inside.push(name);}
    if(item){const label=String(item.quantity);if(label.length*14.4>cell.width-12)fail('INVENTORY_QUANTITY_FIT','$.sections','Quantity must remain readable within its cell');inside.push(text(cellId+'.quantity',label,{x:6,y:cell.height-27,width:cell.width-12,height:24},18,t.text,'bold'));}
    inside.push(node(inventoryMarkerId(id,cell.slot),'ProgressBar',{x:6,y:cell.height-6,width:cell.width-12,height:4},{value:state[row.bind]===inventorySlotId(cell.slot)?1:0,max:1,style:style(t.control,{borderColor:t.accent,borderWidth:0,cornerRadius:2})}));
    return node(cellId+'.panel','Panel',{x:cell.x,y:cell.y,width:cell.width,height:cell.height},{title:'',style:style(t.control,{borderWidth:1,cornerRadius:8})},inside);
  });
  return node(id,'Container',{...rect,width:grid.width,height:grid.height},{drawBackground:false,style:style(t.surface)},cells);
}
