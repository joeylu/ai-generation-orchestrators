import { meshLists, meshTable } from './terrain-edit-wire.mjs';

function meshKey({ materialKey, positions }) {
  return [materialKey, positions.length, positions[0], positions[1], positions.at(-2), positions.at(-1)].join('/');
}

// Compiled meshes are plain JSON. Compare numeric arrays directly so looking
// for reusable meshes costs less than encoding and parsing those arrays again.
function sameJson(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (!Object.hasOwn(b, key) || !sameJson(a[key], b[key])) return false;
  return true;
}

export function terrainEditPatch(before, after) {
  if (!before?.gridTerrains?.length || !after?.gridTerrains?.length
    || before.source.kitSha256 !== after.source.kitSha256) return;
  const meshCount = after.gridTerrains.reduce((count, terrain) => count + meshLists.reduce(
    (n, name) => n + (terrain[name]?.length ?? 0), 0), 0);
  if (meshCount < 64) return;

  const table = meshTable(before.gridTerrains);
  const indexes = Object.fromEntries(meshLists.map(name => {
    const index = new Map();
    for (const [i, mesh] of table[name].entries()) {
      const key = meshKey(mesh);
      const candidates = index.get(key);
      if (!candidates) index.set(key, [i]);
      // A coarse key only narrows the search. Bound comparisons even when many
      // meshes share the same endpoints and send any unrecognized mesh inline.
      else if (candidates.length < 8) candidates.push(i);
    }
    return [name, index];
  }));
  let reused = 0;
  const gridTerrains = after.gridTerrains.map(terrain => {
    const wire = { ...terrain };
    for (const name of meshLists) if (terrain[name]) {
      wire[name] = terrain[name].map(mesh => {
        for (const index of indexes[name].get(meshKey(mesh)) ?? []) {
          if (!sameJson(mesh, table[name][index])) continue;
          reused++;
          return index;
        }
        return mesh;
      });
    }
    return wire;
  });
  if (reused < 32) return;
  return { baseContentSha256: before.contentSha256, scene: { ...after, gridTerrains } };
}
