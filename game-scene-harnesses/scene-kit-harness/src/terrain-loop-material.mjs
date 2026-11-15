import {clone} from './document.mjs';
import {check} from './generation/common.mjs';

// The validated base appearance remains the source of authoring geometry and
// surface measurements. Only an explicit replayed loop selects a new render
// texture and its rational physical period; historical kits stay unchanged.
export function resolveTerrainMaterialAppearance(appearance,loop,rigid,surfaceCycle){
  if(surfaceCycle){
    const body=resolveTerrainMaterialAppearance(appearance,loop,rigid);
    return {...clone(body),format:'ai_scene_continuous_terrain_appearance_v9',bodyMaterialFormat:body.format,
      cap:clone(surfaceCycle.output),surfaceCycleSha256:surfaceCycle.sha256,surfaceCycleProfile:surfaceCycle.profile};
  }
  check(!loop||!rigid,'RIGID_REPEAT_CONFLICT');
  if(rigid)return {...clone(appearance),format:'ai_scene_continuous_terrain_appearance_v8',
    body:clone(rigid.output),bodyPeriod:clone(rigid.bodyPeriod),bodyOriginWorldY:clone(rigid.phaseOriginWorldY),
    bodyRepeatSha256:rigid.sha256,bodyRepeatProfile:rigid.profile,selection:'world-phase-rigid-source-row-repeat-v1'};
  if(!loop)return appearance;
  return {...clone(appearance),format:'ai_scene_continuous_terrain_appearance_v7',
    body:clone(loop.output),bodyPeriod:clone(loop.bodyPeriod),bodyLoopSha256:loop.sha256,
    bodyLoopProfile:loop.profile,selection:'world-phase-source-pixel-cycle-local-surface-v1'};
}

// The original interface declares native rows in the unchanged source frame.
// Its effective render binding follows the independently replayed cap cycle.
export function resolveTerrainSurfaceInterface(value,surfaceCycle){
  if(!surfaceCycle)return value;
  check(value?.capSourceSha256===surfaceCycle.sourceInput.sha256,'SURFACE_CYCLE_INTERFACE_BINDING');
  return {...clone(value),capSourceSha256:surfaceCycle.output.source.sha256};
}
