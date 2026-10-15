// Explicit offline producer for protocol/consumer regression fixtures only.
import {validateInventoryActionConfig} from './inventory-intent.mjs';
export function inventoryIntentFixture(session,config,{title='仓库',sectionTitle=title,label=sectionTitle,items=[],selectedSlot=null,enabled=true}={}){
  validateInventoryActionConfig(config);
  return {panelIntentVersion:'0.13',contextSha256:session.context.sha256,unresolved:[],panel:{id:session.context.request.id,title,themeKey:config.themeKey,panelSurface:null,
    layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'error'},
    body:{kind:'column',children:[{kind:'section',title:sectionTitle,actionLayout:null,rows:[{kind:'inventory',label,recipeKey:config.inventoryPlanning.capabilities.recipeKey,sourceRef:'request',icon:null,enabled,grid:structuredClone(config.inventoryPlanning.programGrid),items:structuredClone(items),selectedSlot}]}]}}};
}
