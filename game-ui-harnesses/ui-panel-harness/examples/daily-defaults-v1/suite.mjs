import {COMMON_GAME_PANEL_SUITE,commonGamePanelFixture} from '../common-game-panels-v1/suite.mjs';
/** Eight unchanged short requests, now against the full daily catalog and builtin icons. */
const ids=['G03','G05','G06','G17','G22','G25','G49','G54'];
export const DAILY_DEFAULT_SUITE=Object.freeze(ids.map(id=>{
 const item=COMMON_GAME_PANEL_SUITE.find(item=>item.id===id);if(!item)throw Error('DAILY_DEFAULT_CASE');
 return Object.freeze({...item,dailyDefault:true});
}));
export const DAILY_CHOICE_FIX_SOURCE_PLAN_SHA256='054e3b9b8b9f219b7eb1c714a0c0b5952240b5d5c3865abe89168862ef828faf';
export const DAILY_CHOICE_FIX_SUITE=Object.freeze(['G22','G03','G17','G25'].map(id=>DAILY_DEFAULT_SUITE.find(item=>item.id===id)));
/** Offline transport specimen only. The live model receives no fixture answers. */
export function dailyDefaultFixture(context,item,referenceIntent){
 const intent=commonGamePanelFixture(context,item,referenceIntent);
 if(item.id==='G54'){
  const visit=node=>{if(node.kind==='section'){for(const row of node.rows)if(row.kind==='text')row.recipeKey='message.text@0.2.0';}else for(const child of node.children??[])visit(child);};
  visit(intent.panel.body);
 }
 return intent;
}
