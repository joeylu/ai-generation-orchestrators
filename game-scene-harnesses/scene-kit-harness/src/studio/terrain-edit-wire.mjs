export const terrainEditResponse = 'application/vnd.scene-kit.terrain-edit-v1+json';
export const meshLists = Object.freeze(['capBands', 'topCoverBands', 'edgeMeshes', 'cornerMeshes',
  'nativeTopCornerMeshes', 'fieldBoundaryBands']);

export function meshTable(grids) {
  return Object.fromEntries(meshLists.map(name => [name, grids.flatMap(grid => grid[name] ?? [])]));
}

// In a terrain response, numbers in the listed grid mesh arrays refer to that
// same list in the base scene, flattened in compiler order across all regions.
export function applyTerrainEditPatch(base, patch) {
  if (!base?.gridTerrains || patch.baseContentSha256 !== base.contentSha256
    || patch.scene.source.kitSha256 !== base.source.kitSha256) throw new Error('Terrain edit patch base changed');
  const table = meshTable(base.gridTerrains);
  const gridTerrains = patch.scene.gridTerrains.map(terrain => {
    const next = { ...terrain };
    for (const name of meshLists) if (terrain[name]) {
      next[name] = terrain[name].map(mesh => {
        if (typeof mesh !== 'number') return mesh;
        if (!Number.isSafeInteger(mesh) || mesh < 0 || mesh >= table[name].length) {
          throw new Error('Terrain edit patch reference is invalid');
        }
        return table[name][mesh];
      });
    }
    return next;
  });
  return { ...patch.scene, gridTerrains };
}
