import {canonicalJson} from './document.mjs';
import {check,digest,seal,unseal} from './generation/common.mjs';
import {validateTerrainSurfaceInterface} from './terrain-union-material.mjs';
import {validateTerrainSurfaceSpanProfile} from './terrain-surface-span-envelope.mjs';
import {validateTerrainStepCorners} from './terrain-step-corners.mjs';

export const TERRAIN_STEP_SURFACE_PROFILE='native-lip-bound-step-coverage-v1';
export const TERRAIN_STEP_LINEAR_SURFACE_PROFILE='native-lip-linear-step-end-v2';

// The two validation modules reference functions only after module initialization.
// Preserve the v1 ramp geometry contract; this independent binding opts in solely
// to reducing its cap inside the legacy fully opaque depth.
export function buildTerrainStepSurface({appearance,surfaceInterface,surfaceSpanEnvelope,stepCorners,profile=TERRAIN_STEP_SURFACE_PROFILE}){
  check([TERRAIN_STEP_SURFACE_PROFILE,TERRAIN_STEP_LINEAR_SURFACE_PROFILE].includes(profile),'STEP_SURFACE_PROFILE');
  const linear=profile===TERRAIN_STEP_LINEAR_SURFACE_PROFILE;
  validateTerrainStepCorners(stepCorners);
  const depths=validateTerrainSurfaceInterface(surfaceInterface,appearance),depth=appearance.capDepth.numerator/appearance.capDepth.denominator,
    legacyOpaqueDepth=depth-Math.min(12,depth/2);
  check(depths.overlayDepthWorld<=legacyOpaqueDepth+1e-9,'STEP_SURFACE_REDUCTION',
    'The complete native lip must fit inside the legacy opaque cap; this profile never adds coverage');
  if(surfaceSpanEnvelope)validateTerrainSurfaceSpanProfile(surfaceSpanEnvelope,{appearance,surfaceInterface});
  return seal({format:linear?'ai_scene_terrain_step_surface_v2':'ai_scene_terrain_step_surface_v1',profile,
    capSourceSha256:appearance.cap.source.sha256,capMappingSha256:digest({cap:appearance.cap,capDepth:appearance.capDepth,capUvEnd:appearance.capUvEnd}),
    interfaceSha256:digest(surfaceInterface),...(surfaceSpanEnvelope?{surfaceSpanEnvelopeSha256:surfaceSpanEnvelope.sha256}:{}),stepCornerProfileSha256:digest(stepCorners),
    coveragePolicy:linear?'cropped-cap-linear-wall-end-v2':'crop-within-legacy-opaque-cap-v1',supportPolicy:'retain-legacy-full-cap-probes-v1',
    ...(linear?{endFade:{profile:'linear-vertex-coverage-v1',overlapWorld:8,overlapColumns:4,opacityAtWall:1,opacityAtEnd:0,
      rowFade:'existing-native-row-bands',maximumVerticesPerMesh:400,compiledFormat:'ai_scene_compiled_v8'}}:{}),
    sourcePngChanged:false,sourceCoordinatesWarped:false,authorGeometryChanged:false,generationCalls:0,visualAcceptance:'not-assessed'});
}

export function validateTerrainStepSurface(record,inputs){
  unseal(record);check(canonicalJson(record)===canonicalJson(buildTerrainStepSurface({...inputs,profile:record.profile})),'STEP_SURFACE_REPLAY');return record;
}
