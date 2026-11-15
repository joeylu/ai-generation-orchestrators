import { inspectPng, encodeRgbaPng } from './png.mjs';
import { areaResample, blit, raster } from './terrain-proof/raster.mjs';
import { resampleEnvironmentAlpha } from './environment-proof.mjs';
import { assessPaintSource } from './generation/reference-paint.mjs';
import { check, hash, jsonBytes, seal } from './generation/common.mjs';

function normalizedPaint(plan, bytes) {
  const qa = assessPaintSource(plan, bytes); check(qa.status === 'pass', 'PAINT_SOURCE_TECHNICAL');
  const source = inspectPng(bytes, { includePixels: true, allowCabx: true });
  const size = plan.target.localCanvas;
  return { qa, image: areaResample(source, { x: 0, y: 0, width: source.width, height: source.height }, size.width, size.height) };
}
function bundle(files, report) {
  files.set('report.json', jsonBytes(report));
  const value = seal({ format: 'ai_scene_paint_proof_bundle_v1', reportSha256: report.sha256,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })),
    productionAsset: false, artAcceptance: 'not-assessed', generationCalls: 0 });
  files.set('proof-bundle.json', jsonBytes(value)); return { files, report, bundle: value };
}
export function paintSourceReviewFiles(plan, bytes, controls) {
  const { qa, image } = normalizedPaint(plan, bytes);
  const files = new Map([['source-native.png', Buffer.from(bytes)], ['source-normalized-unmasked.png', encodeRgbaPng(image.width, image.height, image.rgba)],
    ['plan.json', jsonBytes(plan)], ['technical.json', jsonBytes(qa)]]);
  const report = seal({ format: 'ai_scene_unmasked_paint_review_v1', planSha256: plan.sha256, rawSha256: hash(bytes),
    technicalSha256: qa.sha256, controlsSha256: controls.sha256, designSha256: controls.design.sha256,
    normalizedRgbaSha256: hash(image.rgba), mapping: qa.mapping, alphaApplied: false,
    sourceNativePreserved: true, sourceArtAcceptance: 'not-assessed', productionAsset: false });
  files.set('README.md', Buffer.from('# 绘制源外观审阅\n\n原生PNG及按已审整幅规则归一化的绘制源；尚未应用Alpha。技术通过只确认不透明/尺寸等条件，岩、雪、木质、部位位置与排除内容仍须审阅。来源美术接受不代表派生层通过；真实应用还需准确源SHA与Alpha/映射的独立批准。\n'));
  return bundle(files, report);
}
// Caller must enforce current source art acceptance and exact application approval.
export function paintLayerFiles(plan, bytes, controls, alphaBytes, proposal, applicationReview, target) {
  const { qa, image } = normalizedPaint(plan, bytes), mask = inspectPng(alphaBytes, { includePixels: true });
  check(proposal.sourcePaintSha256 === hash(bytes) && proposal.geometryAlphaSha256 === hash(alphaBytes)
    && applicationReview.proposalSha256 === proposal.sha256 && applicationReview.receipt.decision === 'accept'
    && applicationReview.receipt.targetSha256 === proposal.sha256 && target.sha256 === controls.targetSha256, 'PAINT_APPLICATION_REVIEW_REQUIRED');
  const layer = raster(image.width, image.height); check(mask.width === image.width && mask.height === image.height, 'PAINT_MASK_SIZE');
  for (let i = 0; i < image.width * image.height; i++) {
    const p = i * 4, alpha = Math.floor((image.rgba[p + 3] * mask.rgba[p + 3] + 127) / 255);
    if (alpha) image.rgba.copy(layer.rgba, p, p, p + 3);
    layer.rgba[p + 3] = alpha;
    check(alpha === mask.rgba[p + 3], 'PAINT_GEOMETRY_CHANGED');
  }
  const native = raster(controls.geometry.nativeFrame.width, controls.geometry.nativeFrame.height), origin = controls.geometry.origin;
  blit(native, layer, origin.x, origin.y);
  const mapping = target.mapping, scaled = resampleEnvironmentAlpha(native, { x: 0, y: 0, width: native.width, height: native.height }, mapping.resized.width, mapping.resized.height);
  const viewport = raster(mapping.viewport.width, mapping.viewport.height); blit(viewport, scaled, mapping.offset.x, mapping.offset.y);
  const files = new Map([['source-native.png', Buffer.from(bytes)], ['source-normalized-unmasked.png', encodeRgbaPng(image.width, image.height, image.rgba)],
    ['geometry-alpha.png', Buffer.from(alphaBytes)], ['layer-local.png', encodeRgbaPng(layer.width, layer.height, layer.rgba)],
    ['layer-native-frame.png', encodeRgbaPng(native.width, native.height, native.rgba)], ['layer-reference-viewport.png', encodeRgbaPng(viewport.width, viewport.height, viewport.rgba)],
    ['application-proposal.json', jsonBytes(proposal)], ['application-review.json', jsonBytes(applicationReview)], ['plan.json', jsonBytes(plan)]]);
  const report = seal({ format: 'ai_scene_paint_layer_derivation_v1', planSha256: plan.sha256, rawSha256: hash(bytes), technicalSha256: qa.sha256,
    controlsSha256: controls.sha256, geometryTargetSha256: controls.geometry.sha256, geometryAlphaSha256: hash(alphaBytes),
    sourceArtReviewSha256: proposal.sourceArtReviewSha256, applicationProposalSha256: proposal.sha256, applicationReviewSha256: applicationReview.sha256,
    normalization: qa.mapping, localCanvas: controls.geometry.localCanvas, placement: plan.placement,
    normalizedRgbaSha256: hash(image.rgba), layerRgbaSha256: hash(layer.rgba), nativeFrameRgbaSha256: hash(native.rgba),
    alphaExactlyEqualsAcceptedGeometry: true, originalReferenceAppearancePixelsUsed: 0, tintApplied: false, alphaBoundsFit: false,
    originalUncertainPixels: controls.geometry.originalUncertainPixels, opticalAlphaMeasured: false,
    sourceNativeModified: false, geometryMaskModified: false, viewportPreviewResampledFromNativeLayer: true,
    notGeneratedLayers: 'transparent', artAcceptance: 'not-assessed', completedReusableModule: false, productionAsset: false,
    ...(plan.format==='ai_scene_generation_plan_v26'?{materialControlsSha256:proposal.materialControlsSha256,
      materialCoverageProposalSha256:proposal.materialCoverageProposalSha256,materialCoverageReviewSha256:proposal.materialCoverageReviewSha256}:{}) });
  files.set('README.md', Buffer.from('# 已授权源的确定性几何派生\n\n局部层按已接受Alpha与显式原点制作；原PNG和Alpha原字节保留。原生参考框及viewport只含这一层，其他层透明，无原图回填。透明范围正确不证明材质或还原美术正确；派生层和回拼仍待独立审阅，不是完整可复用模块或正式资产包。\n'));
  return bundle(files, report);
}
