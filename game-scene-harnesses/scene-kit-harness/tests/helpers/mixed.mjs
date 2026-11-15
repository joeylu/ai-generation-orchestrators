import {readMap,createEditor} from '../../src/index.mjs';
export function mixedMap(handle){
  return {...readMap(handle),format:'ai_scene_document_v2',assemblyInstances:[],terrainRuns:[
    {x:0,y:7,length:4,familyId:'terrain.primary'},{x:12,y:7,length:4,familyId:'terrain.primary'},
    {x:0,y:8,length:4,familyId:'terrain.primary'},{x:12,y:8,length:4,familyId:'terrain.primary'}],
    curveTerrains:[{curveId:'mixed.hill',familyId:'terrain.primary',profile:'sideview-height-curve-v1',baseY:576,
      points:[{x:257,y:448,slope:0},{x:512,y:320,slope:0},{x:767,y:448,slope:0}]}]};
}
export function connectionCommands(document,endpoint){return {type:'connect-curve-grid',curve:structuredClone(document.curveTerrains[0]),endpoint,cell:endpoint==='start'?{x:3,y:7}:{x:12,y:7}};}
export function connectedMap(handle){const editor=createEditor(handle,mixedMap(handle));editor.execute([{type:'enable-mixed-terrain'},connectionCommands(editor.getDocument(),'start')]);editor.execute([connectionCommands(editor.getDocument(),'end')]);return editor.getDocument();}
