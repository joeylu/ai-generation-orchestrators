import assert from 'node:assert/strict';
import {arrangeIntentSpec} from '../src/panel-intent.mjs';
/** Explicit authored composition, never an entity classifier or a model-answer fixture. */
export function composeCardSpec(record,catalog,{kind='preserve',settings={}}={}){
 const spec=structuredClone(record.spec),theme=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.headingStyle==='concise-v6');assert(theme);spec.theme={id:theme.id,version:theme.version};
 if(kind==='preserve')return spec;
 assert(['row','grid','column'].includes(kind));
 return arrangeIntentSpec(spec,{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto',body:{kind,children:spec.sections.map(section=>({kind:'section',sectionId:section.id}))},sourceQuote:null,...settings},theme,catalog);
}
