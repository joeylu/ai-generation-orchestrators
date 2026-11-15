import {check,deepFreeze,digest,seal,unseal} from './generation/common.mjs';
import {encodeRgbaPng} from './png.mjs';
import {raster} from './terrain-proof/raster.mjs';
import {controlGuideRecipe,renderControlGuides} from './reference-controls.mjs';

export const REFERENCE_GUIDANCE_PROFILE='isolated-component-v2';

// The first guide retains its v1 bytes. The second demonstrates a complete local
// component, not a terrain silhouette or the composition of a particular scene.
export const controlGuideRecipeV2=deepFreeze(seal({
  format:'ai_scene_neutral_control_guide_recipe_v2',profile:REFERENCE_GUIDANCE_PROFILE,
  projection:{sourceRecipeSha256:controlGuideRecipe.sha256,path:'projection-guide.png',
    sha256:'2619d46aa41b10867799487cb0547579081a5ba45d95e817d2b2a760ac396e43'},
  focus:{width:512,height:512,background:[245,246,244],border:[49,55,61],
    operations:[
      {kind:'box',rect:[176,128,146,178],color:[116,128,140]},
      {kind:'box',rect:[195,149,107,65],color:[159,170,179]},
      {kind:'rect',rect:[211,168,74,7],color:[235,239,241]},
      {kind:'box',rect:[88,185,88,22],color:[116,128,140]},
      {kind:'box',rect:[322,227,90,22],color:[116,128,140]},
      {kind:'rect',rect:[89,188,5,16],color:[49,55,61]},
      {kind:'rect',rect:[405,230,5,16],color:[49,55,61]},
      ...[[148,147],[148,267],[322,147],[322,267]].map(([x,y])=>({kind:'box',rect:[x,y,28,16],color:[151,160,169]})),
      {kind:'line',from:[210,306],to:[210,346],size:4,color:[49,55,61]},
      {kind:'line',from:[210,346],to:[280,346],size:4,color:[49,55,61]},
      {kind:'line',from:[280,346],to:[280,306],size:4,color:[49,55,61]},
    ],
    purpose:'one-complete-isolated-component-closed-ends-short-mounts-cable-return-and-four-side-clearance',
  },
  meaning:'technical-edge-and-component-completeness-only-not-content-style-count-or-scene-layout',
  support:'scene-support-relationship-comes-from-accepted-requirements-not-this-example',
  antiAliasing:'none-discrete-palette-no-blur',generationCalls:0,
}));

function rect(image,[x,y,width,height],color){
  for(let yy=y;yy<y+height;yy++)for(let xx=x;xx<x+width;xx++)
    if(xx>=0&&xx<image.width&&yy>=0&&yy<image.height)image.rgba.set([...color,255],(yy*image.width+xx)*4);
}
function box(image,bounds,color,border){
  const [x,y,width,height]=bounds;
  rect(image,bounds,border);rect(image,[x+2,y+2,width-4,height-4],color);
}
function line(image,from,to,color,size){
  const [x,y]=from,[xx,yy]=to,steps=Math.max(Math.abs(xx-x),Math.abs(yy-y));
  for(let n=0;n<=steps;n++)rect(image,[Math.round(x+(xx-x)*n/Math.max(1,steps)),Math.round(y+(yy-y)*n/Math.max(1,steps)),size,size],color);
}
export function renderControlGuidesV2(recipe=controlGuideRecipeV2){
  unseal(recipe);check(digest(recipe)===digest(controlGuideRecipeV2),'CONTROL_GUIDE_V2_RECIPE');
  const projection=renderControlGuides().get(recipe.projection.path),focus=raster(recipe.focus.width,recipe.focus.height);
  rect(focus,[0,0,focus.width,focus.height],recipe.focus.background);
  for(const operation of recipe.focus.operations){
    if(operation.kind==='box')box(focus,operation.rect,operation.color,recipe.focus.border);
    else if(operation.kind==='rect')rect(focus,operation.rect,operation.color);
    else line(focus,operation.from,operation.to,operation.color,operation.size);
  }
  return new Map([['projection-guide.png',projection],['focus-guide.png',encodeRgbaPng(focus.width,focus.height,focus.rgba)]]);
}
