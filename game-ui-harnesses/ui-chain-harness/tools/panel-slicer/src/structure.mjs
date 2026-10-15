// Structural fallback for textured, filled rectangular panels. These are
// geometric heuristics, not semantic image understanding or art approval.
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const distance = (a, b) => Math.max(...a.map((v, c) => Math.abs(v - b[c])));
export function analyzePanelStructure({ width, height, pixels }, { axis = 'both' } = {}) {
  const reject = reason => ({ status: 'unsupported', reason });
  const alpha = (x, y) => pixels[(y * width + x) * 4 + 3];
  const rgb = (x, y) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 3));
  const rows = new Uint32Array(height), cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (alpha(x, y) >= 32) { rows[y]++; cols[x]++; }
  // Isolated near-transparent residue is not part of the structural contour.
  // It stays in the original image; no alpha or RGB is rewritten here.
  const bounds = counts => {
    const cutoff = Math.max(...counts) * 0.25;
    const start = counts.findIndex(n => n > cutoff);
    let end = counts.length - 1; while (end >= start && counts[end] <= cutoff) end--;
    return [start, end];
  };
  const [left, right] = bounds(cols), [top, bottom] = bounds(rows);
  const w = right - left + 1, h = bottom - top + 1;
  if (left < 0 || Math.min(w, h) < 24) return reject('有效主体过小，无法可靠识别边框。');
  let filled = 0;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) if (alpha(x, y) >= 32) filled++;
  if (filled / (w * h) < 0.88) return reject('主体不是足够完整的矩形面板。');
  const samples = [];
  for (let y = top + Math.floor(h * .25); y < top + h * .75; y += Math.max(1, Math.floor(h / 96)))
    for (let x = left + Math.floor(w * .25); x < left + w * .75; x += Math.max(1, Math.floor(w / 96))) {
      if (alpha(x, y) < 224) return reject('内部存在明显透明区域，无法按填充面板处理。');
      samples.push(rgb(x, y));
    }
  const center = [0, 1, 2].map(c => median(samples.map(p => p[c])));
  const deviations = samples.map(p => distance(p, center)).sort((a, b) => a - b);
  const spread = deviations[Math.floor(deviations.length * .9)];
  if (spread > 35 || deviations.at(-1) > 90) return reject('内部变化过大，可能包含图案或文字，不自动拉伸。');
  const threshold = Math.max(24, spread * 2);
  const edges = {}, localBackgrounds = {};
  const sides = axis === 'horizontal' ? ['left', 'right'] : axis === 'vertical' ? ['top', 'bottom'] : ['left', 'top', 'right', 'bottom'];
  for (const side of sides) {
    const horizontal = side === 'left' || side === 'right';
    const length = horizontal ? w : h, cross = horizontal ? h : w;
    const limit = Math.floor(Math.min(length * .28, Math.min(w, h) * .38));
    const profile = [], bandColors = [], opaqueBands = [];
    const backgroundBand = Math.min(8, Math.floor(length / 2) - limit);
    for (let d = 0; d < limit + backgroundBand; d++) {
      const colors = []; let opaque = true;
      for (let j = Math.floor(cross * .3); j < cross * .7; j += Math.max(1, Math.floor(cross / 96))) {
        const x = horizontal ? (side === 'left' ? left + d : right - d) : left + j;
        const y = horizontal ? top + j : (side === 'top' ? top + d : bottom - d);
        if (alpha(x, y) >= 224) colors.push(rgb(x, y)); else opaque = false;
      }
      const color = colors.length ? [0, 1, 2].map(c => median(colors.map(p => p[c]))) : null;
      bandColors.push(color);
      opaqueBands.push(opaque);
      profile.push(color ? distance(color, center) : 255);
    }
    const barriers = values => values.slice(0, limit).map((value, d) => value > threshold ? d : -1).filter(d => d >= 0);
    const separated = values => values.length >= 2 && values.at(-1) < limit - 4;
    let barrier = barriers(profile);
    // A mild side shade can differ from the central median without being a
    // thick frame. Only use a measured, opaque, stable interior band beyond
    // the frame-search limit, still within the existing 35-level texture bound.
    // Never extend the search or accept arbitrary gradients / central artwork.
    if (!separated(barrier) && backgroundBand >= 4) {
      const samples = bandColors.slice(limit);
      if (samples.every(Boolean) && opaqueBands.slice(limit).every(Boolean)) {
        const background = [0, 1, 2].map(c => median(samples.map(p => p[c])));
        if (distance(background, center) <= 35 && samples.every(p => distance(p, background) <= 8)) {
          const local = barriers(bandColors.map(p => p ? distance(p, background) : 255));
          if (separated(local)) { barrier = local; localBackgrounds[side] = background; }
        }
      }
    }
    if (!separated(barrier))
      return reject('四边未形成可可靠分离的边框与内部区域。');
    edges[side] = barrier.at(-1) + 3;
  }
  // Measure the outer silhouette near all four sides. Stepped shoulders need
  // wider corner blocks than ordinary rounded rectangles of the same size.
  const cornerInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const offset of [2, 3, 4]) {
    for (const y of [top + offset, bottom - offset]) {
      let a = left, b = right;
      while (a <= right && alpha(a, y) < 224) a++;
      while (b >= left && alpha(b, y) < 224) b--;
      if (a <= b) { cornerInsets.left = Math.max(cornerInsets.left, a - left); cornerInsets.right = Math.max(cornerInsets.right, right - b); }
    }
    for (const x of [left + offset, right - offset]) {
      let a = top, b = bottom;
      while (a <= bottom && alpha(x, a) < 224) a++;
      while (b >= top && alpha(x, b) < 224) b--;
      if (a <= b) { cornerInsets.top = Math.max(cornerInsets.top, a - top); cornerInsets.bottom = Math.max(cornerInsets.bottom, bottom - b); }
    }
  }
  const protect = side => Math.ceil(edges[side] + Math.max(edges[side] / 2, cornerInsets[side]));
  const bordersPx = {
    left: axis === 'vertical' ? 0 : left + protect('left'), right: axis === 'vertical' ? 0 : width - 1 - right + protect('right'),
    top: axis === 'horizontal' ? 0 : top + protect('top'), bottom: axis === 'horizontal' ? 0 : height - 1 - bottom + protect('bottom'),
  };
  if (bordersPx.left + bordersPx.right >= width * .8 || bordersPx.top + bordersPx.bottom >= height * .8)
    return reject('保留边角后可拉伸区域过小。');
  return { status: 'supported', method: Object.keys(localBackgrounds).length ? 'framed-texture-local-shade-v1' : 'framed-texture-v2', bordersPx,
    notice: '已按边框结构自动配置；内部纹理会随尺寸拉伸，建议查看宽高预览。',
    evidence: { bounds: { left, top, right, bottom }, interiorSpread: spread, edges, cornerInsets,
      ...(axis !== 'both' ? { axis } : {}), ...(Object.keys(localBackgrounds).length ? { localBackgrounds } : {}) } };
}
