import { deflateSync, inflateSync } from 'node:zlib';

const MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), output.length - 4);
  return output;
}

// Only used to materialize synthetic fixtures; never edits user/provider artwork.
export function encodeFixturePng(width, height, rgba) {
  return encodeRgbaPng(width, height, rgba);
}

// Explicit deterministic raster output; generated source bytes remain separate.
export function encodeRgbaPng(width, height, rgba) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('Invalid raster dimensions');
  if (rgba.length !== width * height * 4) throw new Error('Invalid synthetic RGBA length');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([MAGIC, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function inspectPng(bytes, { pixelStats = false, allowCabx = false, includePixels = false, allowHiddenRgb = false } = {}) {
  const fail = () => { throw new Error('Invalid or unsupported PNG (required: non-interlaced 8-bit RGB/RGBA, at most 4096 per edge)'); };
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(MAGIC)) fail();
  let width, height, channels, ended = false, idatStarted = false, idatEnded = false, cabxSeen = false;
  const blocks = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) fail();
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) fail();
    const name = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail();
    if (offset === 8 && name !== 'IHDR') fail();
    if (name === 'IHDR') {
      if (width !== undefined || length !== 13) fail();
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (!width || !height || width > 4096 || height > 4096 || data[8] !== 8
        || ![2, 6].includes(data[9]) || data[10] || data[11] || data[12]) fail();
      channels = data[9] === 6 ? 4 : 3;
    } else if (name === 'IDAT') {
      if (idatEnded) fail();
      idatStarted = true; blocks.push(data);
    } else if (name === 'IEND') {
      if (length || !idatStarted || end !== bytes.length) fail();
      ended = true;
    } else if (name === 'caBX' && allowCabx) {
      // Opaque ancillary metadata: validate CRC/placement/bounds, never execute,
      // parse provenance claims, alter bytes or infer content authenticity.
      if (cabxSeen || idatStarted || !length || length > 262144) fail();
      cabxSeen = true;
    } else {
      if (idatStarted) idatEnded = true;
      // Transparency/color metadata and unknown critical chunks need a future explicit profile.
      if (!['tEXt', 'iTXt', 'zTXt'].includes(name)) fail();
    }
    offset = end;
  }
  if (!ended) fail();
  const stride = width * channels, expected = (stride + 1) * height;
  let raw;
  try { raw = inflateSync(Buffer.concat(blocks), { maxOutputLength: expected }); } catch { fail(); }
  if (raw.length !== expected) fail();
  const decoded = Buffer.alloc(width * height * channels);
  let transparentPixels = 0, nonzeroAlphaPixels = 0, hiddenRgbPixels = 0, firstPixel, varied = false;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) fail();
    for (let x = 0; x < stride; x++) {
      const pos = y * stride + x;
      const left = x >= channels ? decoded[pos - channels] : 0;
      const up = y ? decoded[pos - stride] : 0;
      const upperLeft = y && x >= channels ? decoded[pos - stride - channels] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)][filter];
      decoded[pos] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const pos = (y * width + x) * channels;
      const alpha = channels === 4 ? decoded[pos + 3] : 255;
      if (alpha) nonzeroAlphaPixels++;
      else if (decoded[pos] || decoded[pos + 1] || decoded[pos + 2]) {
        if (!allowHiddenRgb) throw new Error('Zero-alpha RGB must be zero');
        hiddenRgbPixels++;
      }
      if (alpha < 255) transparentPixels++;
      if (pixelStats) {
        const pixel = allowHiddenRgb && !alpha ? 0 : ((decoded[pos] << 24) | (decoded[pos + 1] << 16) | (decoded[pos + 2] << 8) | alpha) >>> 0;
        if (firstPixel === undefined) firstPixel = pixel;
        else if (pixel !== firstPixel) varied = true;
      }
    }
  }
  const result = { width, height, transparentPixels, nonzeroAlphaPixels, channels, ...(pixelStats ? { varied } : {}),
    ...(allowHiddenRgb ? { hiddenRgbPixels } : {}) };
  if (includePixels) {
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      decoded.copy(rgba, i * 4, i * channels, i * channels + 3);
      rgba[i * 4 + 3] = channels === 4 ? decoded[i * 4 + 3] : 255;
    }
    result.rgba = rgba;
  }
  return result;
}
