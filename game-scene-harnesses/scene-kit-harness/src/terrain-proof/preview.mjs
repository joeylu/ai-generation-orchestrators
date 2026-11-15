import { check, deepFreeze, hash } from '../generation/common.mjs';

const snapshots = new WeakMap();
// Internal constructor: callers enter through loadTerrainStudyPreview, which
// replays the accepted source and both parents before creating this snapshot.
export function createTerrainStudyPreview(prepared) {
  const assets = new Map(), modules = [], materialFields = {};
  for (const item of prepared.report.artifacts.filter(item => item.path.startsWith('tiles/'))) {
    const match = /^tiles\/(p\d+-blob-\d{3})\.png$/.exec(item.path);
    check(match && hash(prepared.files.get(item.path)) === item.sha256, 'TERRAIN_PREVIEW_ARTIFACT');
    const key = match[1]; assets.set(key, Buffer.from(prepared.files.get(item.path)));
    modules.push({ key, sha256: item.sha256, byteLength: item.byteLength });
  }
  check(modules.length === 752, 'TERRAIN_PREVIEW_COVERAGE');
  for (const kind of ['body', 'cap']) {
    const path = `materials/${kind}-field.png`, item = prepared.report.artifacts.find(item => item.path === path);
    check(item && hash(prepared.files.get(path)) === item.sha256, 'TERRAIN_PREVIEW_ARTIFACT');
    const key = `${kind}-field`; assets.set(key, Buffer.from(prepared.files.get(path)));
    materialFields[kind] = { key, sha256: item.sha256, byteLength: item.byteLength };
  }
  const handle = deepFreeze({ format: 'ai_scene_terrain_study_preview_v2',
    bundleSha256: prepared.bundle.sha256, sourceSha256: prepared.report.source.sha256,
    profileSha256: prepared.report.profileSha256, purpose: prepared.bundle.purpose,
    grid: { width: 64, height: 64 }, topologyRoleCount: 47, texturePhaseCount: 16,
    selection: 'positive-modulo-world-cell-coordinate-by-four-v1',
    sourceVisualAcceptance: 'accepted', visualAcceptance: 'not-assessed', productionKit: false,
    texturePeriodCells: 4, modules, materialFields });
  snapshots.set(handle, assets); return handle;
}
export function readTerrainStudyPreviewImage(handle, key) {
  check(snapshots.has(handle) && snapshots.get(handle).has(key), 'TERRAIN_PREVIEW_HANDLE');
  return Buffer.from(snapshots.get(handle).get(key));
}
export function assertTerrainStudyPreview(handle) { check(snapshots.has(handle), 'TERRAIN_PREVIEW_HANDLE'); }
