import {customPanelDocument} from './custom-layout.mjs';

// Presentation 2 uses the same measured content cards as custom layout 3.
// These values belong to that immutable presentation version, not mutable
// custom defaults; preset kinds/counts and local behavior remain untouched.
export const presetSurfaceLayout=Object.freeze({version:'3.0',groupGap:20,groupPadding:12,maxDepth:8,gridColumns:2,minColumnWidth:160,maxColumns:3,minCardWidth:240,groupSurfaces:true,dataSurfaces:true});
export function presetSurfaceDocument(content,config,canvas,ctx,body){
 const preset=config.presets[content.presetId],next=structuredClone(config);
 next.presets[content.presetId]={...preset,layout:structuredClone(presetSurfaceLayout)};
 const rows=[...content.fields,...content.actions].map(f=>f.id),section={kind:'section',id:'group-0',title:content.sectionTitle||content.title,rowIds:rows,actionLayout:null};
 return customPanelDocument({...content,layout:{width:null,maxHeight:null,overflow:content.overflow??'error'},layoutBody:body??{kind:'column',children:[section]}},next,canvas,ctx);
}
