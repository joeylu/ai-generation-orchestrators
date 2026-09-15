import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectLayoutChecks} from '../src/ai_ui_decomposition/select-layout-browser.mjs';
const fixture=()=>({node:{layout:{width:120},props:{style:{fontSize:16},options:[{id:'a',label:'Asia'}],appearance:{popupCanvas:{width:120,height:90},popupContentLayout:{x:24,y:8,width:72,height:72}}}},
 observed:{popupOpen:true,popupBounds:{x:100,y:200,width:120,height:90},popupItems:[{optionId:'a',text:'Asia',iconBounds:null,textBounds:[{text:'Asia',fontSize:16,bounds:{x:134,y:220,width:40,height:20}}]}]}});
test('actual popup label must fit its registered safe row',()=>{const {node,observed}=fixture();assert(selectLayoutChecks(node,observed).every(r=>r.pass));observed.popupItems[0].textBounds[0].bounds.x=110;assert(selectLayoutChecks(node,observed).some(r=>!r.pass));});
test('no measurement, truncation, wrong font and closed popup are not passes',()=>{for(const mutate of [o=>delete o.popupItems[0].textBounds,o=>o.popupItems[0].text='As…',o=>o.popupItems[0].textBounds[0].fontSize=8,o=>o.popupOpen=false]){const {node,observed}=fixture();mutate(observed);assert(selectLayoutChecks(node,observed).some(r=>!r.pass));}});
