import {inspectPng} from '../png.mjs';
import {check,exact,id,text,digest,hash,isDigest,seal,unseal,receipt} from './common.mjs';
import {validateBackgroundBand,backgroundBandCoverage} from './background-band.mjs';
import {bandLayoutFeasibility} from './band-layout-feasibility.mjs';

export const REGISTERED_MASTER_EDIT_ROLE='registered-background-layout-master-edit-target';
export const REGISTERED_LOCAL_EDIT_ROLE='transparent-background-band-local-edit-target';
const LOCAL_EDIT_PROFILE='transparent-local-feature-edit-v1';
export const isRegisteredMasterSpec=s=>s?.format==='ai_scene_band_master_edit_spec_v1';
export const isRegisteredLocalEdit=s=>isRegisteredMasterSpec(s)&&s.instructionProfile===LOCAL_EDIT_PROFILE;
export const registeredMasterInputRole=spec=>isRegisteredLocalEdit(spec)?REGISTERED_LOCAL_EDIT_ROLE:REGISTERED_MASTER_EDIT_ROLE;
// Describes a supplied artifact, never claims that it was rendered/segmented by
// this function. Compilation separately reads and verifies the actual PNG.
export function describeRegisteredMasterGuide({band,role,spec,decision}){
  validateBackgroundBand(band,{role});check(isRegisteredMasterSpec(spec)&&['ai_scene_background_band_v3','ai_scene_background_band_v4'].includes(band.format),'REGISTERED_MASTER_PROFILE');
  const localEdit=isRegisteredLocalEdit(spec);
  exact(spec,['format','referenceRawSha256','referenceStructureSha256','referenceViewport','master','features',...(Object.hasOwn(spec,'instructionProfile')?['instructionProfile']:[]),...(localEdit?['editRegion']:[])]);if(Object.hasOwn(spec,'instructionProfile'))check(localEdit||spec.instructionProfile==='owned-surface-continuation-v2','REGISTERED_MASTER_INSTRUCTIONS');check(isDigest(spec.referenceRawSha256)&&isDigest(spec.referenceStructureSha256),'REGISTERED_MASTER_REFERENCE');
  exact(spec.referenceViewport,['width','height']);check(Object.values(spec.referenceViewport).every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096),'REGISTERED_MASTER_VIEWPORT');
  exact(spec.master,['artifact','positionWorld','sourceToWorld']);const {artifact:a,positionWorld:p,sourceToWorld:r}=spec.master;
  exact(a,['sha256','byteLength','pixelSize']);exact(a.pixelSize,['width','height']);check(isDigest(a.sha256)&&a.sha256!==spec.referenceRawSha256&&Number.isSafeInteger(a.byteLength)&&a.byteLength>0&&a.byteLength<=16777216&&Object.values(a.pixelSize).every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096),'REGISTERED_MASTER_ARTIFACT');
  if(localEdit){
    const region=spec.editRegion;exact(region,['x','y','width','height']);
    check(Object.values(region).every(Number.isSafeInteger)&&region.x>0&&region.y>1&&region.width>0&&region.height>0
      &&region.x+region.width<a.pixelSize.width&&region.y+region.height<a.pixelSize.height,'REGISTERED_LOCAL_EDIT_REGION');
  }
  exact(p,['x','y']);exact(r,['numerator','denominator']);check(Object.values(p).every(n=>Number.isFinite(n)&&Math.abs(n)<=65536)&&Object.values(r).every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096),'REGISTERED_MASTER_PLACEMENT');const s=r.numerator/r.denominator;check(s>=.25&&s<=4,'REGISTERED_MASTER_SCALE');
  check(Array.isArray(spec.features)&&spec.features.length>=2&&spec.features.length<=12,'REGISTERED_MASTER_FEATURES');const ids=new Set();for(const f of spec.features){exact(f,['featureId','description','native','target']);id(f.featureId);text(f.description,{limit:200});check(!ids.has(f.featureId),'REGISTERED_MASTER_FEATURES');ids.add(f.featureId);}
  const f=band.coverageFrameWorld,feasibility=bandLayoutFeasibility({sourceSize:a.pixelSize,coverage:{x:[f.x,f.x+f.width],y:[f.y,f.y+f.height]},scale:[s,s],translation:{x:[p.x,p.x],y:[p.y,p.y]},features:spec.features.map(({featureId,native,target})=>({featureId,native,target}))});check(feasibility.status==='feasible','REGISTERED_MASTER_INFEASIBLE');
  const recipe=seal({format:'ai_scene_band_master_edit_recipe_v1',profile:localEdit?LOCAL_EDIT_PROFILE:'registered-layout-master-edit-v1',referenceRawSha256:spec.referenceRawSha256,referenceStructureSha256:spec.referenceStructureSha256,referenceViewport:spec.referenceViewport,master:spec.master,bandSha256:digest(band),specSha256:digest(spec),featureIds:spec.features.map(f=>f.featureId),feasibility,cameraCoverage:backgroundBandCoverage(band),inputMode:localEdit?'single-native-parent-edit-target-original-reference-retained-as-evidence':'single-prepared-edit-target-original-reference-retained-as-evidence',...(localEdit?{editRegion:spec.editRegion}:{}),sourcePngModified:false,masterOriginalPixelsModified:false,segmentationPerformed:false,semanticRegistration:'explicit-review-not-automatic-recognition',humanArtAcceptance:'not-assessed'});
  const proposal=seal({format:'ai_scene_band_master_edit_proposal_v1',profile:recipe.profile,referenceRawSha256:spec.referenceRawSha256,referenceStructureSha256:spec.referenceStructureSha256,bandSha256:digest(band),specSha256:digest(spec),artifact:a,recipeSha256:recipe.sha256,generationCalls:0,humanArtAcceptance:'not-assessed'});
  if(decision){receipt(decision,'review');check(decision.decision==='accept'&&decision.targetSha256===proposal.sha256,'REGISTERED_MASTER_DECISION');}
  return {artifact:a,recipe,proposal,profile:recipe.profile,role};
}
export function previewRegisteredMasterGuide({masterBytes,...options}){
  const g=describeRegisteredMasterGuide(options),a=g.artifact;check(masterBytes instanceof Uint8Array&&masterBytes.length===a.byteLength&&hash(masterBytes)===a.sha256,'REGISTERED_MASTER_BYTES');const png=inspectPng(Buffer.from(masterBytes),{includePixels:true,pixelStats:true,allowCabx:true,allowHiddenRgb:true});
  const expectedAlpha=isRegisteredLocalEdit(options.spec)?png.transparentPixels>0&&png.nonzeroAlphaPixels>0:png.transparentPixels===0;
  check(digest(a.pixelSize)===digest({width:png.width,height:png.height})&&expectedAlpha&&png.varied,'REGISTERED_MASTER_PNG');return {...g,bytes:Buffer.from(masterBytes)};
}
function localFeatureEditPrompt(scope,guide){
  const {width,height}=guide.artifact.pixelSize,{x,y,width:w,height:h}=guide.recipe.editRegion;
  const nativeRanges=scope.bandCompositionGuide.spec.features.map(({description,native})=>{
    const [left,right]=native.x.map(v=>v*width),[top,bottom]=native.y.map(v=>v*height);
    return `Keep or place ${description} Its crest center belongs at x ${Math.ceil(left)}–${Math.floor(right)}, y ${Math.ceil(top)}–${Math.floor(bottom)}.`;
  });
  return [
    `Edit the attached native transparent layer in place. Keep the whole ${width} by ${height} PNG canvas, including the original transparent field and existing material at the side and bottom cuts. Pixel coordinates start at the top-left of the entire canvas.`,
    `Limit painting and blending to x ${x}–${x+w-1}, y ${y}–${y+h-1}. Preserve the original appearance and continuous Alpha outside that rectangle. Keep true sky and real openings clear inside it. Retain the existing scale, depth and material elsewhere.`,
    scope.content,
    ...nativeRanges,
    `Exclude entirely: ${scope.exclusions.join('; ')}.`,
    ...(scope.sourceAppearance?[`Source-owned appearance rules: ${JSON.stringify(scope.sourceAppearance.rules)}`]:[]),
    'Return one native transparent PNG at the original dimensions. Keep the top two rows clear and maintain real transparency in the openings. Preserve the single-layer identity and brushwork. Keep all labels, frames and comparison graphics out of the output.',
  ].join('\n\n');
}
export function registeredMasterEditPlan(compiled,scope){
  const g=describeRegisteredMasterGuide({band:scope.backgroundBand,role:scope.role,...scope.bandCompositionGuide}),far=scope.role==='backdrop',ownedContinuation=scope.bandCompositionGuide.spec.instructionProfile==='owned-surface-continuation-v2',continuousDepthscape=!far&&scope.backgroundBand.format==='ai_scene_background_band_v3';
  if(isRegisteredLocalEdit(scope.bandCompositionGuide.spec)){
    const body=unseal(compiled);
    return seal({...body,compiler:body.compiler+'-'+LOCAL_EDIT_PROFILE,sourceScope:{...body.sourceScope,
      referenceUsage:'transparent-native-parent-local-edit-with-original-reference-bound-as-evidence',
      registeredLayoutMaster:{artifact:g.artifact,referenceRawSha256:g.recipe.referenceRawSha256,recipeSha256:g.recipe.sha256,inputRole:REGISTERED_LOCAL_EDIT_ROLE}},
      request:{...body.request,prompt:localFeatureEditPrompt(scope,g),images:[{role:REGISTERED_LOCAL_EDIT_ROLE,artifact:g.artifact}]}});
  }
  const prompt=[
    'EDIT THE ATTACHED REGISTERED LAYOUT MASTER IN PLACE. This image is the edit target, not an illustration to reinterpret. Keep its whole canvas, original framing, and every retained source-owned feature at the SAME pixel position and size. Do not zoom, crop, recenter, rescale or redesign the owned structures. This is one selective layer edit; output only the layer specified below.',
    far?'DISTANT LAYER ONLY: retain only the declared distant forms and their existing skyline at their current locations. Remove every separately owned atmosphere, middle-depth, foreground and structural group named by the brief and exclusions. Complete only the distant group\'s own concealed material continuation where requested, preserving its original atmospheric hierarchy. Leave genuine transparent sky and openings above and around its natural silhouettes.':continuousDepthscape?'CONTINUOUS MIDDLE/REAR DEPTHSCAPE: retain the whole declared painted terrain below its natural upper contour, its structures and its original aerial perspective. Pale atmospheric depth painted on and between its overlapping terrain forms belongs to this continuous depthscape. It is not an instruction to erase those pixels, expose hidden rock, sharpen/dehaze the canyon, or manufacture transparent holes. Preserve the input colors and occlusion of that owned depth painting. Remove only the separately owned distant skyline and sky above the middle contour, plus any explicitly unowned object. Genuine openings above and around that contour remain transparent. Do not fabricate new walls or supports.':'MIDDLE/REAR DEPTH LAYER ONLY: retain only the declared source-owned material forms, structures, supports and local relationships at their existing pixels. Remove the separately owned distant, atmosphere and foreground content named by the brief and exclusions. Leave the removed regions and true gaps genuinely transparent; never fill an actual void with an opaque atmosphere sheet. Do not introduce new dominant support forms or close real openings.',
    `SINGLE-SOURCE BRIEF: ${scope.content}`,
    `Exclude entirely: ${scope.exclusions.join('; ')}.`,
    ...(ownedContinuation?['OWNED SURFACE CONTINUATION: retain ALL masses assigned to this layer throughout the FULL input canvas, including its own lower and side continuation. A finite-cut background layer is not an isolated object cutout. Do not cut a second scalloped contour under the owned terrain or make it float above the bottom. Retain the input pixels of its visible owned walls/earth all the way to their existing side and bottom cuts. Only actual gaps between separate forms are transparent. A group that merely appears nearer within this assigned terrain remains part of it; it is not a separate near-camera decoration. The single-source brief defines ownership. For a distant layer, its own declared skyline is retained; the generic horizon-backdrop exclusion refers to a separately painted backdrop/sky sheet, not that owned skyline.']:[]),
    'The supplied master intentionally contains other depth groups to show registration; their presence does not assign them to this source. Complete only source-owned concealed continuation when necessary, without shifting the already visible layout. The original accepted reference and immutable structure remain bound as plan evidence. An observed occlusion boundary is not a request for a physical end cap.',
    'Keep the full native canvas and at least TWO completely transparent rows along the outer top. Left, right and bottom are finite cuts: owned forms crossing a cut continue to it, while true empty space remains transparent. Do not shrink to an isolated centered object or add transparent perimeter padding. Preserve the input material colors, lighting and painterly hierarchy in the retained layer.',
    ...(scope.sourceAppearance?[`Source-owned appearance rules: ${JSON.stringify(scope.sourceAppearance.rules)}`]:[]),
    'Return ONE native transparent PNG with continuous Alpha and real openings. No sky wash, checkerboard, diagnostic stripe, labels, UI, atlas or comparison panel. No post-generation Alpha cleanup, silhouette repair, recoloring or automatic retry is authorized. Actual source ownership, feature registration, finite camera coverage and complete recomposition require independent review.'
  ].join('\n\n');
  const {sha256,...body}=compiled;return seal({...body,...(ownedContinuation||continuousDepthscape?{compiler:body.compiler+(ownedContinuation?'-owned-surface-continuation-v2':'')+(continuousDepthscape?'-continuous-depthscape-v3':'')}:{}),sourceScope:{...body.sourceScope,referenceUsage:'registered-layout-master-edit-target-with-original-reference-bound-as-evidence',registeredLayoutMaster:{artifact:g.artifact,referenceRawSha256:scope.bandCompositionGuide.spec.referenceRawSha256,recipeSha256:g.recipe.sha256,inputRole:REGISTERED_MASTER_EDIT_ROLE}},request:{...body.request,prompt,images:[{role:REGISTERED_MASTER_EDIT_ROLE,artifact:g.artifact}]} });
}
