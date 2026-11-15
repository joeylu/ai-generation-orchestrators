import { deflateSync, inflateSync } from 'node:zlib';
import { requireThat } from './common.mjs';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n >>> 1 ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc >>> 8 ^ TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}
export function encodePng({ width, height, rgba }) {
  requireThat(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width <= 4096 && height <= 4096 && rgba.length === width * height * 4, 'PNG_SIZE');
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const paeth = (a, b, c) => {
  const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
};
// Bounded PNG decoding, no external processes, metadata retention or network.
export function decodePng(input) {
  const bytes = Buffer.from(input);
  requireThat(bytes.length <= 64 * 1024 * 1024 && bytes.subarray(0, 8).equals(SIGNATURE), 'PNG_SIGNATURE');
  let offset = 8, header, palette, transparency, ended = false, idatEnded = false;
  const parts = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), end = offset + 12 + size;
    requireThat(end <= bytes.length, 'PNG_TRUNCATED');
    const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
    requireThat(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'PNG_CRC');
    requireThat(header || type === 'IHDR', 'PNG_HEADER_ORDER');
    if (type === 'IHDR') { requireThat(!header && size === 13, 'PNG_HEADER'); header = data; }
    else if (type === 'PLTE') { requireThat(!palette && !parts.length && size > 0 && size % 3 === 0 && size <= 768, 'PNG_PALETTE'); palette = data; }
    else if (type === 'tRNS') { requireThat(!transparency && !parts.length, 'PNG_TRANSPARENCY'); transparency = data; }
    else if (type === 'IDAT') { requireThat(!idatEnded, 'PNG_IDAT_ORDER'); parts.push(data); }
    else if (type === 'IEND') { requireThat(size === 0 && parts.length > 0, 'PNG_END'); ended = true; offset = end; break; }
    else {
      requireThat(type !== 'acTL' && /^[a-zA-Z]{4}$/.test(type) && type[0] === type[0].toLowerCase(), 'PNG_CHUNK_UNSUPPORTED');
      if (parts.length) idatEnded = true;
    }
    offset = end;
  }
  requireThat(ended && offset === bytes.length, 'PNG_TRAILING_OR_MISSING_END');
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), color = header[9];
  requireThat(width > 0 && height > 0 && width <= 4096 && height <= 4096 && header[8] === 8
    && [0, 2, 3, 4, 6].includes(color) && header[10] === 0 && header[11] === 0 && header[12] === 0, 'PNG_FORMAT_UNSUPPORTED');
  requireThat(color !== 3 || palette, 'PNG_PALETTE_MISSING');
  requireThat(!transparency || (color === 0 && transparency.length === 2)
    || (color === 2 && transparency.length === 6) || (color === 3 && transparency.length <= palette.length / 3), 'PNG_TRANSPARENCY');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color], stride = width * channels, expected = (stride + 1) * height;
  const raw = inflateSync(Buffer.concat(parts), { maxOutputLength: expected });
  requireThat(raw.length === expected, 'PNG_DECODE_SIZE');
  const pixels = Buffer.alloc(stride * height), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; requireThat(filter <= 4, 'PNG_FILTER');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= channels ? pixels[i - channels] : 0;
      const b = y ? pixels[i - stride] : 0, c = y && x >= channels ? pixels[i - stride - channels] : 0;
      const predict = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[i] = (raw[y * (stride + 1) + 1 + x] + predict) & 255;
    }
  }
  for (let i = 0; i < width * height; i++) {
    const p = i * channels, q = i * 4;
    let r, g, b, a = 255;
    if (color === 3) {
      const index = pixels[p]; requireThat(index * 3 + 2 < palette.length, 'PNG_PALETTE_INDEX');
      [r, g, b] = palette.subarray(index * 3, index * 3 + 3); a = transparency?.[index] ?? 255;
    } else if (color === 0 || color === 4) {
      r = g = b = pixels[p]; if (color === 4) a = pixels[p + 1];
      else if (transparency && r === transparency.readUInt16BE(0)) a = 0;
    } else {
      [r, g, b] = pixels.subarray(p, p + 3);
      if (color === 6) a = pixels[p + 3];
      else if (transparency && r === transparency.readUInt16BE(0) && g === transparency.readUInt16BE(2) && b === transparency.readUInt16BE(4)) a = 0;
    }
    rgba[q] = a ? r : 0; rgba[q + 1] = a ? g : 0; rgba[q + 2] = a ? b : 0; rgba[q + 3] = a;
  }
  return { width, height, rgba };
}
export function canvas(width, height, color = '#F4F4F4') {
  const rgba = Buffer.alloc(width * height * 4), rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  for (let p = 0; p < rgba.length; p += 4) rgba.set([...rgb, 255], p);
  return { width, height, rgba };
}
export function rectangle(image, box, color, border = '#555555') {
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const fill = rgb(color), line = rgb(border);
  const [x, y, w, h] = box.map(Math.round);
  for (let j = Math.max(0, y); j < Math.min(image.height, y + h); j++) {
    for (let i = Math.max(0, x); i < Math.min(image.width, x + w); i++)
      image.rgba.set([...(i === x || i === x + w - 1 || j === y || j === y + h - 1 ? line : fill), 255], (j * image.width + i) * 4);
  }
}
