import { randomUUID } from 'node:crypto';
import { contextFor, loadRevisedSceneKit } from '../kit.mjs';
import { check, exact, hash, jsonBytes } from '../generation/common.mjs';
import { inspectPng } from '../png.mjs';
import { environmentAlphaEvidence } from '../generation/environment-source.mjs';
import { environmentLibraryEdgeAlphaLimit } from '../generation/environment-library-plan.mjs';
import { generatedEnvironmentId } from './generated-environment-id.mjs';
import { animationPngPath, checkEnvironmentAnimationAtlas, measureEnvironmentAnimationAtlasBaseLock,
  measureEnvironmentAnimationRegistration } from '../environment-animation-media.mjs';
import { defaultEnvironmentAnimationAnchor, supportsEnvironmentAnimation } from '../environment-animation.mjs';

export function appendEnvironmentModule(handle, candidate) {
  const context = contextFor(handle);
  const { kit, catalog } = structuredClone({ kit: context.kit, catalog: context.catalog });
  const assetId = generatedEnvironmentId(candidate.jobId);
  const source = { path: `assets/${assetId}.png`, sha256: hash(candidate.bytes), byteLength: candidate.bytes.length };
  check(!context.modules.has(assetId) && !context.files.has(source.path) && source.sha256 === candidate.sprite.sha256,
    'ENVIRONMENT_ASSET_CONFLICT');
  const image = inspectPng(candidate.bytes, { includePixels: true });
  const bounds = environmentAlphaEvidence(image, 'environment',
    { minimumAlpha: environmentLibraryEdgeAlphaLimit + 1 }).contentBounds
    ?? environmentAlphaEvidence(image, 'environment').contentBounds;
  check(bounds, 'ENVIRONMENT_OUTPUT_EMPTY');
  catalog.modules.push({
    assetId, kind: 'environment', source, pixelSize: { width: image.width, height: image.height },
    ...(candidate.placementRole !== undefined ? { placementRole: candidate.placementRole } : {}),
    footprint: { columns: 1, rows: 1 },
    anchorPx: { x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + bounds.height - 1 },
    visualOffset: { x: 0, y: 0 }, allowedTransforms: ['identity'], repeatAxis: 'none',
  });
  const files = new Map(context.files);
  files.set(source.path, candidate.bytes);
  return reviseEnvironmentKit(handle, context, kit, catalog, files, `environment-${candidate.jobId}`);
}

export function updateEnvironmentAnimation(handle, assetId, draft) {
  const context = contextFor(handle);
  const { kit, catalog } = structuredClone({ kit: context.kit, catalog: context.catalog });
  const module = catalog.modules.find(item => item.assetId === assetId);
  check(supportsEnvironmentAnimation(module), 'ANIMATION_MODULE_KIND');
  const files = new Map(context.files);
  if (draft === null) delete module.animation;
  else {
    exact(draft, ['type', 'initial', 'states']);
    check(['idle', 'interactive'].includes(draft.type) && Array.isArray(draft.states)
      && draft.states.length > 0 && draft.states.length <= 12, 'ANIMATION_CONFIG');
    const existing = new Map(module.animation?.states.filter(state => state.clip)
      .map(({ clip }) => [clip.source.sha256, clip]));
    const states = draft.states.map(state => {
      check(state && typeof state === 'object', 'ANIMATION_CONFIG');
      exact(state, ['id', 'name', 'playback', ...['onInteract', 'onFinish', 'clip'].filter(key => Object.hasOwn(state, key))]);
      const { clip, ...config } = state;
      if (!clip) return config;
      check(typeof clip === 'object', 'ANIMATION_CONFIG');
      const upload = Object.hasOwn(clip, 'png');
      exact(clip, ['columns', 'rows', 'frameMs', upload ? 'png' : 'sha256',
        ...['anchorPx', 'baseLock'].filter(key => Object.hasOwn(clip, key))]);
      const { columns, rows, frameMs } = clip;
      check(Number.isInteger(frameMs) && frameMs >= 40 && frameMs <= 2000, 'ANIMATION_FRAME_TIME');
      check(!Object.hasOwn(clip, 'baseLock') || (clip.baseLock === true && config.playback !== 'hold'), 'ANIMATION_BASE_LOCK');
      let media;
      if (upload) {
        check(typeof clip.png === 'string' && clip.png.length <= 22369624, 'ANIMATION_ATLAS_BYTES');
        media = Buffer.from(clip.png, 'base64');
        check(media.toString('base64') === clip.png, 'ANIMATION_ATLAS_BYTES');
      } else {
        const retained = existing.get(clip.sha256);
        check(retained, 'ANIMATION_CLIP_MISSING');
        media = files.get(retained.source.path);
      }
      const atlas = checkEnvironmentAnimationAtlas(media, { columns, rows });
      const frameSize = atlas.frameSize, sha256 = atlas.rawSha256, path = animationPngPath(sha256);
      const anchorPx = clip.anchorPx ?? defaultEnvironmentAnimationAnchor(module, frameSize);
      const registration = clip.anchorPx ? undefined
        : measureEnvironmentAnimationRegistration(files.get(module.source.path), media, { columns, rows });
      const baseLock = clip.baseLock ? measureEnvironmentAnimationAtlasBaseLock(media, { columns, rows }) : undefined;
      check(!clip.baseLock || baseLock, 'ANIMATION_BASE_LOCK');
      files.set(path, media);
      return { ...config, clip: { columns, rows, frameMs, frameSize, anchorPx,
        ...(registration ? { registration } : {}), ...(baseLock ? { baseLock } : {}),
        source: { path, sha256, byteLength: media.length } } };
    });
    module.animation = { ...draft, states };
  }
  return reviseEnvironmentKit(handle, context, kit, catalog, files, `environment-${randomUUID()}`);
}

function reviseEnvironmentKit(handle, context, kit, catalog, files, revision) {
  kit.revision = revision;
  const kitRef = { kitId: kit.kitId, revision };
  for (const [ref, doc] of [
    [kit.files.catalog, catalog], [kit.files.rules, context.rules], [kit.files.presets, context.library],
    [kit.files.maps.default, context.maps.default], [kit.files.maps.inspection, context.maps.inspection],
  ]) {
    const bytes = jsonBytes({ ...doc, kitRef });
    ref.sha256 = hash(bytes);
    files.set(ref.path, bytes);
  }
  files.set('kit.json', jsonBytes(kit));
  return loadRevisedSceneKit(handle, files);
}
