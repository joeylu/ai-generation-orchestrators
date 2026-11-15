import { inspectPng, encodeRgbaPng } from './png.mjs';
import { resampleEnvironmentAlpha } from './environment-proof.mjs';
import { raster } from './terrain-proof/raster.mjs';
import { inspectDecompositionReference } from './reference-decomposition.mjs';
import { assessReferenceAsset } from './generation/reference-asset.mjs';
import { assessReferenceAssetEdit } from './generation/reference-asset-edit.mjs';
import { check, hash, jsonBytes, seal, unseal } from './generation/common.mjs';

function put(canvas, source, x, y, over = false) {
  for (let sy = 0; sy < source.height; sy++) for (let sx = 0; sx < source.width; sx++) {
    const dx = x + sx, dy = y + sy; if (dx < 0 || dy < 0 || dx >= canvas.width || dy >= canvas.height) continue;
    const a = (sy * source.width + sx) * 4, b = (dy * canvas.width + dx) * 4;
    if (!over) { source.rgba.copy(canvas.rgba, b, a, a + 4); continue; }
    const sa = source.rgba[a + 3], da = canvas.rgba[b + 3], numerator = sa * 255 + da * (255 - sa);
    if (!numerator) continue;
    for (let c = 0; c < 3; c++) canvas.rgba[b + c] = Math.floor((source.rgba[a + c] * sa * 255 + canvas.rgba[b + c] * da * (255 - sa) + numerator / 2) / numerator);
    canvas.rgba[b + 3] = Math.floor((numerator + 127) / 255);
  }
}
function contain(image, size) {
  const byWidth = size.width * image.height <= size.height * image.width;
  const numerator = byWidth ? size.width : size.height, denominator = byWidth ? image.width : image.height;
  const resized = { width: Math.floor(image.width * numerator / denominator), height: Math.floor(image.height * numerator / denominator) };
  const offset = { x: Math.floor((size.width - resized.width) / 2), y: Math.floor((size.height - resized.height) / 2) };
  const output = raster(size.width, size.height);
  put(output, resampleEnvironmentAlpha(image, { x: 0, y: 0, width: image.width, height: image.height }, resized.width, resized.height), offset.x, offset.y);
  return { output, mapping: { profile: 'uniform-contain-no-crop-floor-v1', nativeSize: { width: image.width, height: image.height }, frame: size,
    scale: { numerator, denominator }, resized, offset } };
}
export function referenceAssetProofFiles(target, referenceRaw, sources) {
  const original = inspectDecompositionReference(target, referenceRaw), viewport = target.mapping.viewport;
  check(Array.isArray(sources) && sources.length > 0 && sources.length <= target.instances.length, 'REFERENCE_ASSET_PROOF_SOURCES');
  const ids = new Set(), files = new Map([['reference-native.png', Buffer.from(referenceRaw)], ['reconstruction-target.json', jsonBytes(target)]]);
  const composite = raster(viewport.width, viewport.height), rows = [];
  const z = s => target.layers.find(l => l.layerId === target.instances.find(i => i.instanceId === s.plan.recipe.assetId)?.layerId)?.zIndex ?? 0;
  const ordered = [...sources].sort((a, b) => z(a) - z(b)
    || target.instances.findIndex(i => i.instanceId === a.plan.recipe.assetId) - target.instances.findIndex(i => i.instanceId === b.plan.recipe.assetId));
  for (const { plan, bytes } of ordered) {
    unseal(plan); const id = plan.recipe.assetId;
    check(['ai_scene_generation_plan_v21', 'ai_scene_generation_plan_v22', 'ai_scene_generation_plan_v23', 'ai_scene_generation_plan_v24'].includes(plan.format) && plan.recipe.targetSha256 === target.sha256
      && plan.referenceEvidence[0].rawSha256 === target.rawSha256 && !ids.has(id) && target.instances.some(i => i.instanceId === id), 'REFERENCE_ASSET_PROOF_BINDING'); ids.add(id);
    const edit = ['ai_scene_generation_plan_v22', 'ai_scene_generation_plan_v23', 'ai_scene_generation_plan_v24'].includes(plan.format);
    const qa = (edit ? assessReferenceAssetEdit : assessReferenceAsset)(plan, bytes);
    check(qa.status === 'pass', 'REFERENCE_ASSET_PROOF_TECHNICAL');
    const png = inspectPng(bytes, { includePixels: true, allowCabx: true, allowHiddenRgb: true });
    const { output, mapping } = contain(png, plan.placement.frame), aperture = plan.placement.referenceAperture;
    check(aperture.width === viewport.width && aperture.height === viewport.height, 'REFERENCE_ASSET_PROOF_FRAME');
    const selected = raster(viewport.width, viewport.height);
    for (let y = 0; y < viewport.height; y++) output.rgba.copy(selected.rgba, y * viewport.width * 4,
      ((aperture.y + y) * output.width + aperture.x) * 4, ((aperture.y + y) * output.width + aperture.x + viewport.width) * 4);
    put(composite, selected, 0, 0, true);
    const prefix = `assets/${id}`;
    files.set(`${prefix}/source-native.png`, Buffer.from(bytes)); files.set(`${prefix}/plan.json`, jsonBytes(plan));
    files.set(`${prefix}/${edit ? 'original-canvas-frame' : 'padded-frame'}.png`, encodeRgbaPng(output.width, output.height, output.rgba));
    files.set(`${prefix}/in-reference-frame.png`, encodeRgbaPng(selected.width, selected.height, selected.rgba));
    rows.push({ instanceId: id, planSha256: plan.sha256, rawSha256: hash(bytes), nativeToStorage: mapping,
      referenceAperture: aperture, sourceModified: false, alphaBoundsRepositioned: false, tintApplied: false });
  }
  const referenceFrame = contain(original, viewport).output, side = raster(viewport.width * 2, viewport.height);
  put(side, referenceFrame, 0, 0); put(side, composite, viewport.width, 0);
  files.set('reference-frame.png', encodeRgbaPng(viewport.width, viewport.height, referenceFrame.rgba));
  files.set('selected-assets-only.png', encodeRgbaPng(viewport.width, viewport.height, composite.rgba));
  files.set('reference-vs-selected-assets.png', encodeRgbaPng(side.width, side.height, side.rgba));
  const report = seal({ format: 'ai_scene_reference_asset_proof_v1', targetSha256: target.sha256, rawSha256: target.rawSha256,
    status: 'pending-reconstruction-review', sources: rows, generatedInstances: [...ids],
    notGeneratedInstances: target.instances.filter(i => !ids.has(i.instanceId)).map(i => i.instanceId),
    sourceFallbackPixels: 0, compositionMeaning: 'listed-generated-assets-only-not-complete-scene',
    geometryFidelity: 'not-assessed', artAcceptance: 'not-assessed', pixelIdentityRequired: false, generationCalls: 0, assetPackage: false });
  files.set('report.json', jsonBytes(report));
  const edited = sources.some(s => ['ai_scene_generation_plan_v22', 'ai_scene_generation_plan_v23', 'ai_scene_generation_plan_v24'].includes(s.plan.format));
  files.set('README.md', Buffer.from(edited ? '# 原画布可见图层对照\n\n[左原图／右已生成层](reference-vs-selected-assets.png) · [仅已生成层](selected-assets-only.png)\n\n右侧只含实际生成图层，其他层透明，没有原图回填。整张输出画布统一缩小映射到原参考框，不按Alpha边界居中或加tint。原PNG字节保留。原有裁边仅按计划声明允许；框外与遮挡部分仍未知，未交付完整可复用模块。位置、轮廓和外观待美术审阅，技术接收不代表忠实还原。\n'
    : '# 重生成素材的参考帧对照\n\n[左原图／右已生成素材](reference-vs-selected-assets.png) · [仅已生成素材](selected-assets-only.png)\n\n' +
    '右图只叠放本批实际生成素材，其余图层保留透明；没有原图底图或复制回填。不按Alpha边界居中/放大，不加tint。原生PNG保留，仅整张输出画布按固定存储框缩小，截取原参考窗；没有语义修图。画框外推定内容保留在各自padded-frame和原图中，视觉还原待审，不构成完整场景或资产包。\n'));
  const bundle = seal({ format: 'ai_scene_reference_asset_proof_bundle_v1', targetSha256: target.sha256, reportSha256: report.sha256,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })), generationCalls: 0, assetPackage: false });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report, bundle };
}
