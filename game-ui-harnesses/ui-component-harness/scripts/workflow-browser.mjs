/** Optional local PixiJS acceptance adapter. Never imported by the neutral library. */
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';

function assert(condition, message) { if (!condition) throw new Error(message); }
const same = (actual, expected, label) => assert(isDeepStrictEqual(actual, expected), `${label} mismatch`);
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

async function idle(page) {
  await page.waitForFunction(() => {
    const state = window.uiHarness.inspectMotionSystem();
    return !state || (state.scheduler.running === 0 && !state.scheduler.pendingFrame);
  }, undefined, { polling: 50, timeout: 10000 });
}
async function pixelHash(page, bytes) {
  return page.evaluate(async base64 => {
    const raw = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
    try {
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Screenshot pixel decoding unavailable');
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    } finally { bitmap.close(); }
  }, bytes.toString('base64'));
}
async function targetGeometry(page, id) {
  const state = await page.evaluate(id => {
    const api = window.uiHarness;
    return { node: api.inspect().nodes.find(node => node.id === id), canvas: api.getDocument().canvas };
  }, id);
  assert(state.node?.visible, 'Browser check target must be visible');
  await page.evaluate(bounds => {
    const area = document.querySelector('.canvas-area');
    area.scrollTop = Math.max(0, bounds.y + bounds.height / 2 - area.clientHeight / 2);
    area.scrollLeft = Math.max(0, bounds.x + bounds.width / 2 - area.clientWidth / 2);
  }, state.node.bounds);
  const canvas = page.locator('#canvas-host canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert(box && box.width > 0 && box.height > 0, 'Canvas must be rendered');
  const bounds = state.node.bounds;
  const x = box.x + bounds.x * box.width / state.canvas.width, y = box.y + bounds.y * box.height / state.canvas.height;
  const width = bounds.width * box.width / state.canvas.width, height = bounds.height * box.height / state.canvas.height;
  const viewport = page.viewportSize();
  const clip = { x: Math.max(0, x), y: Math.max(0, y),
    width: Math.min(viewport.width, x + width) - Math.max(0, x),
    height: Math.min(viewport.height, y + height) - Math.max(0, y) };
  assert(clip.width >= 1 && clip.height >= 1, 'Target must intersect the viewport');
  return { x, y, width, height, clip };
}
async function runCheck(page, check, index, screenshot) {
  const geometry = check.kind === 'timeline' ? null : await targetGeometry(page, check.targetId);
  const before = await screenshot(`check-${String(index + 1).padStart(3, '0')}-before.png`, geometry?.clip);
  let observations;
  if (check.kind === 'motion') {
    observations = await bounded(page.evaluate(async check => {
      const api = window.uiHarness, nodes = [];
      const find = node => {
        if (node.id === check.targetId) {
          const collect = item => { nodes.push(item.id); for (const child of item.children ?? []) collect(child); };
          collect(node);
        } else for (const child of node.children ?? []) find(child);
      };
      find(api.getDocument().root);
      const snapshot = () => api.inspectMotionSystem();
      const values = () => JSON.stringify(snapshot().nodes.filter(node => nodes.includes(node.id)).map(node => node.presentation));
      const baseline = values();
      api.playMotionAction(check.targetId, check.action);
      const started = snapshot().scheduler.running > 0;
      let changed = baseline !== values(), frames = 0;
      const start = performance.now();
      while (snapshot().scheduler.running || snapshot().scheduler.pendingFrame) {
        if (performance.now() - start > 10000) throw new Error('Motion scheduler did not settle');
        await new Promise(resolve => requestAnimationFrame(resolve)); frames++;
        changed ||= values() !== baseline;
      }
      return { started, changed, frames, settled: !snapshot().scheduler.pendingFrame };
    }, check), 12000, 'Motion observation');
    assert(observations.started && observations.changed && observations.settled, 'Motion must start, change presentation and settle');
  } else if (check.kind === 'timeline') {
    observations = await page.evaluate(time => {
      const api = window.uiHarness; api.seekMotion(time); return api.motionSnapshot();
    }, check.time);
    assert(observations?.time === check.time && !observations.running && !observations.destroyed, 'Timeline seek did not reach requested position');
  } else {
    const beforeActivations = await page.evaluate(() => window.uiHarness.activates());
    const beforeTargetActivations = await page.evaluate(id => window.uiHarness.activationCount(id), check.targetId);
    const x = geometry.x + geometry.width * (check.xRatio ?? 0.5);
    const y = geometry.y + geometry.height * (check.yRatio ?? 0.5);
    const viewport = page.viewportSize();
    assert(x >= 0 && y >= 0 && x < viewport.width && y < viewport.height, 'Click point must be in viewport');
    await page.mouse.click(x, y);
    await idle(page);
    observations = await page.evaluate(id => ({ activations: window.uiHarness.activates(), targetActivations: window.uiHarness.activationCount(id),
      value: window.uiHarness.inspect().nodes.find(node => node.id === id)?.value }), check.targetId);
    observations.activations -= beforeActivations;
    observations.targetActivations -= beforeTargetActivations;
    if (Object.hasOwn(check, 'expectActivations')) {
      same(observations.activations, check.expectActivations, 'Activation count');
      same(observations.targetActivations, check.expectActivations, 'Target activation count');
    }
    if (Object.hasOwn(check, 'expectValue')) same(observations.value, check.expectValue, 'Committed value');
  }
  const after = await screenshot(`check-${String(index + 1).padStart(3, '0')}-after.png`, geometry?.clip);
  const pixelsChanged = before !== after;
  if (check.verifyPixels) assert(pixelsChanged, 'Required rendered pixel change was not observed');
  return { index, ...check, status: 'PASS', observations, pixelsChanged, pixelGate: check.verifyPixels === true };
}
export async function acceptInBrowser({ url, browserChannel, bundle, checks, directory, onCheck, onStage }) {
  // The root is the user-facing studio. Deterministic acceptance uses the
  // separate workbench and keeps the public loopback URL invocation compatible.
  const workbench = new URL(url);
  if (workbench.pathname.endsWith('/') || workbench.pathname.endsWith('/index.html'))
    url = new URL('workbench.html', workbench).href;
  let chromium;
  try { ({ chromium } = await import('@playwright/test')); }
  catch { throw new Error('Browser acceptance requires locally installed @playwright/test and a browser; no dependency or browser is installed automatically'); }
  const origin = new URL(url).origin;
  let browser, context, page;
  const problems = [], screenshots = [];
  const pass = name => onStage({ name, status: 'PASS' });
  const healthy = async () => {
    assert(problems.length === 0, problems[0] ?? 'Browser request failure');
    assert(await page.locator('#error').isHidden(), 'Workbench reported an error');
  };
  const attachErrors = target => {
    target.on('pageerror', () => problems.push('Uncaught browser error'));
    target.on('console', entry => { if (entry.type() === 'error') problems.push('Browser console error'); });
    target.on('requestfailed', () => problems.push('Browser resource request failed'));
    target.on('response', response => { if (response.status() >= 400) problems.push(`Browser resource HTTP ${response.status()}`); });
  };
  const importOriginal = async () => {
    await page.mouse.move(0, 0);
    await bounded(page.evaluate(input => window.uiHarness.importBundle(input), bundle), 20000, 'Bundle import');
    await idle(page); await healthy();
    const restored = await page.evaluate(() => window.uiHarness.exportBundle());
    same(restored, bundle, 'Bundle round trip');
    same(await page.evaluate(() => window.uiHarness.getMotionSystem()), bundle.motionSystem ?? null, 'Motion system attachment');
    const snapshot = await page.evaluate(() => window.uiHarness.motionSnapshot() ?? null);
    assert(Boolean(snapshot) === Boolean(bundle.motion), 'Timeline attachment mismatch');
    return restored;
  };
  const open = async () => {
    page = await context.newPage(); attachErrors(page);
    page.setDefaultTimeout(15000);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForFunction(() => Boolean(window.uiHarness));
    const adapter = await page.evaluate(() => window.uiHarness.workflowAdapter);
    assert(adapter?.version === '0.1' && adapter.engine === 'pixi.js' && typeof adapter.engineVersion === 'string',
      'Workbench is missing the compatible workflow adapter; rebuild and start the matching preview');
    await healthy(); return adapter;
  };
  const screenshot = async (name, clip) => {
    const options = { path: resolve(directory, name), animations: 'allow' };
    // A fixed crop compares the same region even when its content moves or exits.
    const bytes = clip ? await page.screenshot({ ...options, clip }) : await page.locator('#canvas-host canvas').screenshot(options);
    screenshots.push(name); return pixelHash(page, bytes);
  };
  const teardown = async () => {
    await page.evaluate(() => window.uiHarness.clear());
    const state = await page.evaluate(() => ({ ...window.uiHarness.inspect(), system: window.uiHarness.inspectMotionSystem(),
      timeline: window.uiHarness.motionSnapshot() ?? null, importedResources: window.uiHarness.resourcePaths().length }));
    assert(state.instances === 0 && state.externalListeners === 0 && state.resources === 0 && state.nodes.length === 0
      && state.system === null && state.timeline === null && state.importedResources === 0, 'Browser teardown retained runtime state or imported resources');
    await healthy();
  };
  try {
    browser = await chromium.launch({ headless: true, ...(browserChannel === 'chromium' ? {} : { channel: browserChannel }),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      if (['data:', 'blob:'].includes(target.protocol) || target.origin === origin) return route.continue();
      problems.push('Blocked nonlocal browser request'); return route.abort();
    });
    const adapter = await open();
    pass('browser-adapter-ready');
    await importOriginal();
    await screenshot('initial.png');
    pass('pixijs-mount-and-resource-decode');
    for (const [index, check] of checks.entries()) {
      try {
        await importOriginal();
        const result = await runCheck(page, check, index, screenshot);
        await healthy(); onCheck(result);
      } catch (error) {
        onCheck({ index, ...check, status: 'FAIL' }); throw error;
      }
    }
    pass('declared-browser-checks');
    await teardown(); await page.close();
    await open();
    const restored = await importOriginal();
    await screenshot('restored.png');
    pass('fresh-page-bundle-restoration');
    await teardown(); pass('runtime-teardown');
    return { browser: { channel: browserChannel, browserVersion: browser.version(), adapterVersion: adapter.version,
      engine: adapter.engine, engineVersion: adapter.engineVersion }, restored, screenshots };
  } finally {
    // Closing the context also tears down a failed import/check. No browser remains running.
    try { await context?.close(); } finally { await browser?.close(); }
  }
}
