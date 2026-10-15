import assert from 'node:assert/strict';
import {arrangeIntentSpec} from '../src/panel-intent.mjs';
const body=node=>node.kind==='section'?{kind:'section',sectionId:node.sectionId}:{kind:node.kind,children:node.children.map(body)};
/** Explicit reviewed membership, never inferred by the compiler from words or order. */
export function groupedItemSpec(record,catalog,{groups=record.reviewedGroups,headingStyle='concise-v6',themeId=record.spec.theme.id,settings={}}={}){
 const spec=structuredClone(record.spec),theme=catalog.themes.find(theme=>theme.id===themeId&&theme.headingStyle===headingStyle);assert(theme);spec.theme={id:theme.id,version:theme.version};
 if(groups){const rows=spec.sections.flatMap(section=>section.rows),byId=new Map(rows.map(row=>[row.id,row]));assert.deepEqual(groups.flatMap(group=>group.rowIds),rows.map(row=>row.id));
  spec.sections=groups.map(group=>({id:group.id,title:group.title,rows:group.rowIds.map(id=>byId.get(id))}));
 }
 const tree=groups?{kind:'column',children:spec.sections.map(section=>({kind:'section',sectionId:section.id}))}:body(spec.layout.body);
 return arrangeIntentSpec(spec,{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto',body:tree,sourceQuote:null,...settings},theme,catalog);
}
