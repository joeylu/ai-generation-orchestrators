import {encodeRgbaPng} from '../png.mjs';
import {check,exact,deepFreeze,imageRef,seal} from './common.mjs';

export const BACKGROUND_BAND_COVERAGE_GUIDE_PROFILE='normalized-three-cut-coverage-v1';
export const BACKGROUND_BAND_COVERAGE_GUIDE_IMAGE_ROLE='neutral-background-band-coverage-budget-example';
export const BACKGROUND_BAND_COVERAGE_BUDGET=deepFreeze({profile:'normalized-relative-coverage-v1',
  upperContourPercent:{min:4,max:12},majorFeatureWidthPercent:{min:22,max:32}});
export const BACKGROUND_BAND_COVERAGE_GUIDE_INSTRUCTION=[
  'TECHNICAL INPUT 2 supplies the asset-local canvas aspect and normalized coverage budget. Use these relative proportions: place the natural upper contour in the upper 4–12 percent of the canvas and keep the broad same-layer painting continuous to BOTH lateral frame cuts and the BOTTOM frame cut. These three finite cuts may contain paint; no gray or transparent clearance strip is required there by this guide.',
  'Use approximately 22–32 percent of the canvas width as a SOFT size cue for a major same-layer feature or mass. For example, one broad ridge mass or a coherent depth group may occupy about a quarter of the width and contain several smaller variations. This does not prescribe a number of peaks, trees, buildings or groups, and does not make every small detail a quarter-canvas feature. Preserve the reference-relative rhythm of major masses and freely varied secondary detail.',
  'The neutral body and its upper curve are abstract program data. Follow the normalized coverage and soft feature scale while creating the requested subject. Do not trace the exact curve, fix its crest count, copy its flat drawing style or use it as scene coordinates or a frozen scene composition.',
  'The pale gray space above the example contour is technical display space ONLY, representing transparent sky in the requested source. Do not copy this opaque surround or convert the source to gray. Preserve genuine transparency above the natural top and real subject openings. Continue original same-layer content through the wide lower body to the three finite cuts; do not close a mountain foot inside the canvas, leave a large transparent area below it, or use a surrounding fade to substitute for painting.',
  'Input 1 remains the complete accepted reference for local material colors, brushwork, lighting and atmospheric hierarchy. The written single-layer brief owns subject identity and exclusions. Input 2 contributes only the declared aspect, normalized coverage budget and soft major-feature scale; it supplies no palette, material, lighting, theme, exact outline or scene layout. Unseen same-layer continuation is new design inference, not recovered hidden reference pixels.',
  'This finite program-drawn example grants no compute, retries, image edits, seamless tiling, unlimited camera movement, source acceptance or final art acceptance. Actual native dimensions, displayed scale, full camera-domain coverage and painted continuity still require separate measurement and visual review.',
].join('\n\n');

const contours=deepFreeze({
  backdrop:[[0,11],[12,4],[25,12],[38,5],[51,11],[64,4],[78,12],[91,6],[100,10]],
  valley:[[0,10],[8,5],[21,12],[34,4],[48,11],[62,6],[75,12],[88,4],[100,11]],
});
const gcd=(a,b)=>b?gcd(b,a%b):a;

function checked(options){
  exact(options,['canvasAspect','coverageBudget','role']);
  const {canvasAspect:a,coverageBudget:b,role}=options;exact(a,['numerator','denominator']);
  check([a.numerator,a.denominator].every(v=>Number.isSafeInteger(v)&&v>0&&v<=32768),'BACKGROUND_BAND_COVERAGE_GUIDE_ASPECT');
  const g=gcd(a.numerator,a.denominator),n=a.numerator/g,d=a.denominator/g;
  check(n>=d&&n<=d*8&&n<=1040,'BACKGROUND_BAND_COVERAGE_GUIDE_ASPECT');
  exact(b,['profile','upperContourPercent','majorFeatureWidthPercent']);
  exact(b.upperContourPercent,['min','max']);exact(b.majorFeatureWidthPercent,['min','max']);
  check(b.profile===BACKGROUND_BAND_COVERAGE_BUDGET.profile&&b.upperContourPercent.min===4&&b.upperContourPercent.max===12
    &&b.majorFeatureWidthPercent.min===22&&b.majorFeatureWidthPercent.max===32,'BACKGROUND_BAND_COVERAGE_GUIDE_BUDGET');
  check(typeof role==='string'&&Object.hasOwn(contours,role),'BACKGROUND_BAND_COVERAGE_GUIDE_ROLE');
  const unit=Math.max(Math.floor(1040/n),Math.ceil(128/d)),width=n*unit,height=d*unit;
  check(width<=2048&&height>=128&&height<=2048,'BACKGROUND_BAND_COVERAGE_GUIDE_ASPECT');
  return {a,b,role,n,d,unit,width,height};
}

export function backgroundBandCoverageGuide(options){
  check(arguments.length===1,'BACKGROUND_BAND_COVERAGE_GUIDE_OPTIONS');
  const {a,b,role,n,d,unit,width,height}=checked(options),points=contours[role],rgba=Buffer.alloc(width*height*4);
  for(let i=0;i<rgba.length;i+=4)rgba.set([232,232,232,255],i);
  let segment=0;
  for(let x=0;x<width;x++){
    const percent=x/(width-1)*100;
    while(segment<points.length-2&&percent>points[segment+1][0])segment++;
    const left=points[segment],right=points[segment+1],t=(percent-left[0])/(right[0]-left[0]),
      top=Math.round((left[1]+(right[1]-left[1])*t*t*(3-2*t))*height/100);
    for(let y=top;y<height;y++)rgba.set([136,136,136,255],(y*width+x)*4);
  }
  const recipe=deepFreeze(seal({format:'ai_scene_background_band_coverage_guide_recipe_v1',compiler:'scene-kit-background-band-coverage-guide-v1',
    profile:BACKGROUND_BAND_COVERAGE_GUIDE_PROFILE,role,imageRole:BACKGROUND_BAND_COVERAGE_GUIDE_IMAGE_ROLE,
    canvasAspect:a,normalizedCanvasAspect:{numerator:n,denominator:d},coverageBudget:b,
    pixelSize:{width,height},exactAspectUnit:unit,alpha:'opaque',drawing:'fixed-neutral-program-raster',
    surround:{gray:232,area:'above-natural-top-only',purpose:'technical-display-representing-output-transparency'},bodyGray:136,
    finiteCuts:['left','right','bottom'],sideBottomBlankFramePixels:0,
    exampleUpperContourPercent:points,upperContourInterpolation:'piecewise-smoothstep-rounded-native-pixels',
    normalizedBudgetRequired:true,majorFeatureFrequency:'soft-size-of-dominant-same-layer-masses-not-exact-count-or-every-small-detail',
    excludedGuidance:['subject-identity','theme','exact-outline','crest-count','scene-coordinates','frozen-scene-layout','material-hue','lighting','style','opaque-output-background'],
    instruction:BACKGROUND_BAND_COVERAGE_GUIDE_INSTRUCTION,maximumNewImageCalls:0,sourceInputs:0,
    sourcePngModified:false,sourceArtAcceptance:'not-granted',finalArtwork:false}));
  const bytes=encodeRgbaPng(width,height,rgba);
  return {bytes,artifact:imageRef(bytes),recipe,profile:BACKGROUND_BAND_COVERAGE_GUIDE_PROFILE,role};
}
