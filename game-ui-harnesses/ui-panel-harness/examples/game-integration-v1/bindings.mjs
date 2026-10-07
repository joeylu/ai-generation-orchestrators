// Explicit mappings for the preserved COM01/02/03 acceptance sources, not label heuristics.
export const GAME_ROUTE_TEMPLATES=Object.freeze({
 settings:{panelId:'composite-settings',states:[
  {fieldId:'row0',key:'volume',direction:'two-way'},{fieldId:'row1',key:'musicVolume',direction:'two-way'},
  {fieldId:'row2',key:'effectsVolume',direction:'two-way'},{fieldId:'row3',key:'muted',direction:'two-way'},
 ],commands:[]},
 role:{panelId:'composite-role-form',states:[{fieldId:'row0',key:'draftName',direction:'two-way'},{fieldId:'row1',key:'draftDeclaration',direction:'two-way'}],commands:[
  {rowId:'row2',command:'profile.submit',payload:{name:'row0',declaration:'row1'},concurrency:'drop'},
  {rowId:'row3',command:'profile.cancel',payload:{},concurrency:'drop'},
 ]},
 loading:{panelId:'composite-loading',states:[{fieldId:'row1',key:'progress',direction:'from-game'},{fieldId:'row2',key:'downloaded',direction:'from-game'},{fieldId:'row3',key:'promptSound',direction:'two-way'}],commands:[
  {rowId:'row4',command:'load.start',payload:{},concurrency:'replace'},
  {rowId:'row5',command:'load.cancel',payload:{},concurrency:'drop'},
 ]},
});
