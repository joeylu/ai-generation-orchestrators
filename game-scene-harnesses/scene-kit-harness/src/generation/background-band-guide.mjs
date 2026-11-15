import {encodeRgbaPng} from '../png.mjs';
import {check,deepFreeze,imageRef,seal} from './common.mjs';

export const BACKGROUND_BAND_GUIDE_PROFILE='three-edge-continuation-v1';
export const BACKGROUND_BAND_GUIDE_IMAGE_ROLE='neutral-background-band-three-edge-continuation-example';
export const BACKGROUND_BAND_GUIDE_INSTRUCTION=[
  'TECHNICAL INPUT 2 demonstrates ONLY the relative coverage of one finite background band: a natural open upper contour lies in the upper part of its own canvas, while the SAME body continues across both lateral ends and all the way down to the finite lower cut. The broad lower body does not end in a wavy closed foot, fade into an isolated island, or leave a large empty area beneath it.',
  'The example is program-drawn abstract coverage data, not mountains, trees, buildings, rocks or any other requested subject. Do not copy its outline, crest count, proportions, exact margins, composition, gray values or flat drawing style. Only the written single-layer scope decides the subject and its allowed same-depth continuation.',
  'The light gray surround and the example\'s opaque Alpha are technical display space ONLY, never the output background. The approved source still requires genuine transparent sky above its natural upper silhouette, real openings and its own required transparent technical gutter. The small technical gutter does not require the side and lower subject to curl inward or become a naturally closed island.',
  'Input 1 remains the complete accepted reference for original local material colors, brushwork, light direction, softness and atmospheric depth. Input 2 supplies no palette, illumination, material, style, subject identity or scene layout. Any unseen same-layer continuation is a disclosed design assumption, not recovery of hidden reference pixels.',
  'This finite technical example does not certify camera coverage, painted continuity, source quality or human art acceptance; it grants no image compute, automatic retry, seamless repeat, unbounded camera travel or permission to alter source PNGs. Actual source reception, calibration and independent visual review remain required.',
].join('\n\n');

const profiles=deepFreeze({
  backdrop:[[16,72],[172,53],[286,32],[423,59],[584,76],[727,50],[864,59],[1007,77]],
  valley:[[16,96],[175,77],[304,56],[437,83],[574,104],[724,77],[864,65],[1007,94]],
});
const recipes=deepFreeze(Object.fromEntries(Object.entries(profiles).map(([role,upperContour])=>[role,seal({
  format:'ai_scene_background_band_guide_recipe_v1',compiler:'scene-kit-background-band-guide-v1',
  profile:BACKGROUND_BAND_GUIDE_PROFILE,role,imageRole:BACKGROUND_BAND_GUIDE_IMAGE_ROLE,
  pixelSize:{width:1024,height:512},alpha:'opaque',drawing:'fixed-neutral-program-raster',
  surround:{gray:232,purpose:'technical-display-only-not-output-background'},bodyGray:136,
  technicalFramePixels:16,bodyInterior:{left:16,rightExclusive:1008,bottomExclusive:496},
  upperContour,upperContourInterpolation:'piecewise-smoothstep-rounded-native-pixels',
  sideAndBottom:'straight-finite-cuts-after-same-body-continuation-not-natural-closed-foot',
  guidance:['upper-natural-transparent-silhouette','same-layer-lateral-continuation','same-layer-lower-continuation','relative-canvas-coverage-only'],
  excludedGuidance:['subject-identity','theme','crest-count','exact-outline','exact-margins','scene-composition','material-hue','lighting','style','output-background','automatic-coverage-certification'],
  instruction:BACKGROUND_BAND_GUIDE_INSTRUCTION,maximumNewImageCalls:0,sourceInputs:0,
  sourcePngModified:false,sourceArtAcceptance:'not-granted',finalArtwork:false,
})])));

function render(recipe){
  const {width,height}=recipe.pixelSize,rgba=Buffer.alloc(width*height*4),points=recipe.upperContour;
  for(let i=0;i<rgba.length;i+=4)rgba.set([232,232,232,255],i);
  let segment=0;
  for(let x=16;x<1008;x++){
    while(segment<points.length-2&&x>points[segment+1][0])segment++;
    const a=points[segment],b=points[segment+1],t=(x-a[0])/(b[0]-a[0]),
      top=Math.round(a[1]+(b[1]-a[1])*t*t*(3-2*t));
    for(let y=top;y<496;y++)rgba.set([136,136,136,255],(y*width+x)*4);
  }
  return encodeRgbaPng(width,height,rgba);
}

// No file access, source image, caller drawing, transport or mutable byte cache.
// The returned role is the single requested source role, not an image identity.
export function backgroundBandGuide(profile,role){
  check(arguments.length===2&&profile===BACKGROUND_BAND_GUIDE_PROFILE
    &&typeof role==='string'&&Object.hasOwn(recipes,role),'BACKGROUND_BAND_GUIDE_PROFILE');
  const recipe=recipes[role],bytes=render(recipe);
  return {bytes,artifact:imageRef(bytes),recipe,profile,role};
}
