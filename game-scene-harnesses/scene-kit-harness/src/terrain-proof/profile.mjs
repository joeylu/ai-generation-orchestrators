import { deepFreeze, digest } from '../generation/common.mjs';

// Engineering pilot only. Change the compiler/profile version before changing
// any crop, raster, occupancy, seam or evidence rule of a frozen plan.
export const TERRAIN_PROOF = deepFreeze({
  format: 'ai_scene_terrain_proof_profile_v1', profile: 'sideview-material-proof-v1',
  scope: 'three-layout-pilot-not-production-kit', grid: { width: 64, height: 64 },
  pixelsPerUnit: { numerator: 1, denominator: 1 }, anchorPx: { x: 0, y: 0 },
  source: { orientation: 'landscape', minimumShortEdge: 512, maximumWidth: 4096, maximumHeight: 4096,
    alpha: 'opaque', pngProfile: 'native-reference-png-cabx-v1' },
  crop: 'center-square-floor-cap-top-eighth-body-lower-center-square-v1',
  resample: 'integer-area-box-round-half-up-v1', capHeightPx: 8, periodicBlendPx: 4,
  periodicBlend: 'opposite-pair-mean-separable-x-then-y-v1',
  boundaryShadePx: 2, boundaryShade: { numerator: 3, denominator: 4 },
  topology: 'cardinal-only-no-inner-corner-certification', geometry: 'full-solid-grid-cells-no-overhang',
  seam: { channelDifferenceLimit: 0, minimumComparedFraction: { numerator: 3, denominator: 4 },
    transitionPolicy: 'different-boundary-decorators-require-human-review' },
  layouts: [
    { layoutId: 'straight', columns: 8, rows: 4, columnHeights: [2, 2, 2, 2, 2, 2, 2, 2] },
    { layoutId: 'steps', columns: 8, rows: 5, columnHeights: [1, 1, 2, 2, 3, 3, 2, 2] },
    { layoutId: 'cliff', columns: 8, rows: 5, columnHeights: [3, 3, 3, 3, 3, 0, 0, 0] },
  ],
  expectedImageRequests: 1, claimedIndependentGeneratedModules: 0, complete47RoleKit: false,
});
export const TERRAIN_PROOF_SHA256 = digest(TERRAIN_PROOF);

export function layoutCells(layout) {
  return layout.columnHeights.flatMap((height, x) => Array.from({ length: height }, (_, index) => ({ x, y: layout.rows - height + index })));
}
