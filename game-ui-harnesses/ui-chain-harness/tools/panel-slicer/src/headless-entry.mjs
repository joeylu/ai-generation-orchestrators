import { Application } from 'pixi.js';
import { loadSliceAsset } from './asset.mjs';
import { automaticSliceDocument } from './automatic.mjs';
import { validateSliceDocument, sliceViewOptions } from './document.mjs';
import { SlicedBackground } from './sliced-background.mjs';
import { exportBackgroundPng } from './export.mjs';

// Offline browser adapter only; no editor, registry, skin or preview build.
window.renderPanelPng = async ({ pngBase64, width, height, resolution }) => {
  let asset, app, background, initialized = false;
  try {
    asset = await loadSliceAsset(Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0)));
    const doc = validateSliceDocument({ ...automaticSliceDocument(asset, { width, height }), exportResolution: resolution });
    app = new Application();
    await app.init({ width, height, resolution: 1, preference: 'webgl', backgroundAlpha: 0, antialias: true, autoStart: false });
    initialized = true;
    const options = sliceViewOptions(doc);
    background = new SlicedBackground({ texture: asset.texture(doc.density), ...options });
    const result = await exportBackgroundPng(app.renderer, background, resolution);
    const encoded = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(Error('PNG encoding read failed.')); reader.readAsDataURL(result.blob);
    });
    return { ok: true, pngBase64: encoded, document: doc, width: result.width, height: result.height };
  } catch (e) {
    return { ok: false, code: e.code ?? 'slice.render', message: e.message };
  } finally {
    background?.destroy();
    if (initialized) app.destroy(true, { children: true });
    asset?.dispose();
  }
};
