import { readStoredArchive, storeArchive } from '../archive.mjs';
import { randomUUID } from 'node:crypto';
import { parseJson } from '../files.mjs';
import { check, exact, hash, id, imageRef, isDigest, jsonBytes, seal, text, unseal } from './common.mjs';
import { ENVIRONMENT_ANIMATION_ATLAS_PROFILE_SHA256 } from './environment-animation-atlas.mjs';
import { ENVIRONMENT_ANIMATION_CONTOUR_PROFILE_SHA256 } from './environment-animation-atlas-contours.mjs';

function freezePlan(planId, projectId, kitSha256, assetId, input, reference) {
  exact(input, ['stateId', 'playback', 'motion', 'columns', 'rows', 'frameMs']);
  const { stateId, playback, motion, columns, rows, frameMs } = input;
  check(isDigest(kitSha256), 'ANIMATION_KIT_IDENTITY');
  check([planId, projectId].every(value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)), 'ANIMATION_PLAN_ID');
  id(assetId); id(stateId); text(motion, { limit: 500 });
  check([columns, rows].every(value => Number.isInteger(value) && value >= 1 && value <= 8)
    && Number.isInteger(frameMs) && frameMs >= 40 && frameMs <= 2000, 'ANIMATION_ATLAS_GRID');
  const count = columns * rows;
  check(playback === 'hold' ? count === 1 : ['once', 'loop'].includes(playback) && count >= 2, 'ANIMATION_FRAME_COUNT');
  const timing = playback === 'loop'
    ? 'Make the sequence loop smoothly without repeating the first pose as the final frame.'
    : playback === 'once' ? 'Preserve the starting pose and include the final settled pose in the last frame.'
      : 'Draw one held pose.';
  const prompt = [
    `Create one transparent RGBA PNG with ${columns} columns and ${rows} rows of equal cells in row-major order, one complete pose per cell.`,
    'Use the attached PNG as the exact appearance reference. Preserve its style, color, material, side view, scale and anchor position in every cell.',
    `Motion or pose direction: ${motion.trim()}`,
    timing,
    'Use consistent cell padding and keep every pose inside its cell. Leave fully transparent space around the object and in its openings. No labels, grid lines, background, fog, ground or shadows.',
  ].join('\n');
  return seal({ format: 'ai_scene_environment_animation_plan_v1', planId, projectId, kitSha256, assetId, input,
    alphaProfiles: [ENVIRONMENT_ANIMATION_ATLAS_PROFILE_SHA256, ENVIRONMENT_ANIMATION_CONTOUR_PROFILE_SHA256],
    request: { images: [{ role: 'appearance-reference', artifact: imageRef(reference) }],
      output: { alpha: 'transparent', count: 1 }, prompt }, dispatchCount: 1, automaticRetry: false });
}

export function exportEnvironmentAnimationPlan(projectId, kitSha256, assetId, input, reference) {
  const plan = freezePlan(randomUUID(), projectId, kitSha256, assetId, input, reference);
  return storeArchive(new Map([['plan.json', jsonBytes(plan)], ['reference.png', reference]]));
}

export function readEnvironmentAnimationPlan(archive) {
  const files = readStoredArchive(archive, { maxBytes: 17 * 1024 * 1024, maxEntries: 2 });
  const reference = files.get('reference.png');
  check(reference && files.has('plan.json') && files.get('plan.json').length <= 16384, 'ANIMATION_PLAN_ARCHIVE');
  const plan = parseJson(files.get('plan.json'), 'plan.json');
  unseal(plan);
  check(freezePlan(plan.planId, plan.projectId, plan.kitSha256, plan.assetId, plan.input, reference).sha256 === plan.sha256,
    'ANIMATION_PLAN_CHANGED');
  return { plan, reference, archiveSha256: hash(archive) };
}
