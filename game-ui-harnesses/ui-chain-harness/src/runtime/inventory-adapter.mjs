import {Container,Graphics,Rectangle,Text} from 'pixi.js';
import {FancyButton} from '@pixi/ui';
import {makeButton,resizeButton,selectButtonSkin,OwnedScrollBox} from './controls.mjs';
import {fitText,reject} from './skin.mjs';
import {inventoryLayout,inventoryDetailLayout} from './inventory-geometry.mjs';
import {assertInventoryProps,inventoryIcons,inventoryScrollMode} from './inventory-policy.mjs';
import {inventoryExampleIcon} from './inventory-icons.mjs';
import {bestInk,rgb} from '../skins/text-readability.mjs';
import {createLayerSurface} from './layer-surface.mjs';
import {inventoryScrollbarChrome,clampInventoryScroll} from './inventory-scrollbars.mjs';
import {createInventoryScrollbars} from './inventory-scrollbars-view.mjs';

// Shift + an ordinary vertical wheel is an explicit horizontal gesture. Trackpad
// deltaX/deltaY and pointer dragging otherwise retain independent native axes.
class InventoryGridScrollBox extends OwnedScrollBox{
  onMouseScroll(event){super.onMouseScroll(event.shiftKey&&!event.deltaX?{deltaX:event.deltaY??0,deltaY:0}:event);}
}

export function inventoryListAdapter(c){
  const owned=[];
  try{return initializeInventoryList(c,view=>{owned.push(view);return view;});}
  catch(e){for(const view of owned.reverse())if(!view.destroyed)view.destroy({children:true});throw e;}
}

function initializeInventoryList(c,own){
  const {skin,p,w,h,listen,emit,handle,children}=c;
  const itemRecipeType=c.runtime.registry.recipes.find(recipe=>recipe.recipeId+'@'+recipe.recipeVersion===p.itemRecipeRef)?.type;
  assertInventoryProps(p,{childIds:children('items').map(child=>child.id),itemRecipeType});
  if(itemRecipeType!=='Button')reject('inventory.recipe','仓库格子须使用 Button 条目配方。');
  const modern=p.inventory.appearance==='slots',skinned=Boolean(c.surfaceLayer),options={surfaceLayer:c.surfaceLayer},both=p.inventory.scrollMode===inventoryScrollMode,capacity=p.inventory.columns*p.inventory.rows,
    view=own(new Container()),gridContent=own(new Container()),detailContent=own(new Container()),detailBackground=own(new Graphics()),
    gridBox=own(new (both?InventoryGridScrollBox:OwnedScrollBox)({type:both?'bidirectional':'vertical',width:1,height:1,globalScroll:false,disableEasing:true,padding:0})),
    detailsBox=own(new OwnedScrollBox({type:'vertical',width:1,height:1,globalScroll:false,disableEasing:true,padding:0})),
    items=new Map(p.items.map(item=>[item.slotIndex,item])),cells=[],rows=[],textBackings=new Map();
  gridBox.inputAllowed=detailsBox.inputAllowed=()=>handle.allowed();
  view.addChild(gridBox,detailBackground,detailsBox);
  const text=(value,wrap=false)=>own(new Text({text:value,style:skin.textStyle({wordWrap:wrap,breakWords:wrap,wordWrapWidth:1})}));
  const detailTitle=text(modern?'物品详情':'物品详情 · 示例'),detailName=text('',true),detailQuantity=text(''),detailSlot=text(''),detailDescription=text('',true),detailIcon=modern?own(new Container()):null,detailIcons=new Map();
  if(!skinned)for(const label of [detailTitle,detailName,detailQuantity,detailSlot,detailDescription])textBackings.set(label,skin.profile.palette.base);
  detailContent.addChild(detailTitle,detailName,detailQuantity,detailSlot,detailDescription);
  if(detailIcon){for(const kind of inventoryIcons){const icon=own(inventoryExampleIcon(kind,56));icon.visible=false;detailIcons.set(kind,icon);detailIcon.addChild(icon);}detailIcon.eventMode='none';detailContent.addChild(detailIcon);}
  let geometry=inventoryLayout(skin.profile,p,w,h,skin,options),selected=p.selectedId,selectedSlot=p.inventory.initialSlot??p.items.find(item=>item.id===selected)?.slotIndex??null;
  const gridSurface=skinned?createLayerSurface(skin,c.surfaceLayer,geometry.grid.surface.width,geometry.grid.surface.height):null,detailSurface=skinned?createLayerSurface(skin,'content',geometry.details.width,geometry.details.height):null;
  if(gridSurface){own(gridSurface.view);own(detailSurface.view);view.addChildAt(gridSurface.view,0);view.addChildAt(detailSurface.view,view.getChildIndex(detailsBox));detailBackground.visible=false;}
  const scrollbars=skinned?createInventoryScrollbars({skin,view,box:gridBox,listen,allowed:()=>handle.allowed(),own}):null;

  function detail(){
    const item=selectedSlot===null?null:items.get(selectedSlot),inner=geometry.details.contentWidth,line=geometry.lineHeight;
    detailName.text=item?.label??(selectedSlot===null?'未选择物品':'空格');
    detailQuantity.text=item?'数量 '+item.quantity:(selectedSlot===null?'尚未选择':'空格');
    detailSlot.text=selectedSlot===null?p.inventory.columns+' × '+p.inventory.rows+' · '+capacity+' 格':'格位 '+(selectedSlot+1)+' / '+capacity;
    detailDescription.text=item?.description??(selectedSlot===null?'选择格位查看物品详情。':'此槽位尚未放置物品。');
    for(const label of [detailTitle,detailName,detailQuantity,detailSlot,detailDescription]){
      const width=label===detailName?geometry.detailName.width:inner;
      if(label===detailName||label===detailDescription)label.style.wordWrapWidth=width;
      fitText(label,width,1e9,'error');
    }
    const labels={title:detailTitle,name:detailName,quantity:detailQuantity,slot:detailSlot,description:detailDescription},metrics={};
    for(const [key,label]of Object.entries(labels)){metrics[key+'Width']=label.width;metrics[key+'Height']=label.height;}
    const boxes=inventoryDetailLayout(geometry,metrics);geometry.details.boxes=boxes;
    for(const [key,label]of Object.entries(labels))label.position.set(boxes[key].x,boxes[key].y);
    if(detailIcon){detailIcon.position.set(boxes.icon.x,boxes.icon.y);for(const [kind,icon]of detailIcons){icon.visible=kind===item?.icon;icon.scale.set(boxes.icon.size/32);}}
    detailContent.hitArea=new Rectangle(0,0,inner,Math.max(1,boxes.contentHeight));
    detailsBox.resize(true);detailsBox.scrollY=0;detailsBox.update();
  }

  const refresh=()=>{
    for(const cell of cells){
      const selected=cell.slotIndex===selectedSlot;
      if(!modern||skinned)selectButtonSkin(cell.button,skin,selected);
      if(cell.backgrounds)for(const [state,background]of Object.entries(cell.backgrounds)){
        background.scale.set(1);background.clear().roundRect(0,0,geometry.cell.width,geometry.cell.height,8).fill({color:selected||state==='hover'||state==='pressed'?skin.profile.palette.active:skin.profile.palette.base,alpha:state==='disabled'?.08:state==='pressed'?.28:selected?.18:state==='hover'?.15:cell.item?.13:.045});
      }
      const inset=selected&&modern?1:.5;
      cell.frame.clear().roundRect(inset,inset,geometry.cell.width-inset*2,geometry.cell.height-inset*2,modern?8:4).fill({color:skin.profile.palette.base,alpha:modern?0:.10}).stroke({color:selected?skin.profile.palette.active:skin.profile.palette.stroke,width:selected&&modern?2:1,alpha:selected?1:cell.item?.55:.22});
      cell.selectionMark.clear();
      if(selected&&modern){const x=geometry.cell.width-20;cell.selectionMark.roundRect(x,4,14,14,4).fill(skin.profile.palette.active).moveTo(x+3,11).lineTo(x+6,14).lineTo(x+11,8).stroke({color:bestInk(rgb(skin.profile.palette.active)),width:1.5});}
    }
    detail();
  };
  for(let slotIndex=0;slotIndex<capacity;slotIndex++){
    const item=items.get(slotIndex)??null,backgrounds=modern&&!skinned?Object.fromEntries(['default','hover','pressed','disabled'].map(state=>[state,own(new Graphics().roundRect(0,0,geometry.cell.width,geometry.cell.height,8).fill({color:skin.profile.palette.base,alpha:.05}))])):null,
      button=own(backgrounds?new FancyButton({defaultView:backgrounds.default,hoverView:backgrounds.hover,pressedView:backgrounds.pressed,disabledView:backgrounds.disabled,contentFittingMode:'none',padding:0}):makeButton(skin,'',geometry.cell.width,geometry.cell.height,'primary',['skin.item.normal','skin.item.selected'])),frame=own(new Graphics()),selectionMark=own(new Graphics()),
      icon=item?.icon?own(inventoryExampleIcon(item.icon,geometry.cell.iconSize)):null,name=item&&item.icon===null?text(item.label,true):null,nameBackground=name?own(new Graphics()):null,quantity=item?text(String(item.quantity)):null,quantityBackground=item?own(new Graphics()):null;
    button.enabled=item?.enabled!==false;
    frame.eventMode=selectionMark.eventMode='none';button.addChild(frame,selectionMark);
    if(icon)button.addChild(icon);
    if(name)button.addChild(nameBackground,name);
    if(quantity)button.addChild(quantityBackground,quantity);
    button.label='inventory-slot-'+slotIndex;
    const cell={slotIndex,itemId:item?.id??null,item,button,view:button,frame,selectionMark,backgrounds,icon,name,nameBackground,quantity,quantityBackground};
    if(name)textBackings.set(name,skin.profile.palette.base);
    if(quantity)textBackings.set(quantity,skin.profile.palette.base);
    cells.push(cell);rows.push(button);gridContent.addChild(button);
    listen(button.onPress,()=>{
      if(!handle.allowed()||p.selection!=='single'||item?.enabled===false)return;
      const next=item?.id??null,changed=selected!==next;
      selected=next;selectedSlot=slotIndex;refresh();
      // Empty slots clear selection; their slot index is transient local view
      // state and never becomes an authored item ID or additional state field.
      if(changed)emit('selectionChange',{selectedId:selected});
    });
  }
  // ScrollBox rejects unmeasured empty content. Add only after the real slot
  // views and detail Text exist; placement below then sets their full extent.
  gridBox.addItem(gridContent);detailsBox.addItem(detailContent);

  function place(width,height){
    geometry=inventoryLayout(skin.profile,p,width,height,skin,options);
    const {cell,grid,details,quantityBox}=geometry;
    const chrome=scrollbars?inventoryScrollbarChrome(geometry,{details:p.inventory.details,barWidth:skin.profile.geometry.scrollbarWidth,gap:skin.profile.geometry.scrollbarGap,minThumbLength:skin.profile.geometry.minThumbLength}):null;
    const viewport=chrome?.viewport??grid;
    gridBox.setSize(viewport.width,viewport.height);gridBox.position.set(grid.x,grid.y);
    if(gridSurface){gridSurface.resize(grid.surface.width,grid.surface.height);gridSurface.view.position.set(grid.surface.x,grid.surface.y);detailSurface.resize(details.width,details.height);detailSurface.view.position.set(details.x,details.y);}
    detailsBox.setSize(details.contentWidth,details.height-details.padding*2);detailsBox.position.set(details.x+details.padding,details.y+details.padding);
    detailBackground.clear().roundRect(details.x,details.y,details.width,details.height,modern?12:8).fill({color:skin.profile.palette.base,alpha:1}).stroke({color:skin.profile.palette.stroke,width:1,alpha:modern?.22:.8});detailBackground.eventMode='none';
    for(const entry of cells){
      const {button,icon,name,nameBackground,quantity,quantityBackground}=entry;
      if(!modern||skinned)resizeButton(button,skin,cell.width,cell.height,'');
      else button.hitArea=new Rectangle(0,0,cell.width,cell.height);
      button.position.set((entry.slotIndex%grid.columns)*(cell.width+grid.gap),Math.floor(entry.slotIndex/grid.columns)*(cell.height+grid.gap));
      if(icon)icon.position.set(cell.insets.left+(cell.contentWidth-cell.iconSize)/2,cell.insets.top+(cell.contentHeight-cell.iconSize)/2);
      if(name){
        name.text=entry.item.label;name.style.wordWrapWidth=cell.contentWidth-4;
        const height=Math.max(geometry.lineHeight,cell.contentHeight-geometry.lineHeight-4);
        fitText(name,cell.contentWidth-4,height,'ellipsis');
        name.position.set(cell.insets.left+(cell.contentWidth-name.width)/2,cell.insets.top+(height-name.height)/2);
        nameBackground.clear().roundRect(name.x-2,name.y,name.width+4,name.height,4).fill({color:skin.profile.palette.base,alpha:1});nameBackground.eventMode='none';
      }
      if(quantity){
        fitText(quantity,quantityBox.width-4,quantityBox.height,'error');
        quantity.position.set(cell.width-cell.insets.right-quantity.width-2,quantityBox.y+(quantityBox.height-quantity.height)/2);
        quantityBackground.clear().roundRect(quantity.x-2,quantityBox.y,quantity.width+4,quantityBox.height,modern?6:3).fill({color:skin.profile.palette.base,alpha:1});quantityBackground.eventMode='none';
      }
    }
    gridContent.hitArea=new Rectangle(0,0,grid.contentWidth,grid.contentHeight);
    gridBox.resize(true);
    if(chrome){const clamped=clampInventoryScroll({x:gridBox.scrollX,y:gridBox.scrollY},chrome);gridBox.scrollX=clamped.x;gridBox.scrollY=clamped.y;}
    else{if(both)gridBox.scrollX=Math.max(Math.min(0,grid.width-grid.contentWidth),Math.min(0,gridBox.scrollX));gridBox.scrollY=Math.max(Math.min(0,grid.height-grid.contentHeight),Math.min(0,gridBox.scrollY));}
    gridBox.update();scrollbars?.setGeometry(chrome);
    view.hitArea=new Rectangle(0,0,width,height);refresh();
  }
  place(w,h);
  return {
    view,cells,rows,gridBox,detailsBox,gridSurface,detailSurface,scrollbars,detailTitle,detailName,detailDescription,detailQuantity,detailSlot,detailIcon,textBackings,
    get geometry(){return geometry;},get selectedSlot(){return selectedSlot;},
    resize:place,
    afterLayout(){gridBox.resize(true);detailsBox.resize(true);scrollbars?.sync();},
    suspend(){scrollbars?.suspend();},
    state:()=>({selectedId:selected}),
    setState(state){
      if(state.selectedId!==null&&!p.items.some(item=>item.id===state.selectedId))reject('inventory.selection','选中物品不存在。');
      selected=state.selectedId;selectedSlot=p.items.find(item=>item.id===selected)?.slotIndex??null;refresh();
    },
  };
}
