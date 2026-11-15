import {encodeRgbaPng} from '../png.mjs';
import {check,exact,deepFreeze,imageRef,seal} from './common.mjs';
import {BACKGROUND_BAND_COVERAGE_BUDGET} from './background-band-coverage-guide.mjs';

export const BACKGROUND_BAND_OPEN_TRENCH_GUIDE_PROFILE='open-trench-three-cut-coverage-v2';
export const BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE='neutral-background-band-open-trench-example';
export const BACKGROUND_BAND_OPEN_TRENCH_GUIDE_INSTRUCTION=[
 'This explicitly selected subtype is for ONE rear-depth valley or trench source role only. It is not a default for distant backdrops, skylines or other background subjects.',
 'TECHNICAL INPUT 2 is a genuinely transparent asset-local OPEN TRENCH topology example. Broad gray side-connected masses show attached stepped or irregular material; the clear central passage remains real Alpha-zero empty space from the upper field through the middle to the BOTTOM cut. There is no opaque display surround, painted water or air background, enclosed hole, round opening or isolated narrow upright mark.',
 'Use the declared canvas aspect and normalized soft coverage budget. Highest natural material contours begin roughly 4–12 percent down from the canvas top; a major local material feature may occupy about 22–32 percent of the width as a soft size cue. A connected side mass may contain several such features and be wider. These cues do not specify subject count, exact body widths, scene coordinates or a frozen composition.',
 'The topology example separates broad material from a continuous open depth passage. Preserve the source brief\'s broad same-layer masses and their own natural stepped or irregular exposed boundaries. Do not turn the example into a collection of freestanding thin columns, a closed ring, round holes, a row of archways or a bridge across the passage. It supplies no requested architecture, geology or other subject identity.',
 'LEFT, RIGHT and BOTTOM are finite off-camera cuts. Continue material to a cut wherever its own mass crosses that edge; leave actual empty space genuinely transparent where a void crosses the edge. The central open passage must remain unpainted through its lower cut. Do not add an opaque lower floor, full-width wall, water-colored sheet or haze backing to fill empty space. Keep at least TWO completely transparent native rows above the natural TOP.',
 'Do not trace the example outlines, steps, positions, proportions or number of gray regions. The example is not a complete scene layout and does not require two subjects. Input 1 remains the complete accepted reference for actual subjects, original palette, brushwork, materials, illumination and atmospheric hierarchy. The written single-layer brief owns content, supports, exclusions and newly inferred continuation. Input 2 supplies only the actual asset aspect, the soft feature budget and open material/void topology.',
 'This fixed program example grants no generation, retry, image edit, source acceptance, seamless tiling, unlimited camera movement or final art acceptance. Actual native dimensions, transparent openings, displayed feature scale, finite camera-domain coverage and source purity still require independent measurement and visual review.'
].join('\n\n');

const geometry=deepFreeze({
 valley:{masses:[
  [[0,10],[20,6],[32,11],[31,28],[37,33],[36,53],[43,61],[41,81],[40,100],[0,100]],
  [[76,11],[94,5],[100,8],[100,100],[66,100],[66,80],[62,71],[63,46],[70,41],[69,19]]
 ]}
});
const gcd=(a,b)=>b?gcd(b,a%b):a;
function checked(options){
 exact(options,['canvasAspect','coverageBudget','role']);
 const {canvasAspect:a,coverageBudget:b,role}=options;exact(a,['numerator','denominator']);
 check([a.numerator,a.denominator].every(v=>Number.isSafeInteger(v)&&v>0&&v<=32768),'BACKGROUND_BAND_OPEN_TRENCH_GUIDE_ASPECT');
 const g=gcd(a.numerator,a.denominator),n=a.numerator/g,d=a.denominator/g;
 check(n>=d&&n<=d*8&&n<=1040,'BACKGROUND_BAND_OPEN_TRENCH_GUIDE_ASPECT');
 exact(b,['profile','upperContourPercent','majorFeatureWidthPercent']);exact(b.upperContourPercent,['min','max']);exact(b.majorFeatureWidthPercent,['min','max']);
 check(b.profile===BACKGROUND_BAND_COVERAGE_BUDGET.profile&&b.upperContourPercent.min===4&&b.upperContourPercent.max===12
  &&b.majorFeatureWidthPercent.min===22&&b.majorFeatureWidthPercent.max===32,'BACKGROUND_BAND_OPEN_TRENCH_GUIDE_BUDGET');
 check(role==='valley','BACKGROUND_BAND_OPEN_TRENCH_GUIDE_ROLE');
 const unit=Math.max(Math.floor(1040/n),Math.ceil(128/d)),width=n*unit,height=d*unit;
 check(width<=2048&&height>=128&&height<=2048,'BACKGROUND_BAND_OPEN_TRENCH_GUIDE_ASPECT');
 return {a,b,role,n,d,unit,width,height};
}
function contains(points,x,y){
 let inside=false;
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[i],b=points[j];
  if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}

// A new canonical subtype, not a replacement for the prior open-depth guide.
// No file access, image processing, custom drawing, transport or mutable cache.
export function backgroundBandOpenTrenchGuide(options){
 check(arguments.length===1,'BACKGROUND_BAND_OPEN_TRENCH_GUIDE_OPTIONS');
 const {a,b,role,n,d,unit,width,height}=checked(options),shape=geometry[role],rgba=Buffer.alloc(width*height*4);
 for(let y=2;y<height;y++)for(let x=0;x<width;x++){
  const nx=(x+.5)*100/width,ny=(y+.5)*100/height;
  if(shape.masses.some(points=>contains(points,nx,ny)))rgba.set([136,136,136,255],(y*width+x)*4);
 }
 const recipe=deepFreeze(seal({format:'ai_scene_background_band_open_trench_guide_recipe_v1',compiler:'scene-kit-background-band-open-trench-guide-v1',
  profile:BACKGROUND_BAND_OPEN_TRENCH_GUIDE_PROFILE,role,imageRole:BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE,
  canvasAspect:structuredClone(a),normalizedCanvasAspect:{numerator:n,denominator:d},coverageBudget:structuredClone(b),
  pixelSize:{width,height},exactAspectUnit:unit,alpha:'transparent',drawing:'fixed-neutral-program-raster',
  surround:'none',transparentRgba:[0,0,0,0],bodyGray:136,minimumTransparentTopRows:2,
  bodyTopology:'broad-side-connected-masses-with-continuous-open-trench',openings:'one-connected-alpha-zero-upper-middle-bottom-field-no-enclosed-holes',
  silhouetteLanguage:'broad-attached-stepped-or-irregular-masses-no-independent-slender-columns',
  finiteCuts:['left','right','bottom'],sideBottomBlankFramePixels:0,cutContinuation:'material-and-open-trench-both-continue-at-finite-cuts',
  exampleNormalizedGeometry:shape,rasterization:'pixel-centre-even-odd-polygons-no-hole-subtraction',
  normalizedBudgetRequired:true,majorFeatureFrequency:'soft-local-feature-scale-not-whole-mass-width-or-subject-count',
  excludedGuidance:['subject-identity','theme','exact-outline','step-count','mass-count','scene-coordinates','frozen-scene-layout','material-hue','lighting','style','opaque-output-background','solid-lower-fill','enclosed-holes','isolated-slender-columns'],
  instruction:BACKGROUND_BAND_OPEN_TRENCH_GUIDE_INSTRUCTION,maximumNewImageCalls:0,sourceInputs:0,
  sourcePngModified:false,sourceArtAcceptance:'not-granted',finalArtwork:false}));
 const bytes=encodeRgbaPng(width,height,rgba);
 return {bytes,artifact:imageRef(bytes),recipe,profile:BACKGROUND_BAND_OPEN_TRENCH_GUIDE_PROFILE,role};
}
