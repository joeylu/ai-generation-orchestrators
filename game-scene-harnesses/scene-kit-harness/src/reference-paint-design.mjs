// Port of the reviewed pure design compiler. Snapshot fields remain immutable; runtime plans are separate.
// Design compiler and synthetic preflight only. No workflow, file IO or provider calls.
// A sealed design receipt binds bytes; it is not an execution capability.
import { encodeRgbaPng, inspectPng } from './png.mjs';
import { validateRaster } from './terrain-proof/raster.mjs';
import { check, exact, hash, id, isDigest, seal, unseal, text } from './generation/common.mjs';

function size(s) {
  exact(s, ['width', 'height']);
  check([s.width, s.height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 4096), 'PAINT_DESIGN_SIZE');
}
export function proposedPaintMapping(nativeSize, localCanvas) {
  size(nativeSize); size(localCanvas);
  check(nativeSize.width >= localCanvas.width && nativeSize.height >= localCanvas.height, 'PAINT_DESIGN_UPSCALE');
  const error = Math.abs(nativeSize.width * localCanvas.height - nativeSize.height * localCanvas.width);
  const denominator = nativeSize.height * localCanvas.width;
  check(error * 100 <= denominator, 'PAINT_DESIGN_ASPECT');
  return { profile: 'whole-canvas-independent-axis-integer-area-v1', sourceCanvas: nativeSize, destinationCanvas: localCanvas,
    xScale: { numerator: localCanvas.width, denominator: nativeSize.width },
    yScale: { numerator: localCanvas.height, denominator: nativeSize.height },
    aspectError: { numerator: error, denominator }, aspectTolerance: { numerator: 1, denominator: 100 },
    crop: 'none', autoFit: false, alphaBoundsUsed: false, mayApplySmallAxisRatioChange: true };
}
export function assertOpaquePaintStudy(image) {
  validateRaster(image); let varied = false;
  for (let i = 0; i < image.rgba.length; i += 4) {
    check(image.rgba[i + 3] === 255, 'PAINT_DESIGN_OPAQUE');
    if (image.rgba[i] !== image.rgba[0] || image.rgba[i + 1] !== image.rgba[1] || image.rgba[i + 2] !== image.rgba[2]) varied = true;
  }
  check(varied, 'PAINT_DESIGN_BLANK');
}
const decode = bytes => inspectPng(bytes, { includePixels: true });
export function paintGeometryGuide(alphaBytes) {
  const image = decode(alphaBytes), { width, height } = image;
  const horizontal = Buffer.alloc(width * height), dilation = Buffer.alloc(width * height), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    for (let dx = -8; dx <= 8; dx++) if (x + dx >= 0 && x + dx < width && image.rgba[(y * width + x + dx) * 4 + 3]) {
      horizontal[y * width + x] = 1; break;
    }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    for (let dy = -8; dy <= 8; dy++) if (y + dy >= 0 && y + dy < height && horizontal[(y + dy) * width + x]) {
      dilation[i] = 1; break;
    }
    const value = image.rgba[i * 4 + 3] ? 213 : dilation[i] ? 145 : 70;
    rgba.set([value, value, value, 255], i * 4);
  }
  return encodeRgbaPng(width, height, rgba);
}
export function compilePaintGeometryDesign(geometry, alphaBytes, acceptance, inputs, brief) {
  const g = unseal(geometry), a = unseal(acceptance), b = unseal(brief);
  exact(b, ['format', 'subject', 'appearance', 'exclusions', 'intent']);
  check(b.format === 'ai_scene_paint_brief_v1' && Array.isArray(b.exclusions) && b.exclusions.length > 0 && b.exclusions.length <= 20, 'PAINT_DESIGN_BRIEF');
  for (const value of [b.subject, b.appearance, b.intent, ...b.exclusions]) text(value, { limit: 2000 });
  exact(g, ['format', 'sourcePacketSha256', 'sourceDraftSha256', 'alphaPngSha256', 'alphaRgbaSha256', 'instanceId',
    'referenceSha256', 'targetSha256', 'nativeFrame', 'localCanvas', 'origin', 'frameClippedEdges',
    'originalUncertainPixels', 'opticalAlphaMeasured']);
  exact(a, ['format', 'geometryPacketSha256', 'alphaPngSha256', 'decision', 'scope', 'provenance', 'recordedOn',
    'userReply', 'computeAuthorized', 'realImageApplicationAuthorized']);
  check(g.format === 'ai_scene_geometry_design_target_v1' && a.format === 'ai_scene_geometry_design_acceptance_v1', 'PAINT_DESIGN_FORMAT');
  for (const key of ['sourcePacketSha256', 'sourceDraftSha256', 'alphaPngSha256', 'alphaRgbaSha256', 'referenceSha256', 'targetSha256'])
    check(isDigest(g[key]), 'PAINT_DESIGN_BINDING');
  id(g.instanceId); size(g.nativeFrame); size(g.localCanvas); exact(g.origin, ['x', 'y']);
  check([g.origin.x, g.origin.y].every(v => Number.isSafeInteger(v) && v >= 0)
    && g.origin.x + g.localCanvas.width <= g.nativeFrame.width && g.origin.y + g.localCanvas.height <= g.nativeFrame.height, 'PAINT_DESIGN_ORIGIN');
  check(a.decision === 'accept' && a.scope === 'geometry-design-target-only'
    && a.geometryPacketSha256 === g.sourcePacketSha256 && a.alphaPngSha256 === g.alphaPngSha256
    && a.computeAuthorized === false && a.realImageApplicationAuthorized === false, 'PAINT_DESIGN_REVIEW');
  check(Number.isSafeInteger(g.originalUncertainPixels) && g.originalUncertainPixels >= 0
    && g.originalUncertainPixels <= g.localCanvas.width * g.localCanvas.height && g.opticalAlphaMeasured === false, 'PAINT_DESIGN_UNCERTAINTY');
  check(Array.isArray(g.frameClippedEdges) && new Set(g.frameClippedEdges).size === g.frameClippedEdges.length
    && g.frameClippedEdges.every(e => ['left', 'right', 'top', 'bottom'].includes(e)), 'PAINT_DESIGN_FRAME_EDGES');
  const atFrame = { left: g.origin.x === 0, top: g.origin.y === 0,
    right: g.origin.x + g.localCanvas.width === g.nativeFrame.width, bottom: g.origin.y + g.localCanvas.height === g.nativeFrame.height };
  check(g.frameClippedEdges.every(e => atFrame[e]), 'PAINT_DESIGN_FRAME_EDGES');
  check(hash(alphaBytes) === g.alphaPngSha256, 'PAINT_DESIGN_BINDING');
  const alpha = decode(alphaBytes);
  check(alpha.width === g.localCanvas.width && alpha.height === g.localCanvas.height
    && hash(alpha.rgba) === g.alphaRgbaSha256 && alpha.nonzeroAlphaPixels > 0, 'PAINT_DESIGN_BINDING');
  for (let i = 0; i < alpha.rgba.length; i += 4) {
    const c = alpha.rgba[i + 3] ? 255 : 0;
    check(alpha.rgba[i] === c && alpha.rgba[i + 1] === c && alpha.rgba[i + 2] === c, 'PAINT_DESIGN_MASK_ONLY');
    if (alpha.rgba[i + 3]) {
      const n = i / 4, x = n % alpha.width, y = Math.floor(n / alpha.width);
      check((x !== 0 || g.frameClippedEdges.includes('left'))
        && (x !== alpha.width - 1 || g.frameClippedEdges.includes('right'))
        && (y !== 0 || g.frameClippedEdges.includes('top'))
        && (y !== alpha.height - 1 || g.frameClippedEdges.includes('bottom')), 'PAINT_DESIGN_FRAME_EDGES');
    }
  }
  exact(inputs, ['geometryGuide', 'appearanceReference']);
  const images = ['geometryGuide', 'appearanceReference'].map((role, i) => {
    const bytes = inputs[role], image = inspectPng(bytes, { includePixels: true, allowCabx: role === 'appearanceReference' });
    const expected = i === 0 ? g.localCanvas : g.nativeFrame;
    check(image.width === expected.width && image.height === expected.height && image.transparentPixels === 0, 'PAINT_DESIGN_INPUT');
    if (role === 'appearanceReference') check(hash(bytes) === g.referenceSha256, 'PAINT_DESIGN_REFERENCE');
    return { role, imageNumber: i + 1, sha256: hash(bytes), byteLength: bytes.length, pixelSize: expected };
  });
  check(hash(inputs.geometryGuide) === hash(paintGeometryGuide(alphaBytes)), 'PAINT_DESIGN_GUIDE_REPLAY');
  const prompt = [
    `任务：重绘一张2D横版场景的“${b.subject}”绘制源。这是局部外观绘制，不是完整场景，也不是最终透明资产。`,
    `输入1是${g.localCanvas.width}×${g.localCanvas.height}局部几何引导：浅色区域是已经确认的主体轮廓，外圈中灰带是8个局部像素的绘制余量，深灰是区域外。引导图只指定范围，不要把灰色色块当作美术风格。`,
    `输入2是未经改动的完整参考图，只参考其原生坐标窗口(x=${g.origin.x}, y=${g.origin.y}, width=${g.localCanvas.width}, height=${g.localCanvas.height})内目标实例的外观，不照搬整图构图。该窗口只是文字定位，没有另传局部裁图。外观要求：${b.appearance}。以下内容不属于绘制源，不能画进目标主体内部：${b.exclusions.join('、')}。`,
    `按输入1的整张画布布局绘制，主体相对位置、大小和各部位尽量对齐。${b.intent}。不居中放大，不补全框外，不新增道具。模型引导是软约束，后续程序不会替你修正画错的材质或错位。`,
    '目标形状及其外圈余量内都要覆盖对应部位的外观，细部也要在正确位置绘制；边缘向余量自然延伸，避免背景色混入最终裁边。余量只用于绘制源，最终几何不会随之扩大。',
    `输出一张不透明横向PNG，首选${g.localCanvas.width * 2 <= 4096 && g.localCanvas.height * 2 <= 4096 ? `${g.localCanvas.width * 2}×${g.localCanvas.height * 2}` : `${g.localCanvas.width}×${g.localCanvas.height}`}，宽高比跟随输入1的局部画布，不跟随输入2整场景。画布区域外用简单中性灰底；不要透明、棋盘格、文字、标签、绿线或黄色标记。`,
    '清晰度保持一致，不使用景深虚化。细节以输入2为准，轮廓内不混入已列出的排除内容，不把整个上下文场景照搬成素材。'
  ].join('\n\n');
  return seal({ format: 'ai_scene_paint_derivation_design_v1', status: 'pending-design-review',
    geometryTargetSha256: geometry.sha256, geometryAcceptanceSha256: acceptance.sha256, instanceId: g.instanceId,
    referenceSha256: g.referenceSha256, targetSha256: g.targetSha256, alphaPngSha256: g.alphaPngSha256,
    localCanvas: g.localCanvas, placement: { nativeFrame: g.nativeFrame, origin: g.origin, scale: 1, rotation: 0, autoFit: false },
    uncertainty: { originalUncertainPixels: g.originalUncertainPixels, opticalAlphaMeasured: false,
      acceptanceMeaning: 'chosen-approximate-design-shape-not-measured-reference-alpha' },
    sourcePaintDraft: { suppliedSource: null, sourceKind: 'new-opaque-local-paint-canvas', maximumCalls: 1, images, briefSha256: brief.sha256,
      prompt, transparentBackground: false, nativePngPreserved: true, retry: 'none-after-failure-or-unknown',
      imageToolSizeSelectorAvailable: false, preferredCanvasSizeIsSoftGuidance: true },
    paintReception: { opaqueOnly: true, minimumSize: g.localCanvas, maximumEdge: 4096,
      aspectTolerance: { numerator: 1, denominator: 100 }, mappingProfile: 'whole-canvas-independent-axis-integer-area-v1',
      permitSmallAxisRatioChangeWithinTolerance: true, crop: 'none', alphaBoundsFit: false,
      blankPaintRejected: true, semanticCorrectness: 'separate-human-paint-review' },
    derivationDraft: { executable: false, sourcePaintSha256: null, algorithm: 'opaque-area-normalize-then-continuous-alpha-multiply-v1',
      formula: 'candidateAlpha=round(normalizedPaintAlpha*acceptedGeometryAlpha/255)', maskResampling: 'none',
      paintBleedGuideRadius: 8, zeroRgbWhereFinalAlphaZero: true, originalPngOverwritten: false,
      alphaMustEqualAcceptedGeometryWhenPaintOpaque: true, tint: false, referencePixelFallback: false,
      existingGeneratedSourcesAllowed: false, sourceSpecificApplicationApprovalRequired: true,
      provisionalAppearanceCannotBeCertifiedByMask: true },
    reviewSequence: ['accept-source-and-derivation-design', 'implement-and-freeze-one-source-compute-plan',
      'obtain-separate-single-use-compute-confirmation', 'receive-native-png-and-show-unmasked-normalized-paint',
      'review-painted-appearance-and-approve-exact-source-mask-mapping-application',
      'derive-only-after-that-approval', 'review-derived-layer-and-recomposition'],
    runtimeSupport: 'not-integrated-with-generation-cli-or-studio', productionReady: false, executable: false,
    computeAuthorized: false, realImageDerivationAuthorized: false, generationCalls: 0 });
}
