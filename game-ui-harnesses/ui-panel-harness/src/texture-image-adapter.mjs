import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/** Optional local Sharp adapter. No downloads, network, or host paths in artifacts. */
export async function loadTextureImageAdapter(modulePath) {
  const require = createRequire(import.meta.url);
  let sharp;
  try { sharp = require(modulePath ? resolve(modulePath) : 'sharp'); }
  catch { throw new Error('IMAGE_ADAPTER_UNAVAILABLE'); }
  if (typeof sharp !== 'function' || !sharp.versions?.sharp) throw new Error('IMAGE_ADAPTER_UNSUPPORTED');
  const limit = 16 * 1024 * 1024;
  return {
    evidence: { name: 'sharp', version: sharp.versions.sharp, vips: sharp.versions.vips, font: 'environment-family-for-preview-labels-only' },
    async analyze(bytes) {
      const meta = await sharp(bytes, { limitInputPixels: limit }).metadata();
      if (meta.format !== 'png' || meta.pages > 1 || !meta.width || !meta.height) throw new Error('TEXTURE_PNG_REQUIRED');
      const { data, info } = await sharp(bytes, { limitInputPixels: limit }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error('TEXTURE_RGBA_REQUIRED');
      let transparentPixels = 0, opaquePixels = 0, softPixels = 0, hiddenRgbPixels = 0;
      let left = info.width, top = info.height, right = -1, bottom = -1;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * 4, alpha = data[offset + 3];
        if (alpha === 0) {
          transparentPixels++;
          if (data[offset] || data[offset + 1] || data[offset + 2]) hiddenRgbPixels++;
        } else {
          if (alpha === 255) opaquePixels++; else softPixels++;
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
      return { width: info.width, height: info.height, channels: 4,
        alpha: { mode: transparentPixels === info.width * info.height ? 'empty' : opaquePixels === info.width * info.height ? 'opaque' : 'mixed',
          transparentPixels, opaquePixels, softPixels, hiddenRgbPixels,
          visibleBounds: right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } } };
    },
    async normalizePng(bytes) {
      const meta = await sharp(bytes, { limitInputPixels: limit }).metadata();
      if (meta.format !== 'png' || meta.pages > 1) throw new Error('TEXTURE_PNG_REQUIRED');
      const { data, info } = await sharp(bytes, { limitInputPixels: limit }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error('TEXTURE_RGBA_REQUIRED');
      for (let offset = 0; offset < data.length; offset += 4) if (data[offset + 3] === 0) data.fill(0, offset, offset + 3);
      return sharp(data, { raw: info }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    },
    async render(svg, width, height) {
      if (typeof svg !== 'string' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || width < 1 || height < 1 || width * height > limit) throw new Error('SVG_RENDER_INPUT');
      // Only our vector renderers supply SVG. Never fetch an external image or font.
      const inspected = svg.replace(/url\(#[A-Za-z][A-Za-z0-9_-]*\)/g, '');
      if (/<!DOCTYPE|<!ENTITY|<script|<foreignObject|(?:href|src)\s*=|\burl\s*\(/i.test(inspected)) throw new Error('SVG_EXTERNAL_CONTENT');
      const { data, info } = await sharp(Buffer.from(svg), { limitInputPixels: limit }).resize(width, height).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error('SVG_RGBA_REQUIRED');
      // These are newly rendered assets. Preserve fractional alpha, normalize only invisible RGB.
      for (let offset = 0; offset < data.length; offset += 4) if (data[offset + 3] === 0) data.fill(0, offset, offset + 3);
      return sharp(data, { raw: info }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    },
    async gallery(items, { columns = 6, cellWidth = 220, cellHeight = 184, labels = true } = {}) {
      const width = columns * cellWidth, height = Math.ceil(items.length / columns) * cellHeight;
      const layers = [];
      for (const [index, item] of items.entries()) {
        const x = index % columns * cellWidth, y = Math.floor(index / columns) * cellHeight;
        const thumb = await sharp(item.bytes).resize(144, 132, { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
        const size = await sharp(thumb).metadata();
        layers.push({ input: thumb, left: x + Math.floor((cellWidth - size.width) / 2), top: y + 8 + Math.floor((132 - size.height) / 2) });
        if (!labels) continue;
        const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
        const label = `<svg width="${cellWidth}" height="40" xmlns="http://www.w3.org/2000/svg"><text x="8" y="14" font-family="sans-serif" font-size="11" fill="#dce6f0">${escape(item.label.slice(0, 34))}</text><text x="8" y="29" font-family="sans-serif" font-size="11" fill="#91a4bc">${escape(item.label.slice(34, 68))}</text></svg>`;
        layers.push({ input: Buffer.from(label), left: x, top: y + 145 });
      }
      return sharp({ create: { width, height, channels: 4, background: '#17212f' } }).composite(layers).png().toBuffer();
    },
  };
}
