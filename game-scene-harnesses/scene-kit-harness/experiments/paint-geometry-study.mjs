// Offline arithmetic experiment. No PNG/file input, provider, workflow or Studio entry.
// Synthetic evidence is not a human review and grants no authority over real artwork.
import { check, exact, hash, seal, unseal } from '../src/generation/common.mjs';
import { raster, validateRaster, blit } from '../src/terrain-proof/raster.mjs';

export function deriveSyntheticPaintGeometry(paint, alpha, spec, fixtureReview) {
  validateRaster(paint);
  const body = unseal(spec), review = unseal(fixtureReview);
  exact(body, ['format', 'purpose', 'paintRgbaSha256', 'alphaSha256', 'localCanvas', 'sceneCanvas', 'origin', 'unresolvedPixels']);
  exact(review, ['format', 'scope', 'specSha256', 'decision']);
  check(body.format === 'ai_scene_synthetic_geometry_spec_v1' && body.purpose === 'synthetic-simulation'
    && review.format === 'ai_scene_synthetic_geometry_review_v1'
    && review.scope === 'synthetic-only-no-real-image-authority', 'STUDY_SYNTHETIC_ONLY');
  check(review.specSha256 === spec.sha256 && review.decision === 'fixture-accepted', 'STUDY_REVIEW');
  check(body.unresolvedPixels === 0, 'STUDY_UNRESOLVED');
  exact(body.localCanvas, ['width', 'height']); exact(body.sceneCanvas, ['width', 'height']); exact(body.origin, ['x', 'y']);
  const { width, height } = body.localCanvas, scene = body.sceneCanvas, origin = body.origin;
  check(width === paint.width && height === paint.height && alpha instanceof Uint8Array
    && alpha.length === width * height && hash(paint.rgba) === body.paintRgbaSha256
    && hash(alpha) === body.alphaSha256, 'STUDY_BINDING');
  check([scene.width, scene.height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 4096)
    && [origin.x, origin.y].every(v => Number.isSafeInteger(v) && v >= 0)
    && origin.x + width <= scene.width && origin.y + height <= scene.height, 'STUDY_PLACEMENT');
  const layer = raster(width, height); let nonzero = 0, partial = 0;
  for (let i = 0; i < alpha.length; i++) {
    const p = i * 4, a = Math.floor((paint.rgba[p + 3] * alpha[i] + 127) / 255);
    if (a) { layer.rgba.set(paint.rgba.subarray(p, p + 3), p); nonzero++; if (a < 255) partial++; }
    layer.rgba[p + 3] = a;
  }
  check(nonzero > 0, 'STUDY_EMPTY');
  const placed = raster(scene.width, scene.height); blit(placed, layer, origin.x, origin.y);
  const report = seal({ format: 'ai_scene_synthetic_geometry_result_v1', purpose: body.purpose,
    specSha256: spec.sha256, fixtureReviewSha256: fixtureReview.sha256, localCanvas: body.localCanvas,
    sceneCanvas: scene, origin, sourcePaintRgbaSha256: hash(paint.rgba), alphaSha256: hash(alpha),
    derivedRgbaSha256: hash(layer.rgba), placedRgbaSha256: hash(placed.rgba), nonzeroPixels: nonzero,
    partialAlphaPixels: partial, formula: 'round(paintAlpha*geometryAlpha/255)', zeroRgbAtZeroAlpha: true,
    autoFit: false, scale: 1, resampling: 'none', humanArtAcceptance: 'not-assessed', productionAsset: false });
  return { layer, placed, report };
}
