import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainEditPatch } from '../src/studio/terrain-edit-patch.mjs';
import { applyTerrainEditPatch } from '../src/studio/terrain-edit-wire.mjs';

test('grid mesh references reconstruct exact scenes across region splits and ordering changes', () => {
  const meshes = Array.from({ length: 70 }, (_, x) => ({
    materialKey: 'bottom.edge', positions: [x, 0, x, 1, x + 1, 1],
    uvs: [0, 0, 0, 1, 1, 1], indices: [0, 1, 2],
  }));
  const base = { contentSha256: 'base', source: { kitSha256: 'kit' },
    gridTerrains: [{ edgeMeshes: meshes, topCoverBands: [meshes[0]] }] };
  const changed = { ...meshes[0], uvs: [0.5, 0, 0, 1, 1, 1] };
  const next = { ...base, contentSha256: 'next',
    gridTerrains: [{ edgeMeshes: meshes.slice(10).reverse() }, { edgeMeshes: [changed, ...meshes.slice(1, 10)] }] };
  const patch = JSON.parse(JSON.stringify(terrainEditPatch(base, next)));
  assert.equal(patch.scene.gridTerrains[0].edgeMeshes[0], 69);
  assert.deepEqual(patch.scene.gridTerrains[1].edgeMeshes[0], changed);
  assert.deepEqual(applyTerrainEditPatch(base, patch), next);
  assert.throws(() => applyTerrainEditPatch(next, patch), /base changed/);
  patch.scene.gridTerrains[0].edgeMeshes[0] = 70;
  assert.throws(() => applyTerrainEditPatch(base, patch), /reference is invalid/);
  assert.equal(base.gridTerrains[0].edgeMeshes.length, 70);
});
