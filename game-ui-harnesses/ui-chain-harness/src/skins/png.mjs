// Deliberately bounded PNG interchange: 8-bit RGB/RGBA, non-interlaced, sRGB.
// No segmentation, resampling, color-key removal or inferred geometry.
import { deflateSync, inflateSync } from 'node:zlib';
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bad(message) { throw Object.assign(new Error(message), { code: 'skin.png' }); }
function chunk(type, bytes) {
  const name = Buffer.from(type), out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length); name.copy(out, 4); bytes.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, bytes])), out.length - 4);
  return out;
}
export function encodePng({ width, height, pixels }) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 4096) || pixels.length !== width * height * 4) bad('Invalid RGBA dimensions.');
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function decodePng(input) {
  const b = Buffer.from(input);
  if (b.length > 32 * 1024 * 1024 || !b.subarray(0, 8).equals(signature)) bad('Expected PNG, at most 32 MiB.');
  let at = 8, header, ended = false, seenData = false, dataEnded = false;
  const data = [];
  while (at < b.length) {
    if (at + 12 > b.length) bad('Truncated PNG chunk.');
    const n = b.readUInt32BE(at), name = b.toString('ascii', at + 4, at + 8), end = at + 12 + n;
    if (end > b.length || crc32(b.subarray(at + 4, end - 4)) !== b.readUInt32BE(end - 4)) bad('PNG CRC or chunk length mismatch.');
    const part = b.subarray(at + 8, end - 4);
    if (!header && name !== 'IHDR') bad('IHDR must be first.');
    if (name === 'IHDR') {
      if (header || n !== 13) bad('Invalid IHDR.');
      header = { width: part.readUInt32BE(0), height: part.readUInt32BE(4), channels: part[9] === 6 ? 4 : 3 };
      if (![header.width, header.height].every(x => x > 0 && x <= 4096) || part[8] !== 8 || ![2, 6].includes(part[9]) || part[10] || part[11] || part[12]) bad('Only 8-bit non-interlaced RGB/RGBA up to 4096 per side is supported.');
    } else if (name === 'IDAT') {
      if (dataEnded) bad('Non-contiguous IDAT.');
      seenData = true; data.push(part);
    } else if (name === 'IEND') {
      if (n || !seenData || end !== b.length) bad('Invalid IEND or trailing bytes.');
      ended = true; break;
    } else {
      if (seenData) dataEnded = true;
      if (['acTL','fcTL','fdAT','iCCP','tRNS'].includes(name)) bad('Animated PNG, ICC profiles and tRNS are unsupported; supply normalized RGBA sRGB.');
      if (name === 'gAMA' && (n !== 4 || part.readUInt32BE() !== 45455)) bad('Unsupported PNG gamma.');
      if (name === 'sRGB' && (n !== 1 || part[0] > 3)) bad('Invalid sRGB chunk.');
      if (name[0] === name[0].toUpperCase() && name !== 'PLTE') bad('Unknown critical PNG chunk.');
    }
    at = end;
  }
  if (!ended) bad('Incomplete PNG.');
  const { width, height, channels } = header, stride = width * channels, length = (stride + 1) * height;
  let raw;
  try { raw = inflateSync(Buffer.concat(data), { maxOutputLength: length }); } catch { bad('Invalid or oversized PNG stream.'); }
  if (raw.length !== length) bad('PNG decompressed size mismatch.');
  const bytes = Buffer.alloc(stride * height), pixels = Buffer.alloc(width * height * 4);
  const paeth = (a, c, d) => { const p = a + c - d, x = Math.abs(p-a), y = Math.abs(p-c), z = Math.abs(p-d); return x <= y && x <= z ? a : y <= z ? c : d; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) bad('Invalid PNG filter.');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= channels ? bytes[i-channels] : 0, c = y ? bytes[i-stride] : 0, d = y && x >= channels ? bytes[i-stride-channels] : 0;
      bytes[i] = (raw[y * (stride+1) + 1 + x] + [0,a,c,Math.floor((a+c)/2),paeth(a,c,d)][filter]) & 255;
    }
  }
  let transparentRgbPixels=0;
  for (let i = 0; i < width * height; i++) {
    const alpha = channels === 4 ? bytes[i*4+3] : 255;
    pixels[i*4+3] = alpha;
    if (!alpha && (bytes[i*channels] || bytes[i*channels+1] || bytes[i*channels+2])) transparentRgbPixels++;
    if (alpha) for (let k = 0; k < 3; k++) pixels[i*4+k] = bytes[i*channels+k];
  }
  return { width, height, pixels, transparentRgbPixels };
}
export {cropPng} from './raster.mjs';
