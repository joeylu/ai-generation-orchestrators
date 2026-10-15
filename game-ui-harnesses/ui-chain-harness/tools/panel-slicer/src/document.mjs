import Ajv from 'ajv';
import schema from '../../../schemas/slice-document.schema.json' with { type: 'json' };
import { measureSlices, sliceSource, sliceError } from './geometry.mjs';

const check = new Ajv({ allErrors: true, strict: true }).compile(schema);
export const maxExportSide = 4096;
export function sliceViewOptions(doc) {
  return {
    ...sliceSource({ width: doc.source.width, height: doc.source.height, density: doc.density, borders: doc.bordersPx }),
    ...doc.target, multiplier: doc.multiplier, resizePolicy: doc.resizePolicy,
  };
}
export function validateSliceDocument(input, source) {
  if (!check(input)) sliceError('slice.schema', check.errors.map(e => `${e.instancePath} ${e.message}`).join('; '));
  if (source && ['sha256', 'width', 'height'].some(k => input.source[k] !== source[k]))
    sliceError('slice.source', '配置与当前 PNG 不匹配，请打开原始图片。');
  measureSlices(sliceViewOptions(input));
  if (Math.max(input.target.width, input.target.height) * input.exportResolution > maxExportSide)
    sliceError('slice.export-size', `导出图片每边最多 ${maxExportSide} 像素。`);
  return structuredClone(input);
}

// A source replacement creates a fresh document; no old borders silently carry
// over to an unrelated image. Zero borders are an explicit full-image stretch.
export function newSliceDocument(source) {
  return validateSliceDocument({
    kind: 'ui_slice_document', version: '1.0', source: { ...source },
    density: 1, bordersPx: { left: 0, top: 0, right: 0, bottom: 0 },
    multiplier: 1, target: { width: 480, height: 280 }, exportResolution: 1,
  });
}
