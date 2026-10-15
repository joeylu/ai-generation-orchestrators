import {assertInventoryProps,inventoryScrollMode,assertInventoryGridLimits} from './inventory-policy.mjs';
import {textProfile} from './text-style.mjs';
import {skinUsage} from '../skins/usage.mjs';

const fail=message=>{throw Object.assign(new Error(message),{code:'inventory.geometry'});};
const sides=['left','right','top','bottom'];
// Accept the verified JSON evidence used by offline compilation, or its loaded
// skin. Both expose the same logical insets and declared/slice minimums.
export function inventorySkinMetrics(profile,source){
  const pads=[],minimums=[];
  for(const role of ['skin.item.normal','skin.item.selected']){
    const assetId=source?.roles instanceof Map?source.roles.get(role):source?.roles?.find(binding=>binding.role===role)?.assetId;
    const meta=source?.metadata instanceof Map?source.metadata.get(assetId):source?.assets?.find(asset=>asset.assetId===assetId);
    if(source&&!meta)fail(`缺少经过核验的仓库格子皮肤 ${role}。`);
    const usage=meta?.nineSlice?skinUsage(meta,meta.width,meta.height,source?.scale??1):null;
    const pad=source?.insets?source.insets(role):usage?.contentInsets??{left:profile.padding,right:profile.padding,top:0,bottom:0};
    if(sides.some(key=>!Number.isFinite(pad[key])||pad[key]<0))fail('格子皮肤安全区无效。');
    pads.push(pad);
    const border=usage?.borders??(meta?.slice?{left:meta.slice,right:meta.slice,top:meta.slice,bottom:meta.slice}:{left:0,right:0,top:0,bottom:0});
    minimums.push({width:Math.max(meta?.minSize?.width??1,border.left+border.right+1),height:Math.max(meta?.minSize?.height??1,border.top+border.bottom+1)});
  }
  return {insets:Object.fromEntries(sides.map(key=>[key,Math.max(...pads.map(pad=>pad[key]))])),minSize:{width:Math.max(...minimums.map(value=>value.width)),height:Math.max(...minimums.map(value=>value.height))}};
}

function measurements(profile,props,skin){
  assertInventoryProps(props);
  if(!props.inventory)fail('缺少显式仓库展示。');
  const s=textProfile(profile,props),safe=inventorySkinMetrics(s,skin),pad=safe.insets,lineHeight=s.geometry.lineHeight,
    modern=props.inventory.appearance==='slots',both=props.inventory.scrollMode===inventoryScrollMode,columns=props.inventory.columns,rows=props.inventory.rows,
    iconSize=modern?Math.max(36,Math.min(44,Math.ceil(s.fontSize*2.5))):Math.max(20,Math.ceil(s.fontSize*1.5)),digits=Math.max(1,...props.items.map(item=>String(item.quantity).length)),quantityWidth=Math.ceil(digits*s.fontSize*.72)+4,
    content=Math.max(iconSize,lineHeight,quantityWidth),nameHeight=props.items.some(item=>item.icon===null)?lineHeight*2+4:0,requiredSide=Math.ceil(Math.max(safe.minSize.width,safe.minSize.height,pad.left+pad.right+content,pad.top+pad.bottom+Math.max(content,nameHeight))),side=props.inventory.cellSize??Math.max(both?48:0,requiredSide),
    gridMinimum=side*columns+props.inventory.gap*(columns-1),detailPadding=Math.max(modern?16:12,s.padding),detailGap=Math.max(modern?20:8,s.geometry.labelGap),
    detailWidth=Math.ceil(Math.max(modern?250:168,s.fontSize*(modern?10:9)+detailPadding*2)),detailHeight=Math.ceil(Math.max(modern?220:0,detailPadding*2+lineHeight*5+16)),
    viewportMinimum=both?side:gridMinimum,
    minimum=props.inventory.details==='right'?{width:viewportMinimum+detailGap+detailWidth,height:Math.max(side,detailHeight)}:{width:Math.max(viewportMinimum,detailWidth),height:side+detailGap+detailHeight};
  if(side<requiredSide)fail(`固定方格 ${side} 小于皮肤、字号与数量所需的 ${requiredSide}；请增大方格或恢复皮肤字号。`);
  if(both)assertInventoryGridLimits({columns,rows,cellWidth:side,cellHeight:side,spacingX:props.inventory.gap,spacingY:props.inventory.gap,padding:0});
  return {s,pad,side,iconSize,quantityWidth,lineHeight,gridMinimum,detailPadding,detailGap,detailWidth,detailHeight,minimum,modern,both,columns,rows};
}

export function inventoryMinimum(profile,props,skin){return measurements(profile,props,skin).minimum;}

export function inventoryLayout(profile,props,width,height,skin){
  const m=measurements(profile,props,skin),{minimum,pad}=m,below=props.inventory.details==='below',gap=props.inventory.gap;
  const {columns,rows,modern,both}=m;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<minimum.width-.01||height<minimum.height-.01)fail(`仓库至少需要 ${minimum.width}×${minimum.height} 逻辑像素；${columns} 列格子不能缩小皮肤或文字安全区。`);
  const gridWidth=below?width:width-m.detailGap-m.detailWidth,
    availableHeight=below?height-m.detailGap-m.detailHeight:height,
    side=both?m.side:props.inventory.cellSize??Math.floor(Math.max(m.side,Math.min(modern?Math.max(88,m.side):Infinity,(gridWidth-gap*(columns-1))/columns,(availableHeight-gap*(rows-1))/rows))),
    naturalWidth=side*columns+gap*(columns-1),naturalHeight=side*rows+gap*(rows-1),gridHeight=modern||below?Math.min(availableHeight,naturalHeight):availableHeight,
    viewportWidth=both?Math.min(gridWidth,naturalWidth):naturalWidth,
    groupWidth=below?viewportWidth:viewportWidth+m.detailGap+m.detailWidth,groupX=Math.floor((width-groupWidth)/2);
  if(!both&&naturalWidth>gridWidth+.01)fail(`${columns} 列格子超出仓库可用宽度。`);
  const scrollableX=naturalWidth>viewportWidth+.01,scrollableY=naturalHeight>gridHeight+.01;
  const grid={x:groupX,y:0,width:viewportWidth,height:gridHeight,contentWidth:naturalWidth,contentHeight:naturalHeight,columns,rows,gap,scrollable:scrollableX||scrollableY,...(both?{scrollableX,scrollableY}:{})};
  const detailWidth=below?(modern?Math.min(width,Math.max(m.detailWidth,viewportWidth)):width):m.detailWidth,
    details=below?{x:Math.floor((width-detailWidth)/2),y:gridHeight+m.detailGap,width:detailWidth,height:modern?m.detailHeight:height-gridHeight-m.detailGap}:{x:groupX+viewportWidth+m.detailGap,y:0,width:detailWidth,height:modern?Math.min(height,m.detailHeight):height};
  details.padding=m.detailPadding;details.contentWidth=details.width-m.detailPadding*2;details.scrollable=true;
  details.icon=modern?{x:0,y:m.lineHeight+12,size:Math.max(56,Math.min(72,Math.ceil(m.s.fontSize*3.5)))}:null;
  const nameX=modern?details.icon.size+12:0;
  const detailName={x:nameX,y:modern?details.icon.y:0,width:details.contentWidth-nameX,wrap:'word',scrollable:true};
  if(detailName.width<m.s.fontSize*2)fail('详情栏无法容纳图标和完整物品名称。');
  const cell={width:side,height:side,insets:pad,contentWidth:side-pad.left-pad.right,contentHeight:side-pad.top-pad.bottom,minimum:m.side,preferred:modern?Math.max(80,m.side):m.side,iconSize:m.iconSize};
  const quantityBox={x:side-pad.right-m.quantityWidth,y:side-pad.bottom-m.lineHeight,width:m.quantityWidth,height:m.lineHeight};
  return {minimum,cell,grid,details,detailName,quantityBox,lineHeight:m.lineHeight,capacity:columns*rows,naturalHeight:below?details.y+details.height:Math.max(grid.height,details.height)};
}

// Actual font metrics determine line wrapping, while one pure function owns
// the compact card's placement and its scrollable content extent.
export function inventoryDetailLayout(layout,metrics){
  const {details,lineHeight}=layout,width=details.contentWidth,h=key=>Math.max(lineHeight,metrics[key+'Height']??0),boxes={};
  boxes.title={x:0,y:0,width,height:h('title')};
  if(!details.icon){
    let y=boxes.title.height+8;
    for(const key of ['name','quantity','slot','description']){boxes[key]={x:0,y,width,height:h(key)};y+=boxes[key].height+8;}
    return {...boxes,contentHeight:y-8};
  }
  boxes.icon={...details.icon,y:boxes.title.height+12};
  boxes.name={x:layout.detailName.x,y:boxes.icon.y+Math.max(0,(boxes.icon.size-h('name'))/2),width:layout.detailName.width,height:h('name')};
  const metaY=Math.max(boxes.icon.y+boxes.icon.size,boxes.name.y+boxes.name.height)+12;
  boxes.quantity={x:0,y:metaY,width,height:h('quantity')};
  const inline=(metrics.quantityWidth??width)+(metrics.slotWidth??width)+16<=width;
  boxes.slot={x:inline?width-(metrics.slotWidth??0):0,y:inline?metaY:metaY+boxes.quantity.height+8,width,height:h('slot')};
  boxes.description={x:0,y:Math.max(boxes.quantity.y+boxes.quantity.height,boxes.slot.y+boxes.slot.height)+12,width,height:h('description')};
  return {...boxes,contentHeight:boxes.description.y+boxes.description.height};
}
