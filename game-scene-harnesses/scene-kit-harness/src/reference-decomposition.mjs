import { inspectPng, encodeRgbaPng } from './png.mjs';
import { validateReferenceViewport } from './reference-measurement.mjs';
import { polygonBounds, validateBlueprintPolygon } from './reference-blueprint.mjs';
import { check, digest, exact, hash, id, isDigest, jsonBytes, seal, unseal } from './generation/common.mjs';

// Visible ownership is a pixel label, NOT a recovered material-alpha channel.
// Keep this pure module offline. Project wrappers authenticate the live target.
export function inspectDecompositionReference(target, raw) {
  unseal(target);
  check(target.format === 'ai_scene_reference_reconstruction_target_v2'
    && target.status === 'accepted-reference-and-measured-layout' && target.assessmentReady === true
    && ['planSha256', 'rawSha256', 'analysisSha256', 'acceptedPacketSha256', 'humanReceiptSha256'].every(k => isDigest(target[k])), 'DECOMPOSITION_ACCEPTED_TARGET');
  check(raw instanceof Uint8Array && raw.length <= 16777216 && hash(raw) === target.rawSha256, 'DECOMPOSITION_RAW_BINDING');
  const image = inspectPng(Buffer.from(raw), { includePixels: true, allowCabx: true });
  check(image.transparentPixels === 0, 'DECOMPOSITION_OPAQUE_REFERENCE');
  const m = target.mapping;
  exact(m, ['profile', 'nativeSize', 'viewport', 'scale', 'resized', 'offset']);
  validateReferenceViewport(m.viewport);
  const byWidth = m.viewport.width * image.height <= m.viewport.height * image.width;
  const numerator = byWidth ? m.viewport.width : m.viewport.height, denominator = byWidth ? image.width : image.height;
  const width = Math.floor(image.width * numerator / denominator), height = Math.floor(image.height * numerator / denominator);
  const expected = { profile: 'uniform-contain-no-crop-floor-v1', nativeSize: { width: image.width, height: image.height }, viewport: m.viewport,
    scale: { numerator, denominator }, resized: { width, height }, offset: { x: Math.floor((m.viewport.width - width) / 2), y: Math.floor((m.viewport.height - height) / 2) } };
  check(digest(m) === digest(expected), 'DECOMPOSITION_MAPPING');
  check(Array.isArray(target.layers) && target.layers.length > 0 && target.layers.length <= 16
    && Array.isArray(target.instances) && target.instances.length > 0 && target.instances.length <= 24, 'DECOMPOSITION_INSTANCES');
  const layers = new Set(), instances = new Set();
  for (const layer of target.layers) { id(layer.layerId); check(!layers.has(layer.layerId), 'DECOMPOSITION_INSTANCES'); layers.add(layer.layerId); }
  for (const instance of target.instances) {
    id(instance.instanceId); check(!instances.has(instance.instanceId) && layers.has(instance.layerId), 'DECOMPOSITION_INSTANCES');
    instances.add(instance.instanceId); validateBlueprintPolygon(instance.visibleEnvelope, m.viewport);
  }
  return image;
}

export function visibleOwnershipPalette(target) {
  return target.instances.map((i, index) => ({ instanceId: i.instanceId, rgb: [(index + 1) * 73 % 256, (index + 1) * 151 % 256, (index + 1) * 199 % 256] }));
}
function binding(target) { return { targetSha256: target.sha256, rawSha256: target.rawSha256, planSha256: target.planSha256 }; }
function pack(format, target, files, report) {
  files.set('report.json', jsonBytes(report));
  const bundle = seal({ format, ...binding(target), reportSha256: report.sha256,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })),
    generationCalls: 0, assetPackage: false, visualAcceptance: 'not-assessed' });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report, bundle };
}
function crop(image, box) {
  const rgba = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) image.rgba.copy(rgba, y * box.width * 4,
    ((box.y + y) * image.width + box.x) * 4, ((box.y + y) * image.width + box.x + box.width) * 4);
  return encodeRgbaPng(box.width, box.height, rgba);
}
function nativeRoi(instance, mapping) {
  const box = polygonBounds(instance.visibleEnvelope), m = mapping;
  // Invert the ACTUAL floor-resized axes, not just the nominal rational scale.
  const nx = x => (x - m.offset.x) * m.nativeSize.width / m.resized.width;
  const ny = y => (y - m.offset.y) * m.nativeSize.height / m.resized.height;
  const left = Math.max(0, Math.floor(nx(box.x)) - 8), top = Math.max(0, Math.floor(ny(box.y)) - 8);
  const right = Math.min(m.nativeSize.width, Math.ceil(nx(box.x + box.width)) + 8);
  const bottom = Math.min(m.nativeSize.height, Math.ceil(ny(box.y + box.height)) + 8);
  check(right > left && bottom > top, 'DECOMPOSITION_ROI');
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Context pixels for a generation task, never a segmented asset or alpha mask.
export function referenceInstanceContext(target, raw, instanceId) {
  const image = inspectDecompositionReference(target, raw), instance = target.instances.find(i => i.instanceId === instanceId);
  check(instance, 'DECOMPOSITION_INSTANCE_REQUIRED');
  const nativeCrop = nativeRoi(instance, target.mapping);
  return { instance, nativeCrop, bytes: crop(image, nativeCrop) };
}

export function decompositionReviewFiles(target, raw) {
  const image = inspectDecompositionReference(target, raw), palette = visibleOwnershipPalette(target);
  const files = new Map([['reference-native.png', Buffer.from(raw)], ['reconstruction-target.json', jsonBytes(target)]]);
  const blank = Buffer.alloc(image.width * image.height * 4);
  for (let p = 3; p < blank.length; p += 4) blank[p] = 255;
  const ownerMap = encodeRgbaPng(image.width, image.height, blank);
  files.set('ownership-unassigned.png', ownerMap);
  const instances = target.instances.map(instance => {
    const nativeCrop = nativeRoi(instance, target.mapping), path = `crops/${instance.instanceId}.png`;
    files.set(path, crop(image, nativeCrop));
    return { instanceId: instance.instanceId, subjectId: instance.subjectId, layerId: instance.layerId, role: instance.role,
      visibility: instance.visibility, nativeCrop, path, cropMeaning: 'context-only-not-a-cutout',
      visibleEnvelope: instance.visibleEnvelope, ownership: 'unassigned', hiddenGeometry: 'unknown',
      anchor: instance.anchor, anchorEvidence: instance.anchorEvidence, anchorMeaning: 'measurement-marker-not-an-asset-origin',
      surfaceIds: target.surfaces.filter(s => s.instanceId === instance.instanceId).map(s => s.surfaceId) };
  });
  const report = seal({ format: 'ai_scene_decomposition_review_v1', ...binding(target),
    status: 'awaiting-visible-ownership', coordinates: 'native-reference-pixels', pixelSize: target.mapping.nativeSize,
    mapping: target.mapping, palette, unknownRgb: [0, 0, 0], ownerMap: { path: 'ownership-unassigned.png', sha256: hash(ownerMap), byteLength: ownerMap.length },
    instances, layers: target.layers, surfaces: target.surfaces, assignedPixels: 0, unassignedPixels: image.width * image.height,
    automaticSemanticDetection: false, envelopeMeaning: 'operator-envelope-not-alpha-mask', hiddenGeometry: 'unknown',
    materialAlpha: 'not-recovered', visualAcceptance: 'not-assessed', assetPackage: false, generationCalls: 0 });
  const rows = instances.map(i => {
    const rgb = palette.find(p => p.instanceId === i.instanceId).rgb.join(',');
    return `| ${i.instanceId} | ${rgb} | ${i.visibility} | [原像素局部](${i.path}) |`;
  }).join('\n');
  files.set('README.md', Buffer.from(`# 准确参考图的可见拆分工作包\n\n目标：${target.sha256}\n\n` +
    `本包零生图，原PNG逐字节保留。${instances.length}份原生局部只供追踪，有周边内容，不是独立素材。粗包络不当作遮罩；8px原生外扩只是局部上下文。\n\n` +
    `ownership-unassigned.png与原图同尺寸，目前全部黑色（未知）。按下表颜色在副本中标注每个可见像素的主体归属，保持不透明RGB/RGBA PNG、原生尺寸和准确纯色；不要抗锯齿、缩放或填充推断遮挡。一个像素只有一个可见归属。原生坐标不包含基准缩图的余边。\n\n` +
    `| 主体 | RGB标签 | 原始可见状态 | 追踪局部 |\n| --- | --- | --- | --- |\n${rows}\n\n` +
    `后续ownership命令读取所选标注，程序绑定当前目标并生成独立审阅包。未知像素不会自动给天空，也不会用整张原图补洞。可见片段保留原画混色像素，不代表真实材质Alpha、完整遮挡形状、无污染边缘或可平铺素材。像素回拼一致仅证明坐标/复制，不证明分层语义正确；仍须单独审阅并规划完整来源与补全。\n`));
  return pack('ai_scene_decomposition_review_bundle_v1', target, files, report);
}

export function visibleOwnershipFiles(target, raw, mapBytes) {
  const image = inspectDecompositionReference(target, raw);
  check(mapBytes instanceof Uint8Array && mapBytes.length <= 16777216, 'OWNERSHIP_MAP_BYTES');
  const map = inspectPng(Buffer.from(mapBytes), { includePixels: true });
  check(map.width === image.width && map.height === image.height && map.transparentPixels === 0, 'OWNERSHIP_MAP_FRAME');
  const palette = visibleOwnershipPalette(target), key = rgb => rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
  const lookup = new Map(palette.map((entry, index) => [key(entry.rgb), index]));
  const owners = new Uint8Array(image.width * image.height), stats = palette.map(() => ({ count: 0, x0: image.width, y0: image.height, x1: -1, y1: -1 }));
  let unassigned = 0;
  for (let pixel = 0; pixel < owners.length; pixel++) {
    const p = pixel * 4, color = key(map.rgba.subarray(p, p + 3));
    if (color === 0) { unassigned++; continue; }
    const index = lookup.get(color); check(index !== undefined, 'OWNERSHIP_UNKNOWN_COLOR');
    owners[pixel] = index + 1;
    const s = stats[index], x = pixel % image.width, y = Math.floor(pixel / image.width);
    s.count++; s.x0 = Math.min(s.x0, x); s.y0 = Math.min(s.y0, y); s.x1 = Math.max(s.x1, x); s.y1 = Math.max(s.y1, y);
  }
  const files = new Map([['reference-native.png', Buffer.from(raw)], ['ownership-native.png', Buffer.from(mapBytes)], ['reconstruction-target.json', jsonBytes(target)]]);
  const reassembled = Buffer.alloc(image.rgba.length), fragments = [];
  for (let index = 0; index < palette.length; index++) {
    const s = stats[index], instanceId = palette[index].instanceId;
    if (!s.count) { fragments.push({ instanceId, assignedPixels: 0, nativeCrop: null, path: null }); continue; }
    const nativeCrop = { x: s.x0, y: s.y0, width: s.x1 - s.x0 + 1, height: s.y1 - s.y0 + 1 };
    const pixels = Buffer.alloc(nativeCrop.width * nativeCrop.height * 4);
    for (let y = 0; y < nativeCrop.height; y++) for (let x = 0; x < nativeCrop.width; x++) {
      const nativePixel = (nativeCrop.y + y) * image.width + nativeCrop.x + x;
      if (owners[nativePixel] === index + 1) image.rgba.copy(pixels, (y * nativeCrop.width + x) * 4, nativePixel * 4, nativePixel * 4 + 4);
    }
    const path = `visible/${instanceId}.png`, bytes = encodeRgbaPng(nativeCrop.width, nativeCrop.height, pixels);
    files.set(path, bytes);
    // Reassemble from the encoded fragment and its recorded origin, never a raw-image fallback.
    const decoded = inspectPng(bytes, { includePixels: true });
    for (let y = 0; y < nativeCrop.height; y++) for (let x = 0; x < nativeCrop.width; x++) {
      const p = (y * nativeCrop.width + x) * 4;
      if (decoded.rgba[p + 3]) decoded.rgba.copy(reassembled, ((nativeCrop.y + y) * image.width + nativeCrop.x + x) * 4, p, p + 4);
    }
    fragments.push({ instanceId, assignedPixels: s.count, nativeCrop, path });
  }
  const difference = Buffer.alloc(image.rgba.length), unknown = Buffer.alloc(image.rgba.length);
  let mismatch = 0, assignedMismatch = 0;
  for (let pixel = 0; pixel < owners.length; pixel++) {
    const p = pixel * 4;
    if (!owners[pixel]) unknown.set([255, 40, 160, 255], p);
    let differs = false;
    for (let c = 0; c < 4; c++) { difference[p + c] = Math.abs(image.rgba[p + c] - reassembled[p + c]); differs ||= difference[p + c] !== 0; }
    difference[p + 3] = 255;
    if (differs) { mismatch++; if (owners[pixel]) assignedMismatch++; }
  }
  files.set('reassembled-visible.png', encodeRgbaPng(image.width, image.height, reassembled));
  files.set('difference.png', encodeRgbaPng(image.width, image.height, difference));
  files.set('unassigned.png', encodeRgbaPng(image.width, image.height, unknown));
  const missing = fragments.filter(f => !f.assignedPixels).map(f => f.instanceId);
  const report = seal({ format: 'ai_scene_visible_ownership_review_v1', ...binding(target),
    ownerMapSha256: hash(mapBytes), coordinates: 'native-reference-pixels', pixelSize: target.mapping.nativeSize, palette, fragments,
    status: unassigned || missing.length ? 'incomplete-visible-ownership' : 'complete-visible-ownership-pending-semantic-review',
    assignedPixels: owners.length - unassigned, unassignedPixels: unassigned, missingInstanceIds: missing,
    coordinateRoundtrip: { rgbaMismatchPixels: mismatch, assignedRgbaMismatchPixels: assignedMismatch, sourceFallbackPixels: 0 },
    materialAlpha: 'not-recovered-binary-visible-ownership-only', hiddenGeometry: 'unknown',
    semanticSegmentation: 'not-assessed', edgeDecontamination: 'not-performed', reusableAssets: false,
    visualAcceptance: 'not-assessed', assetPackage: false, generationCalls: 0 });
  check(assignedMismatch === 0, 'OWNERSHIP_COPY_ROUNDTRIP');
  files.set('README.md', Buffer.from(`# 可见像素归属审阅\n\n目标：${target.sha256}\n\n` +
    `状态：${report.status}。已归属${report.assignedPixels}像素；未知${unassigned}像素；空主体${missing.length}个。\n\n` +
    `[原图](reference-native.png) · [可见片段回拼](reassembled-visible.png) · [RGBA差值RGB图](difference.png) · [未知区域（粉色）](unassigned.png) · [报告](report.json)\n\n` +
    `回拼仅从片段与记录原点生成，未知区域保持透明，整图回填0像素。RGB差图不单独显示Alpha差，报告计数比较全部RGBA。像素一致只证明复制与坐标闭环，不证明语义分层或边缘质量；没有自动美术接受。可见片段的Alpha为二值归属，原画的混色边缘仍保留，不能当作恢复的材质透明度或完整可复用资产。遮挡与框外仍未知，须另行规划补全。\n`));
  return pack('ai_scene_visible_ownership_review_bundle_v1', target, files, report);
}
