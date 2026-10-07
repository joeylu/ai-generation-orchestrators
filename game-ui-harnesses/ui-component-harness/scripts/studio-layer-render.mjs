/** Local headless Pixi check for the correction loop. All nonlocal/API requests are blocked. */
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { checkLayerUiInteractions } from './layer-ui-interaction-check.mjs';
export async function checkLayerPlanRender(bundle, { origin, folder, signal, launchBrowser } = {}) {
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin ?? '')) throw new Error('LAYER_RENDER_ORIGIN_INVALID');
  signal?.throwIfAborted();
  let browser, page, disconnected = false, timedOut = false;
  const abort = () => { disconnected = true; void browser?.close(); };
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; void browser?.close(); }, 45000);
  try {
    const launch = launchBrowser ?? (async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    });
    browser = await launch(); signal?.throwIfAborted(); if (timedOut) throw new Error('LAYER_RENDER_TIMEOUT');
    page = await browser.newPage({ viewport: { width: Math.min(4096, bundle.document.canvas.width), height: Math.min(4096, bundle.document.canvas.height) } });
    page.setDefaultTimeout(30000);
    let forbiddenRequests = 0; const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/') && !new URL(url).pathname.startsWith('/api/')) return route.continue();
      if (url.startsWith('blob:' + origin + '/')) return route.continue();
      forbiddenRequests++; return route.abort();
    });
    await page.goto(origin + '/layer-plan-check.html', { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.layerPlanCheck));
    const result = await page.evaluate(value => window.layerPlanCheck.check(value), bundle);
    if (result.status === 'pass') {
      try { result.interactions = await checkLayerUiInteractions(page, bundle); }
      catch (error) {
        if (!/^UI_INTERACTION_[A-Z_]+(?:: [A-Za-z0-9._-]+)?$/.test(error.message)) throw error;
        result.status = 'repairable'; result.code = 'LAYER_PLAN_UI_INTERACTION_FAILED';
        result.issues = [{ code: error.message, path: '/document', message: 'Declared UI interaction did not produce its required state through actual pointer input.' }];
      }
    }
    if (forbiddenRequests || errors.length) throw new Error('LAYER_RENDER_FAILED');
    const canvas = page.locator('#check-canvas canvas');
    if (await canvas.count()) await canvas.screenshot({ path: join(folder, 'render.png') });
    return { ...result, forbiddenRequests, errors };
  } catch (error) {
    if (folder) await writeFile(join(folder, 'render-failure.json'), JSON.stringify({
      kind: 'local-render-failure-diagnostic', message: String(error.message).slice(0, 2000),
      stack: String(error.stack).slice(0, 6000), timedOut, disconnected,
    }, null, 2) + '\n', { flag: 'wx' }).catch(() => {});
    throw new Error(signal?.aborted || disconnected ? 'SESSION_ABORTED_NO_RETRY' : timedOut ? 'LAYER_RENDER_TIMEOUT' : 'LAYER_RENDER_FAILED', { cause: error });
  } finally {
    signal?.removeEventListener('abort', abort);
    clearTimeout(timeout);
    await browser?.close().catch(() => {});
  }
}
