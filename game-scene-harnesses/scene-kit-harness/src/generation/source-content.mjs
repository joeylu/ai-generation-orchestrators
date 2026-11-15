import {check} from './common.mjs';

// Explicit ownership is task data. Neither a material family nor a placement
// label may add subjects or erase fixed members of this reviewed group.
export const SOURCE_CONTENT_PROFILE='scope-owned-content-v1';
export const MATERIAL_SAMPLING_CONTENT_PROFILE='scope-owned-material-sampling-v1';
export const REGISTERED_BAND_CONTENT_PROFILE='scope-owned-registered-band-v1';
export const REGISTERED_BAND_REGISTRATION_PROFILE='scope-owned-band-registration-v1';
export function validateSourceContent(scope){
  if(!Object.hasOwn(scope,'contentProfile'))return;
  const material=scope.contentProfile===MATERIAL_SAMPLING_CONTENT_PROFILE;
  const registeredBand=[REGISTERED_BAND_CONTENT_PROFILE,REGISTERED_BAND_REGISTRATION_PROFILE].includes(scope.contentProfile);
  check(scope.contentProfile===SOURCE_CONTENT_PROFILE||material||registeredBand,'SOURCE_CONTENT_PROFILE');
  if(material)check(scope.role===undefined||scope.role==='ground'||scope.role==='material','SOURCE_CONTENT_ROLE');
  if(registeredBand&&Object.hasOwn(scope,'contentOrigin'))check(['backdrop','valley'].includes(scope.role)
    &&scope.bandCompositionGuide?.spec?.format==='ai_scene_band_composition_guide_spec_v3'
    &&!Object.hasOwn(scope.bandCompositionGuide.spec,'instructionProfile'),'SOURCE_CONTENT_REGISTERED_BAND');
  check(scope.contentOrigin===undefined||scope.contentOrigin==='explicit-source-brief','SOURCE_CONTENT_ORIGIN');
}
export const MATERIAL_SAMPLING_CONTENT_INSTRUCTION='Opaque continuous terrain MATERIAL FIELD only. Follow the single-asset brief for the canvas proportions, thin surface cover, attached transition and uninterrupted usable body. Keep the transition attached to the same supporting material. No scene layout, terrain silhouette, holes or atlas.';
export function sourceContentInstruction(role,engineered){
  if(role==='material')return engineered
    ?'Opaque continuous manufactured MATERIAL FIELD only: one uninterrupted thin wearing surface and its attached fascia above the supporting material body. The brief owns material identity. No scene, silhouettes, separate objects, holes or atlas.'
    :'Opaque continuous MATERIAL FIELD only: one uninterrupted thin surface lip above the supporting material body. The brief owns material identity. No scene, silhouettes, separate objects, holes or atlas.';
  if(role==='sky')return 'Opaque background filling the complete canvas. Its depicted atmosphere, sky or other background content and illumination come only from the explicit source brief and reference; do not infer a city, night or terrestrial setting from a material family.';
  if(role==='platform')return 'One complete side-view playable platform with a thin cap and supported shallow body. Its physical identity and owned attachments come only from the explicit source brief; do not add unrequested support structures or a receding walkable plane.';
  return 'One complete source-owned group. Every included body, attached part and allowed support is named in the explicit source brief. Preserve its requested depth, original materials and real transparent openings; leave all excluded neighboring subjects to their own sources. A role or material-family label does not prescribe mountains, buildings, vegetation or any other subject.';
}
export const SOURCE_GROUP_INSTRUCTION='Exactly ONE reviewed source-owned group belongs in this output. Repeated subject-instance counts refer to separate requests: generate only ONE instance here, not a sheet or a group of independent copies. Preserve every explicitly owned member of that one instance, including opposite-side members of a fixed group, and their relative arrangement and openings. Scene placement labels do not add members. Independently editable neighboring subjects remain separate sources. Use this group\'s own complete canvas; no pixel-exact reconstruction or new coordinate gate is implied.';
