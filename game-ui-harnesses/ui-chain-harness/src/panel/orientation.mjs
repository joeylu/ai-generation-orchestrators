// Undefined preserves historical dual-orientation plans; Studio supplies an explicit value.
export function panelOrientations(value){
 if(value===undefined)return ['landscape','portrait'];
 if(!['landscape','portrait'].includes(value))throw Error('PANEL_ORIENTATION_INVALID');
 return [value];
}
export function orientationInstructions(instructions,value,{allowPanelDimensions=false}={}){
 if(value===undefined)return instructions;
 panelOrientations(value);
  const dimensions=allowPanelDimensions?'Keep layout.canvasWidth and layout.canvasHeight null; the deterministic consumer supplies the selected canvas. Optional layout.width and layout.maxHeight describe the panel within that canvas and remain subject to component, skin and canvas safety checks.':'Output only semantic content with native geometry fields null; the deterministic consumer supplies the selected canvas.';
  return instructions+'\n\nAuthoritative canvas selection: '+value+(value==='landscape'?' (16:9)':' (9:16)')+'. The user has already selected this in Studio. This overrides any generic dual-orientation delivery guidance above. '+dimensions+' Do not ask the user to confirm this ratio or preset geometry, and do not choose another orientation from request prose. Clarify only unsupported content or behavior.';
}
