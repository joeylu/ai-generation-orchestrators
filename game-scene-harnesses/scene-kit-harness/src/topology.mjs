export const PROFILE = 'sideview-solid-blob47-v1';
export const NEIGHBORS = Object.freeze([
  [0, -1, 1], [1, -1, 2], [1, 0, 4], [1, 1, 8],
  [0, 1, 16], [-1, 1, 32], [-1, 0, 64], [-1, -1, 128],
].map(Object.freeze));

export function normalizeSignature(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 255) {
    throw new RangeError('Neighbor mask must be an integer between 0 and 255');
  }
  let result = mask;
  for (const [diagonal, first, second] of [[2, 1, 4], [8, 4, 16], [32, 16, 64], [128, 64, 1]]) {
    if (!(mask & first) || !(mask & second)) result &= ~diagonal;
  }
  return result;
}

export const SIGNATURES = Object.freeze([...new Set(
  Array.from({ length: 256 }, (_, mask) => normalizeSignature(mask)),
)].sort((a, b) => a - b));

export const cellKey = (x, y) => `${x},${y}`;

export function signatureAt(cells, x, y) {
  if (!cells.has(cellKey(x, y))) return null;
  const family = cells.get(cellKey(x, y));
  let mask = 0;
  for (const [dx, dy, bit] of NEIGHBORS) {
    if (cells.get(cellKey(x + dx, y + dy)) === family) mask |= bit;
  }
  return normalizeSignature(mask);
}
