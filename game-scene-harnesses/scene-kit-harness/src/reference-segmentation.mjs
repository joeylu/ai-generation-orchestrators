import { inspectPng, encodeRgbaPng } from './png.mjs';
import { inspectDecompositionReference, visibleOwnershipFiles, visibleOwnershipPalette } from './reference-decomposition.mjs';
import { check, exact, hash, id, isDigest, jsonBytes, seal, text, unseal } from './generation/common.mjs';

function strokes(rows, width, height) {
  check(Array.isArray(rows) && rows.length > 0 && rows.length <= 128, 'SEGMENTATION_STROKES');
  const result = Buffer.alloc(width * height);
  for (const stroke of rows) {
    exact(stroke, ['points', 'radius']);
    check(Number.isInteger(stroke.radius) && stroke.radius >= 0 && stroke.radius <= 64
      && Array.isArray(stroke.points) && stroke.points.length > 0 && stroke.points.length <= 128, 'SEGMENTATION_STROKE');
    for (const p of stroke.points) {
      exact(p, ['x', 'y']); check(Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < width && p.y >= 0 && p.y < height, 'SEGMENTATION_POINT');
    }
    const segments = stroke.points.length === 1 ? [[stroke.points[0], stroke.points[0]]]
      : stroke.points.slice(1).map((p, i) => [stroke.points[i], p]);
    for (const [a, b] of segments) {
      const r = stroke.radius, dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      for (let y = Math.max(0, Math.min(a.y, b.y) - r); y <= Math.min(height - 1, Math.max(a.y, b.y) + r); y++)
        for (let x = Math.max(0, Math.min(a.x, b.x) - r); x <= Math.min(width - 1, Math.max(a.x, b.x) + r); x++) {
          const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
          if ((x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2 <= r * r) result[y * width + x] = 1;
        }
    }
  }
  return result;
}

export function segmentationSeedFiles(target, raw, specification) {
  const image = inspectDecompositionReference(target, raw), { width, height } = image;
  const s = unseal(specification);
  exact(s, ['format', 'seedId', 'targetSha256', 'rawSha256', 'coordinates', 'iterations', 'rngSeed', 'componentPolicy', 'regions', 'notes']);
  id(s.seedId); text(s.notes, { limit: 2000 });
  check(s.format === 'ai_scene_segmentation_seed_spec_v1' && s.targetSha256 === target.sha256 && s.rawSha256 === target.rawSha256
    && s.coordinates === 'native-reference-pixels' && Number.isInteger(s.iterations) && s.iterations >= 1 && s.iterations <= 8
    && Number.isInteger(s.rngSeed) && s.rngSeed >= 0 && s.rngSeed <= 2147483647
    && s.componentPolicy === 'retain-components-touching-definite-foreground', 'SEGMENTATION_SEED_BINDING');
  check(Array.isArray(s.regions) && s.regions.length === target.instances.length, 'SEGMENTATION_REGION_COVERAGE');
  const seeds = s.regions.map((r, index) => {
    exact(r, ['instanceId', 'roi', 'foreground', 'background']);
    check(r.instanceId === target.instances[index].instanceId, 'SEGMENTATION_REGION_COVERAGE');
    exact(r.roi, ['x', 'y', 'width', 'height']); const b = r.roi;
    check(Object.values(b).every(Number.isInteger) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0
      && b.x + b.width <= width && b.y + b.height <= height, 'SEGMENTATION_ROI');
    return { foreground: strokes(r.foreground, width, height), background: strokes(r.background, width, height) };
  });
  const foregroundOwner = new Uint8Array(width * height);
  for (let i = 0; i < seeds.length; i++) for (let p = 0; p < foregroundOwner.length; p++) if (seeds[i].foreground[p]) {
    if (foregroundOwner[p]) check(false, 'SEGMENTATION_FOREGROUND_CONFLICT',
      `Overlapping foreground seeds: ${s.regions[foregroundOwner[p] - 1].instanceId} and ${s.regions[i].instanceId} at native ${p % width},${Math.floor(p / width)}`);
    foregroundOwner[p] = i + 1;
  }
  const files = new Map([['reference-native.png', Buffer.from(raw)], ['reconstruction-target.json', jsonBytes(target)], ['seed-spec.json', jsonBytes(specification)]]);
  const regions = s.regions.map((r, index) => {
    const labels = Buffer.alloc(width * height * 4), seed = seeds[index], b = r.roi;
    let fg = 0, bg = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      check(!(seed.foreground[p] && seed.background[p]), 'SEGMENTATION_SEED_CONFLICT');
      let label = x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height ? 3 : 2;
      if (seed.background[p] || foregroundOwner[p] && foregroundOwner[p] !== index + 1) label = 0;
      if (seed.foreground[p]) { label = 1; fg++; }
      if (label === 0) bg++;
      labels.set([label * 85, label * 85, label * 85, 255], p * 4);
    }
    check(fg > 0 && bg > 0, 'SEGMENTATION_BOTH_SEEDS_REQUIRED');
    const path = `seeds/${r.instanceId}.png`, bytes = encodeRgbaPng(width, height, labels); files.set(path, bytes);
    return { instanceId: r.instanceId, path, sha256: hash(bytes), byteLength: bytes.length, foregroundPixels: fg, backgroundPixels: bg };
  });
  const plan = seal({ format: 'ai_scene_seeded_segmentation_plan_v1', targetSha256: target.sha256, rawSha256: target.rawSha256,
    seedSpecSha256: specification.sha256, coordinates: s.coordinates, pixelSize: target.mapping.nativeSize,
    source: { path: 'reference-native.png', sha256: hash(raw), byteLength: raw.length },
    algorithm: { backend: 'opencv-grabcut-cpu', iterations: s.iterations, rngSeed: s.rngSeed, threads: 1, openCL: false,
      initialization: 'explicit-mask-labels', outsideRoi: 'probable-background-not-hard-mask',
      otherForegroundSeeds: 'definite-background', componentPolicy: s.componentPolicy }, regions,
    semanticSeedReview: 'unreviewed-operator-candidate', maximumCalls: regions.length, automaticRetry: false, generationCalls: 0 });
  files.set('seed-plan.json', jsonBytes(plan));
  files.set('README.md', Buffer.from('# CPU分区输入\n\n本包绑定准确目标、原PNG及操作员种子候选，未接受语义或遮罩。\n\n' +
    '每份seeds PNG与原图同尺寸：灰度0为确定背景、85为确定前景、170为可能背景、255为可能前景，Alpha固定255。ROI只初始化概率，不硬裁候选；其他主体的确定前景作为本主体确定背景。\n\n' +
    '外部显式CPU工具逐主体最多运行一次，保留与正种子相连的候选组件；未连种子的组件会被丢弃，可能漏掉真实细节，须审阅。无模型下载、GPU或生图。所有重叠/缺口保留未知，不按层序消解，不自动把剩余区域给天空。\n'));
  return bundle('ai_scene_segmentation_seed_bundle_v1', target, files, plan);
}
function bundle(format, target, files, report) {
  const proof = seal({ format, targetSha256: target.sha256, rawSha256: target.rawSha256, reportSha256: report.sha256,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })), generationCalls: 0, assetPackage: false });
  files.set('proof-bundle.json', jsonBytes(proof)); return { files, bundle: proof, report };
}

export function seededSegmentationReviewFiles(target, raw, specification, cpuReport, readMask) {
  const prepared = segmentationSeedFiles(target, raw, specification), plan = prepared.report, c = unseal(cpuReport);
  exact(c, ['format', 'planSha256', 'rawSha256', 'status', 'runtime', 'implementationSha256', 'calls', 'masks', 'generationCalls']);
  check(c.format === 'ai_scene_cpu_segmentation_result_v1' && c.planSha256 === plan.sha256 && c.rawSha256 === target.rawSha256
    && c.status === 'cpu-candidates-unreviewed' && c.calls === plan.regions.length && c.generationCalls === 0
    && isDigest(c.implementationSha256), 'SEGMENTATION_CPU_RESULT');
  exact(c.runtime, ['backend', 'opencv', 'distribution', 'numpy', 'threads', 'openCL', 'installedFiles', 'installedInventorySha256']);
  check(c.runtime.backend === 'opencv-grabcut-cpu' && c.runtime.threads === 1 && c.runtime.openCL === false
    && Number.isInteger(c.runtime.installedFiles) && c.runtime.installedFiles > 0 && isDigest(c.runtime.installedInventorySha256)
    && ['opencv', 'distribution', 'numpy'].every(k => typeof c.runtime[k] === 'string' && /^\d+(?:\.\d+){1,3}$/.test(c.runtime[k])), 'SEGMENTATION_CPU_RUNTIME');
  check(Array.isArray(c.masks) && c.masks.length === plan.regions.length, 'SEGMENTATION_MASK_COVERAGE');
  const { width, height } = plan.pixelSize, size = width * height;
  const coverage = new Uint8Array(size), lastOwner = new Uint8Array(size), masks = new Map();
  c.masks.forEach((m, index) => {
    exact(m, ['instanceId', 'path', 'sha256', 'byteLength', 'selectedPixels']);
    check(m.instanceId === plan.regions[index].instanceId && m.path === `masks/${m.instanceId}.png`, 'SEGMENTATION_MASK_COVERAGE');
    const bytes = readMask(m.path);
    check(isDigest(m.sha256) && hash(bytes) === m.sha256 && bytes.length === m.byteLength, 'SEGMENTATION_MASK_IDENTITY');
    const image = inspectPng(bytes, { includePixels: true }), seeds = inspectPng(prepared.files.get(plan.regions[index].path), { includePixels: true });
    check(image.width === width && image.height === height && image.transparentPixels === 0, 'SEGMENTATION_MASK_FRAME');
    let selected = 0;
    for (let p = 0; p < size; p++) {
      const k = p * 4, v = image.rgba[k], label = seeds.rgba[k];
      check([0, 255].includes(v) && image.rgba[k + 1] === v && image.rgba[k + 2] === v, 'SEGMENTATION_MASK_BINARY');
      check(!(label === 85 && v !== 255 || label === 0 && v !== 0), 'SEGMENTATION_SEEDS_CHANGED');
      if (v) { selected++; coverage[p]++; lastOwner[p] = index + 1; }
    }
    check(selected === m.selectedPixels && selected > 0, 'SEGMENTATION_MASK_COUNT'); masks.set(`candidate-${m.path}`, bytes);
  });
  const palette = visibleOwnershipPalette(target), rgba = Buffer.alloc(size * 4), conflicts = Buffer.alloc(size * 4);
  let conflictPixels = 0, noCandidatePixels = 0;
  for (let p = 0; p < size; p++) {
    const rgb = coverage[p] === 1 ? palette[lastOwner[p] - 1].rgb : [0, 0, 0]; rgba.set([...rgb, 255], p * 4);
    if (coverage[p] > 1) { conflictPixels++; conflicts.set([255, 120, 0, 255], p * 4); }
    if (!coverage[p]) noCandidatePixels++;
  }
  const derived = visibleOwnershipFiles(target, raw, encodeRgbaPng(width, height, rgba)), files = derived.files;
  files.delete('proof-bundle.json');
  for (const [path, bytes] of masks) files.set(path, bytes);
  files.set('seed-spec.json', jsonBytes(specification)); files.set('seed-plan.json', jsonBytes(plan));
  files.set('cpu-result.json', jsonBytes(cpuReport)); files.set('conflicts.png', encodeRgbaPng(width, height, conflicts));
  const report = seal({ format: 'ai_scene_seeded_segmentation_review_v1', targetSha256: target.sha256, rawSha256: target.rawSha256,
    seedPlanSha256: plan.sha256, cpuResultSha256: cpuReport.sha256, ownershipReportSha256: derived.report.sha256,
    status: 'unreviewed-cpu-segmentation-candidate', conflictPixels, noCandidatePixels, unassignedPixels: conflictPixels + noCandidatePixels,
    assignedPixels: size - conflictPixels - noCandidatePixels, semanticSegmentation: 'not-assessed',
    materialAlpha: 'not-recovered', hiddenGeometry: 'unknown', sourceFallbackPixels: 0, generationCalls: 0, assetPackage: false });
  check(report.unassignedPixels === derived.report.unassignedPixels, 'SEGMENTATION_COVERAGE');
  files.set('segmentation-review.json', jsonBytes(report));
  files.set('README.md', Buffer.from('# 场景CPU可见分区候选\n\n' +
    `目标：${target.sha256}。这是操作员种子引导的未审候选，不是自动语义通过。\n\n` +
    `[原图](reference-native.png) · [归属标签](ownership-native.png) · [可见回拼](reassembled-visible.png) · [未知区域](unassigned.png) · [候选冲突](conflicts.png) · [分区报告](segmentation-review.json) · [逐主体片段与原点](report.json)\n\n` +
    `唯一归属${report.assignedPixels}像素；无候选${noCandidatePixels}；多候选冲突${conflictPixels}。冲突与无候选都保留黑色未知，未按层序覆盖或用原图回填。\n\n` +
    '可见片段仅复制原像素，保留混色边缘；不是材质Alpha或完整遮挡恢复。细枝、同色雪面、远处细树、古堡与山体交界须单独检查。复制回拼一致不证明语义分割正确，未连正种子的真实组件可能漏失。没有新美术接受或可复用资产交付。\n'));
  return bundle('ai_scene_seeded_segmentation_review_bundle_v1', target, files, report);
}
