import { compilePanel } from './compiler.mjs';
import { validateDocument } from './document.mjs';

// Loading happens before a candidate touches the visible canvas. Failed
// candidates release their own leases and retain the previous live scene.
export async function preparePanel(input, ctx, { app, skin, pool, onEvent }) {
  const doc = validateDocument(input, ctx);
  const lease = await pool.acquire(doc.panelBackgrounds);
  const previousSize = { width: app.screen.width, height: app.screen.height };
  const next = ctx.canvases.presets[doc.canvas];
  try {
    app.renderer.resize(next.width, next.height);
    const scene = compilePanel(doc, ctx, { app, skin, panelBackgrounds: lease.backgrounds, onEvent });
    let disposed = false;
    return { ...scene, dispose() {
      if (disposed) return; disposed = true;
      scene.dispose(); lease.release();
    } };
  } catch (e) {
    lease.release(); app.renderer.resize(previousSize.width, previousSize.height);
    app.render(); throw e;
  }
}
