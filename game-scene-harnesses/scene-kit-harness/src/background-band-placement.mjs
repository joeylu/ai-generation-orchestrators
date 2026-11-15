import {inspectPng} from './png.mjs';
import {validateDocument} from './schema.mjs';
import {check,clone,digest,hash,unseal} from './generation/common.mjs';
import {validateBackgroundBand,backgroundBandCoverage} from './generation/background-band.mjs';

export function backgroundBandDefinition(plan){return plan.sourceScope?.definition?.backgroundBand??null;}
export function validateBackgroundBandPlacementShape(row){
  check(!validateDocument('ai_scene_background_band_placement_v1',row).length,'BACKGROUND_BAND_PLACEMENT_SHAPE');
  const s=row.sourceToWorld.numerator/row.sourceToWorld.denominator;
  check(s>=.25&&s<=4,'BACKGROUND_BAND_DISPLAY_SCALE');return s;
}
export function createBackgroundBandPlacement({plan,raw,sourceToWorld,positionWorld,target}){
  const png=inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true}),band=backgroundBandDefinition(plan);
  check(band,'BACKGROUND_BAND_SOURCE_REQUIRED');
  const row={instanceId:plan.recipe.assetId,sourcePlanSha256:plan.sha256,sourceRawSha256:hash(raw),backgroundBandSha256:digest(band),
    nativeFrame:{x:0,y:0,width:png.width,height:png.height},sourceToWorld,positionWorld};
  validateBackgroundBandPlacement(row,{plan,raw,target});return clone(row);
}
export function validateBackgroundBandPlacement(row,{plan,raw,target}={}){
  const s=validateBackgroundBandPlacementShape(row),band=backgroundBandDefinition(plan);unseal(plan);
  check(band&&row.instanceId===plan.recipe.assetId&&row.sourcePlanSha256===plan.sha256&&row.sourceRawSha256===hash(raw)
    &&row.backgroundBandSha256===digest(band),'BACKGROUND_BAND_PLACEMENT_BINDING');
  const scope=plan.sourceScope.definition;unseal(scope);
  check(['ai_scene_layer_source_scope_v5','ai_scene_layer_source_scope_v6'].includes(scope.format)&&plan.recipe.sourceScope.sha256===scope.sha256,'BACKGROUND_BAND_PLACEMENT_BINDING');
  validateBackgroundBand(band,{role:plan.instanceBinding.role,layerId:scope.layerId,
    ...(target?{requirements:{layers:target.layers},viewport:target.mapping.viewport}:{})});
  const png=inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true});
  check(row.nativeFrame.width===png.width&&row.nativeFrame.height===png.height,'BACKGROUND_BAND_NATIVE_FRAME');
  let minX=png.width,minY=png.height,maxX=-1,maxY=-1;
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++)if(png.rgba[(y*png.width+x)*4+3]>=8){
    minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
  check(maxX>=0,'BACKGROUND_BAND_VISIBLE_EMPTY');
  const p=row.positionWorld,frame={left:p.x,right:p.x+png.width*s,top:p.y,bottom:p.y+png.height*s},
    visible={left:p.x+minX*s,right:p.x+(maxX+1)*s,top:p.y+minY*s,bottom:p.y+(maxY+1)*s},
    designed=band.coverageFrameWorld,coverage=backgroundBandCoverage(band),u=coverage.union;
  check(frame.left<=designed.x&&frame.right>=designed.x+designed.width&&frame.top<=designed.y&&frame.bottom>=designed.y+designed.height,
    'BACKGROUND_BAND_DESIGN_FRAME_COVERAGE');
  check([frame,visible].every(b=>b.left<u.left&&b.right>u.right&&b.bottom>u.bottom),'BACKGROUND_BAND_TERMINATION_COVERAGE');
  return {profile:'full-native-background-band-placement-v1',placement:clone(row),cameraCoverage:coverage,
    nativeFrameWorld:frame,visibleAlpha8BoundsWorld:visible,actualTerminationMarginsWorld:{left:u.left-visible.left,right:visible.right-u.right,bottom:visible.bottom-u.bottom},
    top:'natural-transparent-silhouette-sky-space-not-required-painted',geometry:'finite-full-frame-and-alpha8-range-pass',
    sideBottomContourContinuity:'requires-human-visual-review',contentContinuity:'not-assessed',styleAndArtAcceptance:'not-assessed',automaticRepeat:false,
    sourceSampling:{profile:'full-native-frame-no-resampling-v1',nativeUpscale:false,pixelsPerWorldPixel:1/s,targetPixelsPerWorldPixel:2,targetReached:1/s>=2},
    sourcePngModified:false,nonzeroAlphaRgbaChanged:false};
}
