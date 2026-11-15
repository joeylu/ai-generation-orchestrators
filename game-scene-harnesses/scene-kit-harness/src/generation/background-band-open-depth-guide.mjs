import {encodeRgbaPng} from '../png.mjs';
import {check,exact,deepFreeze,imageRef,seal} from './common.mjs';
import {BACKGROUND_BAND_COVERAGE_BUDGET} from './background-band-coverage-guide.mjs';

export const BACKGROUND_BAND_OPEN_DEPTH_GUIDE_PROFILE='open-depth-three-cut-coverage-v1';
export const BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE='neutral-background-band-open-depth-example';
export const BACKGROUND_BAND_OPEN_DEPTH_GUIDE_INSTRUCTION=[
 'TECHNICAL INPUT 2 is a genuinely transparent asset-local topology example. Gray marks represent separated SAME-DEPTH material masses; every clear area is real transparent empty space, including the upper field, holes and connected middle/lower passages. There is NO opaque display surround or painted water/air background to copy.',
 'Use the declared canvas aspect and normalized soft feature budget: highest natural material contours lie roughly 4–12 percent down from the canvas top, and a major same-layer mass may have about 22–32 percent of the width. These are relative size cues, not a required contour at every column, a solid lower landform, a feature count, a subject arrangement or pixel coordinates.',
 'Preserve OPEN DEPTH: real transparent space may connect from the upper field through the middle and broad lower canvas to any finite cut. Do not fill those voids with an opaque gray sheet, water-colored floor, valley wall, painted haze, sea bottom, solid backing or full-width wavy upper border. The written brief and complete reference determine which material masses and real openings belong to this single layer.',
 'LEFT, RIGHT and BOTTOM are finite off-camera cuts. Wherever a material mass crosses one of those cuts, continue that mass to the edge without rounding it into an island or adding a transparent inset gutter. Wherever a real void reaches a cut, leave it genuinely transparent. No rule requires paint in all lower columns or a single connected opaque body. Keep the natural TOP border fully transparent for at least TWO native pixels.',
 'Do not trace the example mass outlines, positions, widths, hole shapes, separation pattern or number of marks. Its grayscale raster supplies no buildings, arches, pillars, rocks, vegetation, theme, material hue, lighting or painting style. Input 1 remains the complete accepted reference for actual subjects, original colors, brushwork, illumination and atmospheric hierarchy; the single-layer brief owns content, support, exclusions and the extent of newly inferred continuation.',
 'This fixed program example grants no image compute, retries, image edits, seamless tiling, unlimited camera movement, source acceptance or final art acceptance. Actual native dimensions, displayed scale, finite camera-domain coverage, content purity and the transparency of real voids still require independent measurement and visual review.'
].join('\n\n');

const geometry=deepFreeze({
 backdrop:{masses:[
  [[0,8],[17,5],[27,12],[24,35],[29,59],[24,77],[22,100],[0,100]],
  [[40,10],[61,5],[63,15],[55,25],[55,49],[44,66],[45,100],[36,100],[35,66],[39,35]],
  [[79,10],[92,4],[100,7],[100,100],[76,100],[80,67],[74,43]]
 ],holes:[{x:13,y:44,rx:5,ry:10},{x:47,y:35,rx:4,ry:7},{x:89,y:31,rx:4,ry:8}]},
 valley:{masses:[
  [[0,10],[15,6],[26,11],[23,37],[28,61],[23,80],[21,100],[0,100]],
  [[42,11],[63,4],[65,14],[57,27],[56,51],[45,68],[46,100],[37,100],[36,65],[40,35]],
  [[80,11],[94,5],[100,8],[100,100],[77,100],[81,69],[75,44]]
 ],holes:[{x:12,y:46,rx:5,ry:10},{x:48,y:36,rx:4,ry:7},{x:90,y:32,rx:4,ry:8}]}
});
const gcd=(a,b)=>b?gcd(b,a%b):a;
function checked(options){
 exact(options,['canvasAspect','coverageBudget','role']);
 const {canvasAspect:a,coverageBudget:b,role}=options;exact(a,['numerator','denominator']);
 check([a.numerator,a.denominator].every(v=>Number.isSafeInteger(v)&&v>0&&v<=32768),'BACKGROUND_BAND_OPEN_DEPTH_GUIDE_ASPECT');
 const g=gcd(a.numerator,a.denominator),n=a.numerator/g,d=a.denominator/g;
 check(n>=d&&n<=d*8&&n<=1040,'BACKGROUND_BAND_OPEN_DEPTH_GUIDE_ASPECT');
 exact(b,['profile','upperContourPercent','majorFeatureWidthPercent']);exact(b.upperContourPercent,['min','max']);exact(b.majorFeatureWidthPercent,['min','max']);
 check(b.profile===BACKGROUND_BAND_COVERAGE_BUDGET.profile&&b.upperContourPercent.min===4&&b.upperContourPercent.max===12
  &&b.majorFeatureWidthPercent.min===22&&b.majorFeatureWidthPercent.max===32,'BACKGROUND_BAND_OPEN_DEPTH_GUIDE_BUDGET');
 check(typeof role==='string'&&Object.hasOwn(geometry,role),'BACKGROUND_BAND_OPEN_DEPTH_GUIDE_ROLE');
 const unit=Math.max(Math.floor(1040/n),Math.ceil(128/d)),width=n*unit,height=d*unit;
 check(width<=2048&&height>=128&&height<=2048,'BACKGROUND_BAND_OPEN_DEPTH_GUIDE_ASPECT');
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

// No file access, source-image processing, caller drawings, transports or
// mutable byte cache. Transparent pixels are zero RGBA, never a gray surround.
export function backgroundBandOpenDepthGuide(options){
 check(arguments.length===1,'BACKGROUND_BAND_OPEN_DEPTH_GUIDE_OPTIONS');
 const {a,b,role,n,d,unit,width,height}=checked(options),shape=geometry[role],rgba=Buffer.alloc(width*height*4);
 for(let y=2;y<height;y++)for(let x=0;x<width;x++){
  const nx=(x+.5)*100/width,ny=(y+.5)*100/height;
  if(shape.masses.some(points=>contains(points,nx,ny))&&!shape.holes.some(h=>((nx-h.x)/h.rx)**2+((ny-h.y)/h.ry)**2<1))rgba.set([136,136,136,255],(y*width+x)*4);
 }
 const recipe=deepFreeze(seal({format:'ai_scene_background_band_open_depth_guide_recipe_v1',compiler:'scene-kit-background-band-open-depth-guide-v1',
  profile:BACKGROUND_BAND_OPEN_DEPTH_GUIDE_PROFILE,role,imageRole:BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE,
  canvasAspect:structuredClone(a),normalizedCanvasAspect:{numerator:n,denominator:d},coverageBudget:structuredClone(b),
  pixelSize:{width,height},exactAspectUnit:unit,alpha:'transparent',drawing:'fixed-neutral-program-raster',
  surround:'none',transparentRgba:[0,0,0,0],bodyGray:136,minimumTransparentTopRows:2,
  bodyTopology:'separate-same-depth-masses-with-connected-transparent-voids',openings:'real-alpha-zero-voids-may-connect-through-cuts',
  finiteCuts:['left','right','bottom'],sideBottomBlankFramePixels:0,cutContinuation:'painted-masses-and-transparent-voids-both-continue-at-finite-cuts',
  exampleNormalizedGeometry:shape,rasterization:'pixel-centre-even-odd-polygons-minus-ellipse-interiors',
  normalizedBudgetRequired:true,majorFeatureFrequency:'soft-size-of-major-same-depth-masses-not-exact-count-or-layout',
  excludedGuidance:['subject-identity','theme','exact-outline','mass-count','hole-shape','scene-coordinates','frozen-scene-layout','material-hue','lighting','style','opaque-output-background','solid-lower-fill'],
  instruction:BACKGROUND_BAND_OPEN_DEPTH_GUIDE_INSTRUCTION,maximumNewImageCalls:0,sourceInputs:0,
  sourcePngModified:false,sourceArtAcceptance:'not-granted',finalArtwork:false}));
 const bytes=encodeRgbaPng(width,height,rgba);
 return {bytes,artifact:imageRef(bytes),recipe,profile:BACKGROUND_BAND_OPEN_DEPTH_GUIDE_PROFILE,role};
}
