export const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const clone = value => structuredClone(value);

// Increasing order draws toward the viewer. Legacy IDs still break ties, and
// an assembly owner compares like the prefix of its compiled visual children.
export function compareObjectStack(a, b) {
  const key = item => item.presetId ? item.instanceId + '/' : item.instanceId;
  return (a.drawOrder ?? Number.MAX_SAFE_INTEGER) - (b.drawOrder ?? Number.MAX_SAFE_INTEGER)
    || compareText(key(a), key(b));
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export function canonicalJson(value, pretty = false) {
  return JSON.stringify(value, (_key, entry) => {
    if (entry && !Array.isArray(entry) && typeof entry === 'object') {
      return Object.fromEntries(Object.keys(entry).sort(compareText).map(key => [key, entry[key]]));
    }
    return entry;
  }, pretty ? 2 : undefined);
}

export function cellsFromRuns(runs) {
  const cells = new Map();
  for (const run of runs) for (let dx = 0; dx < run.length; dx++) cells.set(`${run.x + dx},${run.y}`, run.familyId);
  return cells;
}

export function runsFromCells(cells) {
  const sorted = [...cells].map(([key, familyId]) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y, familyId };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const runs = [];
  for (const cell of sorted) {
    const last = runs.at(-1);
    if (last && last.y === cell.y && last.x + last.length === cell.x && last.familyId === cell.familyId) last.length++;
    else runs.push({ ...cell, length: 1 });
  }
  return runs;
}

// Call only after semantic validation: canonicalization must never hide overlaps.
export function canonicalMap(document) {
  const result = clone(document);
  result.terrainRuns = runsFromCells(cellsFromRuns(result.terrainRuns));
  result.layers.sort((a, b) => a.zIndex - b.zIndex);
  result.instances.sort((a, b) => compareText(a.instanceId, b.instanceId));
  result.assemblyInstances.sort((a, b) => compareText(a.instanceId, b.instanceId));
  result.inspectionCases.sort((a, b) => compareText(a.caseId, b.caseId));
  if (['ai_scene_document_v2','ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(result.format)) result.curveTerrains.sort((a, b) => compareText(a.curveId, b.curveId));
  if (['ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(result.format)) result.terrainConnections.sort((a,b)=>compareText(a.curveId,b.curveId)||compareText(a.endpoint,b.endpoint));
  if(result.instanceTransforms)result.instanceTransforms.sort((a,b)=>compareText(a.instanceId,b.instanceId));
  if(result.instanceAppearances?.length)result.instanceAppearances.sort((a,b)=>compareText(a.instanceId,b.instanceId));
  else delete result.instanceAppearances;
  return result;
}
