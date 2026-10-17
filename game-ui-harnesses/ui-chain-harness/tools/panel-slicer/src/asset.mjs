import { ImageSource, Texture } from 'pixi.js';
import schema from '../../../schemas/slice-document.schema.json' with { type: 'json' };
import { loadSlicePng } from './source.mjs';
import { sliceError } from './geometry.mjs';

// One decoded source, shared textures per density. Resizing and editing borders
// must not decode or upload the source again. Dispose views before this owner.
export async function loadSliceAsset(bytes) {
  const decoded = await loadSlicePng(bytes), textures = new Map();
  let disposed = false;
  return {
    source: decoded.source, blob: decoded.blob,
    readPixels() {
      if (disposed) sliceError('slice.asset', '素材已释放。');
      const canvas = document.createElement('canvas');
      canvas.width = decoded.source.width; canvas.height = decoded.source.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(decoded.bitmap, 0, 0);
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    },
    texture(density) {
      const range = schema.properties.density;
      if (disposed || !Number.isInteger(density) || density < range.minimum || density > range.maximum)
        sliceError('slice.asset', '纹理已释放或素材密度无效。');
      if (!textures.has(density)) textures.set(density, new Texture({ source: new ImageSource({ resource: decoded.bitmap, resolution: density, alphaMode: 'premultiplied-alpha' }) }));
      return textures.get(density);
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const texture of textures.values()) texture.destroy(true);
      textures.clear(); decoded.dispose();
    },
  };
}
