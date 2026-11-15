import {check,exact,digest,hash,isDigest,seal,receipt,imageRef} from './common.mjs';
import {encodeRgbaPng,inspectPng} from '../png.mjs';
import {resolveReferenceFeatureTargets} from '../reference-feature-layout.mjs';
import {renderReferenceWindowPixels,renderReferenceFeatureMarkers} from './band-composition-guide.mjs';

export const SOURCE_FRAME_GUIDE_ROLE='accepted-reference-in-isolated-source-frame-guide';
export const SOURCE_FRAME_GUIDE_INSTRUCTION='ISOLATED SOURCE FRAME: Image 2 places the accepted reference in the declared asset-local frame. Its numbered marks identify only this source\'s named features; preserve their relative proportions and arrangement. Do not recenter individual parts or enlarge them independently. Image 1 remains the complete original reference. Parts of that original outside the guide frame are context, not missing input pixels. Stripes mark unobserved reserve for explicitly inferred completion, not artwork. The source brief alone owns included subjects; remove all excluded neighbors and never copy markers, stripes, the reference border or background pixels. Return one complete isolated group with genuine transparent openings and enough clear edge space for its own contour, antialiasing and effects. This is not a continuous background band: no paint is required at the left, right or bottom canvas cuts. Do not extend owned forms across the viewport merely to fill it. The program calibrates the actual complete native output using the original named features and tolerances; this guide is a hint, not source or art acceptance.';

function configured({spec,structure,correction,supplement,role}){
 exact(spec,['format','referenceRawSha256','referenceViewport','instanceId','frameWorld','markerRadiusWorld']);
 check(spec.format==='ai_scene_source_frame_guide_spec_v1'&&isDigest(spec.referenceRawSha256),'SOURCE_FRAME_GUIDE_SPEC');
 check(['landmark','scenery','foreground','backdrop','valley'].includes(role),'SOURCE_FRAME_GUIDE_ROLE');
 const resolved=resolveReferenceFeatureTargets(structure,correction,supplement);
 check(spec.referenceRawSha256===resolved.referenceRawSha256&&digest(spec.referenceViewport)===digest(resolved.viewport),'SOURCE_FRAME_GUIDE_REFERENCE');
 const owned=resolved.assets.find(a=>a.instanceId===spec.instanceId);check(owned,'SOURCE_FRAME_GUIDE_OWNER');
 const f=spec.frameWorld;exact(f,['x','y','width','height']);
 check([f.x,f.y,f.width,f.height].every(Number.isSafeInteger)&&Math.abs(f.x)<=4096&&Math.abs(f.y)<=4096
  &&f.width>=32&&f.width<=2048&&f.height>=32&&f.height<=2048&&f.width/f.height>=.25&&f.width/f.height<=4,'SOURCE_FRAME_GUIDE_FRAME');
 check(f.x<resolved.viewport.width&&f.y<resolved.viewport.height&&f.x+f.width>0&&f.y+f.height>0,'SOURCE_FRAME_GUIDE_INTERSECTION');
 const r=spec.markerRadiusWorld;
 check(Number.isFinite(r)&&r>0&&r<=Math.min(...owned.features.map(p=>p.toleranceWorld)),'SOURCE_FRAME_GUIDE_MARKER');
 const features=owned.features.map(p=>({featureId:p.featureId,description:p.description,
  native:{x:[(p.target.x-r-f.x)/f.width,(p.target.x+r-f.x)/f.width],y:[(p.target.y-r-f.y)/f.height,(p.target.y+r-f.y)/f.height]}}));
 check(features.every(p=>[...p.native.x,...p.native.y].every(n=>n>=0&&n<=1)),'SOURCE_FRAME_GUIDE_FEATURE_OUTSIDE');
 return {resolved,owned,features};
}
export function validateSourceFrameGuideConfiguration({spec,decision,structure,correction,supplement,role}){
 configured({spec,structure,correction,supplement,role});receipt(decision,'review');check(decision.decision==='accept','SOURCE_FRAME_GUIDE_DECISION');
}
export function previewSourceFrameGuide({spec,structure,correction,supplement,role,referenceBytes}){
 const {owned,features}=configured({spec,structure,correction,supplement,role}),f=spec.frameWorld;
 check(referenceBytes instanceof Uint8Array&&hash(referenceBytes)===spec.referenceRawSha256,'SOURCE_FRAME_GUIDE_BYTES');
 // Preserve exact aspect with an integer diagnostic raster, bounded by 2048.
 const gcd=(a,b)=>b?gcd(b,a%b):a,g=gcd(f.width,f.height),factor=Math.max(1,Math.floor(512/Math.max(f.width/g,f.height/g)));
 const width=f.width/g*factor,height=f.height/g*factor,rgba=Buffer.alloc(width*height*4),scale=f.width/width;
 const native=inspectPng(Buffer.from(referenceBytes),{allowCabx:true,allowHiddenRgb:true}),v=spec.referenceViewport,byWidth=v.width*native.height<=v.height*native.width;
 const numerator=byWidth?v.width:v.height,denominator=byWidth?native.width:native.height;
 const resized={width:Math.floor(native.width*numerator/denominator),height:Math.floor(native.height*numerator/denominator)};
 const referenceContentFrame={x:Math.floor((v.width-resized.width)/2),y:Math.floor((v.height-resized.height)/2),...resized};
 const referenceMapping=renderReferenceWindowPixels({width,height,rgba,spec,referenceBytes,referenceContentFrame,assessment:{witness:{scale,x:f.x,y:f.y}}});
 renderReferenceFeatureMarkers({width,height,rgba,features});
 const bytes=encodeRgbaPng(width,height,rgba),artifact=imageRef(bytes);
 const recipe=seal({format:'ai_scene_source_frame_guide_recipe_v1',specSha256:digest(spec),structureSha256:structure.sha256,
  ...(correction?{featureCorrectionSha256:digest(correction)}:{}),...(supplement?{featureSupplementSha256:digest(supplement)}:{}),referenceRawSha256:spec.referenceRawSha256,instanceId:owned.instanceId,
  referenceMapping,frameWorld:f,featureIds:features.map(p=>p.featureId),markerRadiusWorld:spec.markerRadiusWorld,
  frameUsage:'asset-local-registration-hint-not-painted-coverage',markerUsage:'locator-only-original-feature-tolerances-unchanged',
  sourceBoundary:'complete-isolated-contour-all-four-edges-transparent',segmentationPerformed:false,sourcePixelsProduced:0,humanArtAcceptance:'not-assessed'});
 const proposal=seal({format:'ai_scene_source_frame_guide_proposal_v1',specSha256:digest(spec),structureSha256:structure.sha256,
  ...(correction?{featureCorrectionSha256:digest(correction)}:{}),...(supplement?{featureSupplementSha256:digest(supplement)}:{}),referenceRawSha256:spec.referenceRawSha256,artifact,recipeSha256:recipe.sha256,
  generationCalls:0,humanArtAcceptance:'not-assessed'});
 return {bytes,artifact,recipe,proposal,role:SOURCE_FRAME_GUIDE_ROLE};
}
export function sourceFrameGuide(options){
 const guide=previewSourceFrameGuide(options);receipt(options.decision,'review');
 check(options.decision.decision==='accept'&&options.decision.targetSha256===guide.proposal.sha256,'SOURCE_FRAME_GUIDE_DECISION');return guide;
}
