import { analyzePanel } from './analyze.mjs';
import { newSliceDocument, validateSliceDocument } from './document.mjs';
import { sliceError } from './geometry.mjs';

export function automaticSliceDocument(asset, target) {
  const result = analyzePanel(asset.readPixels());
  if (result.status !== 'supported') sliceError('slice.auto-unsupported', `无法自动配置：${result.reason} 请换用规则型 Panel，或在高级设置中启用手动导入。当前素材未替换。`);
  const textured = result.method === 'framed-texture-v2';
  if (!target) {
    const scale = Math.max(1, asset.source.width / 480, asset.source.height / 280);
    target = textured ? { width: Math.max(24, Math.round(asset.source.width / scale)), height: Math.max(24, Math.round(asset.source.height / scale)) } : { width: 480, height: 280 };
  }
  // A product default, not inferred physical PPU: preserve native corner size
  // for small assets; uniformly reduce oversized assets to fit the first panel.
  const multiplier = Math.max(1, asset.source.width / target.width, asset.source.height / target.height);
  return validateSliceDocument({ ...newSliceDocument(asset.source), target,
    bordersPx: result.bordersPx, multiplier, ...(textured ? { resizePolicy: 'texture-balanced-v1' } : {}) }, asset.source);
}
