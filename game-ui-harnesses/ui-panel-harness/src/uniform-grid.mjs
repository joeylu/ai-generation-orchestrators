/** Fixed cells, explicit row/column capacity. Independent of inventory and renderers. */
export const MAX_GRID_CELLS = 144;
export const DEFAULT_GRID = Object.freeze({rows:5,columns:6,cellWidth:72,cellHeight:72,spacingX:8,spacingY:8,padding:8,startCorner:'upper-left',startAxis:'horizontal'});
export function measureUniformGrid(grid) {
  const keys=Object.keys(DEFAULT_GRID).sort();
  if(!grid||Object.getPrototypeOf(grid)!==Object.prototype||Object.keys(grid).sort().join('|')!==keys.join('|'))throw Error('GRID_FIELDS');
  for(const [key,min,max]of [['rows',1,32],['columns',1,32],['cellWidth',48,256],['cellHeight',48,256],['spacingX',0,64],['spacingY',0,64],['padding',0,64]])
    if(!Number.isInteger(grid[key])||grid[key]<min||grid[key]>max)throw Error('GRID_'+key.toUpperCase());
  const count=grid.rows*grid.columns;
  if(count>MAX_GRID_CELLS)throw Error('GRID_CAPACITY');
  if(!['upper-left','upper-right','lower-left','lower-right'].includes(grid.startCorner)||!['horizontal','vertical'].includes(grid.startAxis))throw Error('GRID_ORDER');
  const width=2*grid.padding+grid.columns*grid.cellWidth+(grid.columns-1)*grid.spacingX;
  const height=2*grid.padding+grid.rows*grid.cellHeight+(grid.rows-1)*grid.spacingY;
  if(width>4000||height>4000)throw Error('GRID_SIZE');
  const cells=Array.from({length:count},(_,slot)=>{
    let row=grid.startAxis==='horizontal'?Math.floor(slot/grid.columns):slot%grid.rows;
    let column=grid.startAxis==='horizontal'?slot%grid.columns:Math.floor(slot/grid.rows);
    if(grid.startCorner.startsWith('lower'))row=grid.rows-1-row;
    if(grid.startCorner.endsWith('right'))column=grid.columns-1-column;
    return {slot,row,column,x:grid.padding+column*(grid.cellWidth+grid.spacingX),y:grid.padding+row*(grid.cellHeight+grid.spacingY),width:grid.cellWidth,height:grid.cellHeight};
  });
  return {width,height,count,cells};
}

/** Narrow literal guard for unambiguous dimensions; other language remains agent-owned. */
export function explicitInventoryDimensions(text) {
  if(!/(?:仓库|背包|物品栏|inventory|storage|warehouse)/iu.test(text))return null;
  const plain=text.replace(/“[^”]*”|「[^」]*」|"[^"\r\n]*"/gu,'');
  const pairs=[...plain.matchAll(/(?<!\d)(\d{1,6})\s*[xX×*＊]\s*(\d{1,6})(?!\d)/gu)].map(m=>({rows:Number(m[1]),columns:Number(m[2])}));
  for(const m of plain.matchAll(/(?<!\d)(\d{1,6})\s*行\s*[、，,]?\s*(\d{1,6})\s*列/gu))pairs.push({rows:Number(m[1]),columns:Number(m[2])});
  for(const m of plain.matchAll(/(?<!\d)(\d{1,6})\s*列\s*[、，,]?\s*(\d{1,6})\s*行/gu))pairs.push({rows:Number(m[2]),columns:Number(m[1])});
  const unique=new Map(pairs.map(pair=>[pair.rows+'x'+pair.columns,pair]));
  return unique.size===1?[...unique.values()][0]:null;
}
