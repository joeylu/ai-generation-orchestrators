import { inspectPng, encodeRgbaPng } from './png.mjs';
import { inspectDecompositionReference, visibleOwnershipFiles, visibleOwnershipPalette } from './reference-decomposition.mjs';
import { check, digest, exact, hash, id, isDigest, jsonBytes, seal, text, unseal } from './generation/common.mjs';
import { portablePath } from './files.mjs';

export function promptSegmentationFiles(target, raw, specification) {
  const { width, height } = inspectDecompositionReference(target, raw), s = unseal(specification);
  exact(s, ['format', 'specId', 'targetSha256', 'rawSha256', 'coordinates', 'modelFiles', 'runtimeSha256', 'producerSha256', 'regions', 'notes']);
  id(s.specId); text(s.notes, { limit: 2000 });
  check(s.format === 'ai_scene_prompt_segmentation_spec_v1' && s.targetSha256 === target.sha256 && s.rawSha256 === target.rawSha256
    && s.coordinates === 'native-reference-pixels' && isDigest(s.runtimeSha256) && isDigest(s.producerSha256), 'PROMPT_SEGMENTATION_BINDING');
  check(Array.isArray(s.modelFiles) && s.modelFiles.length > 0 && s.modelFiles.length <= 16, 'PROMPT_MODEL_FILES');
  const modelNames = new Set();
  for (const f of s.modelFiles) {
    exact(f, ['path', 'byteLength', 'sha256']);
    check(portablePath(f.path) && !modelNames.has(f.path.toLowerCase()) && Number.isInteger(f.byteLength)
      && f.byteLength > 0 && f.byteLength <= 1073741824 && isDigest(f.sha256), 'PROMPT_MODEL_FILES'); modelNames.add(f.path.toLowerCase());
  }
  check(Array.isArray(s.regions) && s.regions.length === target.instances.length, 'PROMPT_REGION_COVERAGE');
  const positives = new Map();
  s.regions.forEach((r, i) => {
    exact(r, ['instanceId', 'box', 'points']);
    check(r.instanceId === target.instances[i].instanceId, 'PROMPT_REGION_COVERAGE');
    if (r.box !== null) {
      exact(r.box, ['x', 'y', 'width', 'height']); const b = r.box;
      check(Object.values(b).every(Number.isInteger) && b.x >= 0 && b.y >= 0 && b.width >= 2 && b.height >= 2
        && b.x + b.width <= width && b.y + b.height <= height, 'PROMPT_BOX');
    }
    check(Array.isArray(r.points) && r.points.length >= 2 && r.points.length <= 256, 'PROMPT_POINTS');
    const seen = new Set();
    for (const p of r.points) {
      exact(p, ['x', 'y', 'label']); const key = `${p.x},${p.y}`;
      check(Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < width && p.y < height
        && [0, 1].includes(p.label) && !seen.has(key), 'PROMPT_POINT'); seen.add(key);
      if (p.label === 1) { check(!positives.has(key), 'PROMPT_POSITIVE_CONFLICT'); positives.set(key, r.instanceId); }
    }
    check(r.points.some(p => p.label === 1) && r.points.some(p => p.label === 0), 'PROMPT_BOTH_LABELS_REQUIRED');
  });
  const plan = seal({ format: 'ai_scene_prompt_segmentation_plan_v1', specSha256: specification.sha256,
    targetSha256: target.sha256, rawSha256: target.rawSha256, source: { path: 'reference-native.png', byteLength: raw.length, sha256: hash(raw) },
    pixelSize: { width, height }, modelFiles: s.modelFiles, modelFilesSha256: digest(s.modelFiles),
    runtimeSha256: s.runtimeSha256, producerSha256: s.producerSha256, regions: s.regions,
    algorithm: { profile: 'point-box-cpu-v1', device: 'cpu', dtype: 'float32', threads: 1, threshold: 0,
      boxPolicy: 'prompt-only-not-hard-crop', promptMismatchPolicy: 'report-without-mask-repair',
      maskPostprocessing: 'native-size-threshold-only', overlapPolicy: 'unique-or-unknown' },
    maximumModelLoads: 1, maximumCalls: s.regions.length, networkRequests: 0, automaticRetry: false, generationCalls: 0 });
  const files = new Map([['reference-native.png', Buffer.from(raw)], ['reconstruction-target.json', jsonBytes(target)],
    ['prompt-spec.json', jsonBytes(specification)], ['prompt-plan.json', jsonBytes(plan)]]);
  files.set('README.md', Buffer.from('# 点框CPU分区输入\n\n绑定准确原图/目标、模型文件和显式运行时指纹；点与框是提示，不是已审遮罩。每实例单帧一次，无自动重试、下载、GPU或生图。框不硬裁，正负提示不用于强改输出，错误由候选审阅暴露。\n'));
  return bundle('ai_scene_prompt_segmentation_input_bundle_v1', target, files, plan);
}

function bundle(format, target, files, report) {
  const proof = seal({ format, targetSha256: target.sha256, rawSha256: target.rawSha256, reportSha256: report.sha256,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })), generationCalls: 0, assetPackage: false });
  files.set('proof-bundle.json', jsonBytes(proof)); return { files, bundle: proof, report };
}

export function promptSegmentationReviewFiles(target, raw, specification, candidate, readMask) {
  const prepared = promptSegmentationFiles(target, raw, specification), plan = prepared.report, c = unseal(candidate);
  exact(c, ['format', 'planSha256', 'rawSha256', 'status', 'runtimeSha256', 'producerSha256', 'modelFilesSha256', 'modelLoads', 'calls', 'masks', 'networkRequests', 'generationCalls']);
  check(c.format === 'ai_scene_prompt_segmentation_result_v1' && c.planSha256 === plan.sha256 && c.rawSha256 === target.rawSha256
    && c.status === 'unreviewed-prompt-candidates' && c.runtimeSha256 === plan.runtimeSha256 && c.producerSha256 === plan.producerSha256
    && c.modelFilesSha256 === plan.modelFilesSha256 && c.modelLoads === 1 && c.calls === plan.regions.length
    && c.networkRequests === 0 && c.generationCalls === 0, 'PROMPT_RESULT_BINDING');
  check(Array.isArray(c.masks) && c.masks.length === plan.regions.length, 'PROMPT_MASK_COVERAGE');
  const { width, height } = plan.pixelSize, size = width * height, coverage = new Uint8Array(size), owner = new Uint8Array(size);
  const files = new Map(), promptChecks = [];
  c.masks.forEach((m, i) => {
    exact(m, ['instanceId', 'path', 'sha256', 'byteLength', 'selectedPixels']);
    check(m.instanceId === plan.regions[i].instanceId && m.path === `masks/${m.instanceId}.png`, 'PROMPT_MASK_COVERAGE');
    const bytes = readMask(m.path);
    check(isDigest(m.sha256) && hash(bytes) === m.sha256 && bytes.length === m.byteLength, 'PROMPT_MASK_IDENTITY');
    const image = inspectPng(bytes, { includePixels: true });
    check(image.width === width && image.height === height && image.transparentPixels === 0, 'PROMPT_MASK_FRAME');
    let selected = 0;
    for (let p = 0; p < size; p++) {
      const k = p * 4, v = image.rgba[k];
      check([0, 255].includes(v) && image.rgba[k + 1] === v && image.rgba[k + 2] === v, 'PROMPT_MASK_BINARY');
      if (v) { selected++; coverage[p]++; owner[p] = i + 1; }
    }
    check(selected === m.selectedPixels, 'PROMPT_MASK_COUNT');
    const misses = plan.regions[i].points.filter(p => Number(image.rgba[(p.y * width + p.x) * 4] !== 0) !== p.label);
    promptChecks.push({ instanceId: m.instanceId, positiveMisses: misses.filter(p => p.label === 1).length,
      negativeHits: misses.filter(p => p.label === 0).length, emptyMask: selected === 0 });
    files.set(`candidate-${m.path}`, bytes);
  });
  const palette = visibleOwnershipPalette(target), rgba = Buffer.alloc(size * 4), conflicts = Buffer.alloc(size * 4);
  let conflictPixels = 0, noCandidatePixels = 0;
  for (let p = 0; p < size; p++) {
    rgba.set([...(coverage[p] === 1 ? palette[owner[p] - 1].rgb : [0, 0, 0]), 255], p * 4);
    if (coverage[p] > 1) { conflictPixels++; conflicts.set([255, 120, 0, 255], p * 4); }
    if (!coverage[p]) noCandidatePixels++;
  }
  const derived = visibleOwnershipFiles(target, raw, encodeRgbaPng(width, height, rgba)); derived.files.delete('proof-bundle.json');
  for (const [path, bytes] of files) derived.files.set(path, bytes);
  derived.files.set('prompt-spec.json', jsonBytes(specification)); derived.files.set('prompt-plan.json', jsonBytes(plan));
  derived.files.set('prompt-result.json', jsonBytes(candidate)); derived.files.set('conflicts.png', encodeRgbaPng(width, height, conflicts));
  const report = seal({ format: 'ai_scene_prompt_segmentation_review_v1', targetSha256: target.sha256, rawSha256: target.rawSha256,
    planSha256: plan.sha256, resultSha256: candidate.sha256, status: 'unreviewed-prompt-segmentation-candidate',
    assignedPixels: size - conflictPixels - noCandidatePixels, conflictPixels, noCandidatePixels,
    unassignedPixels: conflictPixels + noCandidatePixels, promptChecks, semanticSegmentation: 'not-assessed',
    materialAlpha: 'not-recovered', hiddenGeometry: 'unknown', sourceFallbackPixels: 0, generationCalls: 0, assetPackage: false });
  check(report.unassignedPixels === derived.report.unassignedPixels, 'PROMPT_COVERAGE');
  derived.files.set('prompt-review.json', jsonBytes(report));
  derived.files.set('README.md', Buffer.from('# 点框CPU可见分区候选\n\n' +
    `[原图](reference-native.png) · [回拼](reassembled-visible.png) · [未知](unassigned.png) · [冲突](conflicts.png) · [提示偏差](prompt-review.json)\n\n` +
    `唯一归属${report.assignedPixels}像素；冲突${conflictPixels}；无候选${noCandidatePixels}。正负点不强改遮罩，框不裁图，冲突与缺口保持未知，无层序或原图回填。可见片段只复制原像素，不是干净Alpha、隐藏补全或完整资产包；当前未审。\n`));
  return bundle('ai_scene_prompt_segmentation_review_bundle_v1', target, derived.files, report);
}
