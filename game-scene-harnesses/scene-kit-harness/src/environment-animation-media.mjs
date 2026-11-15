import { demand, uniqueIds } from './errors.mjs';
import { animationFrameRect, measureEnvironmentAnimationBaseLock, registerEnvironmentAnimationPose,
  supportsEnvironmentAnimation } from './environment-animation.mjs';
import { inspectPng } from './png.mjs';
import { validateEnvironmentAnimationAtlas } from './generation/environment-animation-atlas.mjs';

export const animationPngPath = sha256 => `animations/${sha256}.png`;

export function measureEnvironmentAnimationRegistration(source, atlas, { columns, rows }) {
  const still = inspectPng(source, { includePixels: true });
  const image = inspectPng(atlas, { includePixels: true, allowCabx: true, allowHiddenRgb: true });
  const rect = animationFrameRect(0, image.width, image.height, columns, rows);
  return registerEnvironmentAnimationPose(still, image, rect);
}

export function measureEnvironmentAnimationAtlasBaseLock(atlas, grid) {
  const image = inspectPng(atlas, { includePixels: true, allowCabx: true, allowHiddenRgb: true });
  return measureEnvironmentAnimationBaseLock(image.width, image.height, grid, rect => ({ image, rect }));
}

export function checkEnvironmentAnimationAtlas(bytes, grid, artifact = 'animation.png') {
  try { return validateEnvironmentAnimationAtlas(bytes, grid); }
  catch (error) {
    demand(false, error.errors?.[0]?.code ?? 'ANIMATION_PNG_INVALID', artifact, '/', 'Invalid animation PNG or frame grid');
  }
}

export function validateEnvironmentAnimation(module, artifact, at) {
  const { animation } = module;
  const require = (value, code, message) => demand(value, code, artifact, at, message);
  require(supportsEnvironmentAnimation(module), 'ANIMATION_MODULE_KIND', 'Only ordinary environment modules may animate');
  uniqueIds(animation.states, 'id', artifact, at + '/states');
  const ids = new Set(animation.states.map(state => state.id));
  require(ids.has(animation.initial), 'ANIMATION_INITIAL', 'The initial state must exist');
  if (animation.type === 'idle') {
    const [idle] = animation.states;
    require(animation.states.length === 1 && idle.id === 'idle' && idle.playback === 'loop'
      && !idle.onInteract && !idle.onFinish, 'ANIMATION_IDLE', 'Default animation must contain only the looping idle state');
  }
  for (const state of animation.states) {
    require(state.name.trim() && !/[\x00-\x1f\x7f]/.test(state.name), 'ANIMATION_STATE_NAME', 'State name must contain visible text');
    require(!state.onInteract || ids.has(state.onInteract), 'ANIMATION_TRANSITION', 'Interaction target must exist');
    require(!state.onFinish || (state.playback === 'once' && ids.has(state.onFinish)), 'ANIMATION_TRANSITION', 'Finish target requires a one-shot animation and an existing state');
    const clip = state.clip;
    require(clip || state.playback === 'hold', 'ANIMATION_CLIP_REQUIRED', 'A looping or one-shot state needs animation frames');
    if (!clip) continue;
    const count = clip.columns * clip.rows;
    require(state.playback === 'hold' ? count === 1 : count >= 2, 'ANIMATION_FRAME_COUNT', 'A held state uses one frame and a moving state uses at least two');
    if (clip.baseLock) require(count >= 2 && clip.baseLock.length === count, 'ANIMATION_BASE_LOCK',
      'Base lock requires one offset per frame of a moving clip');
    require(clip.source.path === animationPngPath(clip.source.sha256), 'ANIMATION_SOURCE_PATH', 'Animation sources use their checked content hash');
    require(clip.anchorPx.x >= 0 && clip.anchorPx.x < clip.frameSize.width && clip.anchorPx.y >= 0
      && clip.anchorPx.y < clip.frameSize.height, 'ANIMATION_ANCHOR', 'Animation anchor must lie inside the frame');
  }
}
