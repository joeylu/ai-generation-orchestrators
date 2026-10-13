import {REFERENCE_EIGHT_CASES} from '../reference-eight-v1/suite.mjs';
export const DESIGN_ARMS=['baseline','ui-ux-pro-max','game-ui-design','game-ui-ux'];
// Rotate the starting arm per panel to avoid keeping a candidate at the same position.
export const SKILL_LAYOUT_CASES=REFERENCE_EIGHT_CASES.flatMap((source,index)=>
  Array.from({length:4},(_,offset)=>{
    const armIndex=(index+offset)%4;
    return {...structuredClone(source),id:`S${armIndex}_${source.id}`,designArm:DESIGN_ARMS[armIndex],panelCaseId:source.id};
  }));
