import { deepFreeze } from '../document.mjs';

export const SNOW_SURFACE_PROFILE = deepFreeze({ format: 'ai_scene_snow_surface_profile_v1',
  profile: 'sideview-snow-full-upper-eighth-depth16-v1', parentProfileSha256: 'eea16fad6eb3530f9a9586877bf9c9aace07137d5f893f75a6218eb09a4b51dd',
  crop: 'same-body-x-full-source-upper-eighth-floor', capDepthPx: 16,
  field: { width: 505, height: 16, blend: 4 }, body: 'unchanged-reference-field-v1',
  topology: 'original-study-alpha-and-collision-unchanged', capMapping: 'world-x-512-v1',
  shade: 'exposed-left-right-two-pixels-only-v1',
  generationCalls: 0, productionKit: false, visualAcceptance: 'not-assessed' });
export const SNOW_SURFACE_SHA256 = 'c0ffe5b2bb0aaa758ceacb1feff8da5261bf93a34fd1db77e4d7c788d0a6d729';
