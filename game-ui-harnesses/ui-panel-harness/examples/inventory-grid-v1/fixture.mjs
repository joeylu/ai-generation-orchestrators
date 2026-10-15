import {DEFAULT_GRID} from '../../src/uniform-grid.mjs';
export const request={requestVersion:'0.1',id:'inventory-ten',target:'pixi',text:'帮我生成一个10X10的仓库面板'};
export function inventoryIntent(context,{rows=10,columns=10,items=[],selectedSlot=null,enabled=true,grid={},layout={}}={}){
 const theme=context.catalog.themes[0];
 return {panelIntentVersion:'0.13',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'仓库',themeKey:theme.id+'@'+theme.version,panelSurface:null,
  layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto',...layout},
  body:{kind:'column',children:[{kind:'section',title:'仓库',actionLayout:null,rows:[{kind:'inventory',label:'仓库',recipeKey:'inventory.grid@0.1.0',sourceRef:'request',icon:null,enabled,grid:{...DEFAULT_GRID,rows,columns,...grid},items,selectedSlot}]}]}}};
}
