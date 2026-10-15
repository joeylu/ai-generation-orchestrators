import {COMMON_GAME_PANEL_SUITE} from '../common-game-panels-v1/suite.mjs';
import {dailyDefaultFixture} from '../daily-defaults-v1/suite.mjs';
/** Ten unchanged short requests through the complete current daily default. */
export const SECTION_PANEL_TEN_SUITE=Object.freeze(['G03','G22','G17','G25','G14','G16','G31','G06','G05','G54'].map(id=>{
 const item=COMMON_GAME_PANEL_SUITE.find(item=>item.id===id);if(!item)throw Error('SECTION_PANEL_TEN_CASE');
 return Object.freeze({...item,dailyDefault:true});
}));
/** Driver specimen only. It is never included in the prompt sent to a model. */
export function sectionPanelTenFixture(context,item,referenceIntent){
 const intent=dailyDefaultFixture(context,item,referenceIntent);
 for(const key of ['width','canvasWidth','canvasHeight','maxHeight'])intent.panel.layout[key]=null;
 return intent;
}
