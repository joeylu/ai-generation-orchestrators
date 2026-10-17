import { sliceError } from './geometry.mjs';

export const maxSourceBytes = 32 * 1024 * 1024;
// Inspect IHDR before decoding, so a tiny compressed file cannot request an
// unbounded bitmap. Browser decoding verifies the complete PNG stream.
export async function loadSlicePng(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || bytes.length > maxSourceBytes || signature.some((v, i) => bytes[i] !== v))
    sliceError('slice.png', '请选择不超过 32 MiB 的 PNG 图片。');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.getUint32(8) !== 13 || data.getUint32(12) !== 0x49484452)
    sliceError('slice.png', 'PNG 缺少合法的 IHDR。');
  const width = data.getUint32(16), height = data.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096)
    sliceError('slice.png-size', '原图每边须在 1–4096 像素之间。');
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = data.getUint32(offset), type = data.getUint32(offset + 4);
    if (offset + length + 12 > bytes.length) sliceError('slice.png', 'PNG 数据不完整。');
    if ([0x6163544c, 0x6663544c, 0x66644154].includes(type)) sliceError('slice.png', '请使用静态 PNG，不支持 APNG。');
    if (type === 0x65584966) sliceError('slice.png', '请先将图片方向固化为像素，不支持带 EXIF 的 PNG。');
    offset += length + 12;
  }
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  const blob = new Blob([bytes], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'premultiply', colorSpaceConversion: 'default' });
  if (bitmap.width !== width || bitmap.height !== height) {
    bitmap.close();
    sliceError('slice.png-size', '解码尺寸与原图不一致。');
  }
  return { source: { sha256, width, height }, bitmap, blob, dispose: () => bitmap.close() };
}
