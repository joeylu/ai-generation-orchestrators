import {encodeRgbaPng} from '../png.mjs';
import {check,exact,deepFreeze,imageRef,seal} from './common.mjs';
import {BACKGROUND_BAND_COVERAGE_BUDGET} from './background-band-coverage-guide.mjs';

export const BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_PROFILE='open-valley-irregular-coverage-v3';
export const BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_IMAGE_ROLE='neutral-background-band-irregular-valley-example';
export const BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_INSTRUCTION=[
  'TECHNICAL INPUT 2 is a transparent, asset-local example of irregular SAME-DEPTH material and real empty space. The gray shapes indicate material, not a subject, surface, color, architecture, layout or style. Transparent areas are real voids, not a painted sky or haze.',
  'The natural top stays transparent, including at least TWO completely transparent native rows. LEFT, RIGHT and BOTTOM are finite cuts: material crossing a cut continues there; actual empty space remains transparent wherever it crosses a cut. Neither the exact contours nor every cut pixel must be filled.',
  'Use the declared aspect and soft relative feature budget as approximate scale guidance, never a fixed count, scene coordinate, contour, subject identity or layout. Do not copy the example outlines, color, flat style or proportions. It contains no platforms, bridges, towers, columns, text or thematic details.',
  'The single-layer brief owns the subject and may specify same-layer structures that cross or locally occlude empty space. Preserve real openings around actual painted structures; do not fill them with opaque fog, sky, water, ground or a display surround. A physical structure may divide a transparent opening; no universal four-connected passage is implied.',
  'Input 1 remains the complete accepted reference for material, original palette, light and brushwork. Continuation beyond the frame is an explicit design assumption. The guide does not authorize generation or certify content purity, continuous camera coverage, scale or visual acceptance.'
].join('\n\n');

// Fixed abstract, non-platform-like contours. This raster is neither a
// segmentation of a reference nor an asset and contains no thin connection.
const geometry=deepFreeze({valley:{masses:[
  [[0,7],[12,5],[22,12],[28,22],[25,35],[33,47],[31,59],[38,72],[34,85],[35,100],[0,100]],
  [[100,8],[90,5],[82,12],[77,23],[80,34],[73,45],[75,56],[67,69],[70,82],[66,100],[100,100]]
]}});
const gcd=(a,b)=>b?gcd(b,a%b):a;
function checked(options){
  exact(options,['canvasAspect','coverageBudget','role']);const {canvasAspect:a,coverageBudget:b,role}=options;
  exact(a,['numerator','denominator']);check([a.numerator,a.denominator].every(v=>Number.isSafeInteger(v)&&v>0&&v<=32768),'BACKGROUND_BAND_IRREGULAR_VALLEY_ASPECT');
  const g=gcd(a.numerator,a.denominator),n=a.numerator/g,d=a.denominator/g;
  check(n>=d&&n<=d*8&&n<=1040,'BACKGROUND_BAND_IRREGULAR_VALLEY_ASPECT');
  exact(b,['profile','upperContourPercent','majorFeatureWidthPercent']);exact(b.upperContourPercent,['min','max']);exact(b.majorFeatureWidthPercent,['min','max']);
  check(b.profile===BACKGROUND_BAND_COVERAGE_BUDGET.profile&&b.upperContourPercent.min===4&&b.upperContourPercent.max===12
    &&b.majorFeatureWidthPercent.min===22&&b.majorFeatureWidthPercent.max===32,'BACKGROUND_BAND_IRREGULAR_VALLEY_BUDGET');
  check(role==='valley','BACKGROUND_BAND_IRREGULAR_VALLEY_ROLE');
  const unit=Math.max(Math.floor(1040/n),Math.ceil(128/d)),width=n*unit,height=d*unit;
  check(width<=2048&&height>=128&&height<=2048,'BACKGROUND_BAND_IRREGULAR_VALLEY_ASPECT');return {a,b,role,n,d,unit,width,height};
}
function contains(points,x,y){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
}return inside;}
export function backgroundBandIrregularValleyGuide(options){
  check(arguments.length===1,'BACKGROUND_BAND_IRREGULAR_VALLEY_OPTIONS');
  const {a,b,role,n,d,unit,width,height}=checked(options),shape=geometry[role],rgba=Buffer.alloc(width*height*4);
  for(let y=2;y<height;y++)for(let x=0;x<width;x++){
    const nx=(x+.5)*100/width,ny=(y+.5)*100/height;
    if(shape.masses.some(points=>contains(points,nx,ny)))rgba.set([136,136,136,255],(y*width+x)*4);
  }
  const recipe=deepFreeze(seal({format:'ai_scene_background_band_irregular_valley_guide_recipe_v1',compiler:'scene-kit-background-band-irregular-valley-guide-v1',
    profile:BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_PROFILE,role,imageRole:BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_IMAGE_ROLE,
    canvasAspect:structuredClone(a),normalizedCanvasAspect:{numerator:n,denominator:d},coverageBudget:structuredClone(b),
    pixelSize:{width,height},exactAspectUnit:unit,alpha:'transparent',drawing:'fixed-neutral-program-raster',surround:'none',transparentRgba:[0,0,0,0],
    bodyGray:136,minimumTransparentTopRows:2,bodyTopology:'irregular-same-depth-masses-with-real-voids',
    openings:'real-alpha-zero-voids-may-connect-through-cuts',finiteCuts:['left','right','bottom'],
    cutContinuation:'painted-masses-and-transparent-voids-both-continue-at-finite-cuts',exampleNormalizedGeometry:shape,
    rasterization:'pixel-centre-even-odd-polygons',normalizedBudgetRequired:true,
    excludedGuidance:['subject-identity','theme','bridge','tower','column','exact-outline','mass-count','scene-coordinates','material-hue','lighting','style','opaque-output-background'],
    instruction:BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_INSTRUCTION,maximumNewImageCalls:0,sourceInputs:0,sourcePngModified:false,sourceArtAcceptance:'not-granted',finalArtwork:false}));
  const bytes=encodeRgbaPng(width,height,rgba);return {bytes,artifact:imageRef(bytes),recipe,profile:BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_PROFILE,role};
}
