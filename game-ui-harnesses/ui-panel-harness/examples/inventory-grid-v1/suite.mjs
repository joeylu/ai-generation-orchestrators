import {request,inventoryIntent} from './fixture.mjs';
const entries=[
 {id:'I01',text:'帮我生成一个10X10的仓库面板',rows:10,columns:10},
 {id:'I02',text:'做个8行6列的背包',rows:8,columns:6},
 {id:'I03',text:'生成一个仓库面板',rows:5,columns:6},
 {id:'I04',text:'做个20×20仓库',clarification:{question:'当前最多支持144格，请确认改成多少行、多少列？',questionPattern:'144|容量|行|列|格|尺寸'}}
];
export const INVENTORY_GRID_SUITE=Object.freeze(entries.map(entry=>Object.freeze({id:entry.id,operation:'generate',category:'inventory-grid',designArm:'common-draft',request:{...request,id:entry.id,text:entry.text},
 ...(entry.clarification?{clarification:entry.clarification}:{evaluation:{kind:'INVENTORY_GRID',explicit:null,rows:entry.rows,columns:entry.columns,empty:true}})})));
/** Offline driver specimen, never sent as a model answer. */
export function inventoryGridFixture(context,item){return item.clarification?{panelIntentVersion:'0.13',contextSha256:context.sha256,panel:null,unresolved:[{id:'q0',question:item.clarification.question}]}:inventoryIntent(context,{rows:item.evaluation.rows,columns:item.evaluation.columns});}
