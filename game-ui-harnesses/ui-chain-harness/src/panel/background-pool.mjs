import { loadSliceAsset } from '../slicing/asset.mjs';
import { backgroundGeometry, decodePng, validateBackgroundAsset } from '../slicing/package.mjs';
import { sliceError } from '../slicing/geometry.mjs';

// A lease lives exactly as long as one prepared scene. Candidate + current
// scenes may share a source; release only after their views are destroyed.
export function createBackgroundPool() {
  const entries = new Map();
  return {
    async acquire(assets = {}) {
      const held = [], backgrounds = new Map();
      let released = false;
      const release = () => {
        if (released) return; released = true;
        for (const entry of held) if (--entry.users === 0) {
          entries.delete(entry.key); entry.asset.dispose();
        }
      };
      try {
        for (const [id, spec] of Object.entries(assets)) {
          validateBackgroundAsset(spec);
          const key = spec.source.sha256;
          let entry = entries.get(key);
          if (entry && (entry.encoded !== spec.pngBase64 || ['width', 'height'].some(k => entry.asset.source[k] !== spec.source[k])))
            sliceError('background.source', '相同摘要的背景原图或尺寸不一致。');
          if (!entry) {
            const asset = await loadSliceAsset(decodePng(spec.pngBase64));
            if (['sha256', 'width', 'height'].some(k => asset.source[k] !== spec.source[k])) {
              asset.dispose(); sliceError('background.source', '背景原图与保存的摘要或尺寸不符。');
            }
            entry = { key, asset, encoded: spec.pngBase64, users: 0 }; entries.set(key, entry);
          }
          entry.users++; held.push(entry);
          backgrounds.set(id, { texture: entry.asset.texture(spec.density), borders: backgroundGeometry(spec).borders, resizePolicy: spec.resizePolicy });
        }
        return { backgrounds, release };
      } catch (e) { release(); throw e; }
    },
  };
}
