import { expect, test, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

type Bounds = { x: number; y: number; width: number; height: number };
type InspectedNode = { id: string; type: string; bounds: Bounds };
type MotionSystemSnapshot = { scheduler: { running: number; pendingFrame: boolean; destroyed: boolean } };
type TimelineSnapshot = { time: number; running: boolean; destroyed: boolean };
type StudioView = {
  scheme: 'original' | 'playful' | 'premium' | 'corporate';
  document: { canvas: { width: number; height: number }; root: { id: string; type: string } };
  motionSystem: { style: 'playful' | 'premium' | 'corporate'; bindings: unknown[] } | null;
  inspection: { nodes: InspectedNode[]; resources: number };
  motionSnapshot: MotionSystemSnapshot;
  timelineSnapshot?: TimelineSnapshot | null;
  activations: number;
};
type Analysis = { status: 'Idle' | 'Ready' | 'Unresolved' | 'Custom-required'; summary: string };
type StudioSnapshot = {
  ready: boolean;
  busy: boolean;
  scheme: StudioView['scheme'];
  compare: boolean;
  kind: string | null;
  filename: string;
  resourceCount: number;
  analysis: Analysis | null;
  views: StudioView[];
};
type Bundle = {
  bundleVersion: '0.2';
  document: { schemaVersion: '0.2'; root: { id: string; type: string } };
  resources: Array<{ path: string; mime: string; sha256: string; base64: string }>;
  motionSystem: { style: 'playful' | 'premium' | 'corporate' };
  motion?: unknown;
};
type VisionSource = { path: string; sha256: string; width: number; height: number; mime: string; base64: string };
type VisionRequest = { version: '0.1'; source: VisionSource };
type VisionHandler = (route: Route, source: VisionSource) => Promise<void>;

const corruptFixtureUrl = new URL('../../public/fixtures/corrupt.png', import.meta.url);
const plateFixtureUrl = new URL('../../public/fixtures/plate.svg', import.meta.url);
// A local, deterministic 1 × 1 PNG fixture. Browser tests never call a provider.
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl0V6kAAAAASUVORK5CYII=', 'base64');

const style = (overrides: Record<string, unknown> = {}) => ({
  backgroundColor: '#FFFFFF', borderColor: '#C8D5E5', borderWidth: 1,
  cornerRadius: 8, textColor: '#223653', fontFamily: 'sans-serif', fontSize: 16,
  fontWeight: 'normal', opacity: 1, ...overrides,
});

function panelResponse(source: VisionSource, summary = '识别到一个带通知开关的设置面板。') {
  return {
    version: '0.1', sourceSha256: source.sha256, status: 'Ready', summary,
    intent: {
      intentVersion: '0.2', id: 'vision-settings-panel', root: {
        id: 'settings-panel', componentType: 'Panel', props: { title: '通知设置', style: style() }, children: [
          { id: 'source-art', componentType: 'Image', props: { source: source.path, fit: 'contain', style: style({ borderWidth: 0 }) } },
          { id: 'alerts-switch', componentType: 'Switch', props: { label: '接收提醒', checked: true, enabled: true, style: style() } },
        ],
      },
    },
    policy: {
      canvas: { width: 640, height: 360 },
      layout: {
        'settings-panel': { x: 28, y: 24, width: 584, height: 312 },
        'source-art': { x: 28, y: 62, width: 200, height: 200 },
        'alerts-switch': { x: 258, y: 142, width: 270, height: 52 },
      },
      layoutSource: { kind: 'explicit', description: 'The reviewed vision response supplied all component bounds.' },
    },
  };
}

async function snapshot(page: Page): Promise<StudioSnapshot> {
  return page.evaluate(() => (window as any).uiStudio.snapshot());
}

async function ready(page: Page, handler: VisionHandler = async (route, source) => {
  await route.fulfill({ json: panelResponse(source) });
}): Promise<void> {
  let source: VisionSource | undefined;
  await page.route('**/api/ui-vision**', async route => {
    if (route.request().method() === 'POST') source = (route.request().postDataJSON() as VisionRequest).source;
    if (!source) throw new Error('vision poll arrived before its POST source');
    await handler(route, source);
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).uiStudio?.snapshot));
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
}

async function uploadReference(page: Page, name = 'settings.png', bytes = pngBytes): Promise<Buffer> {
  await page.locator('#reference-file').setInputFiles({ name, mimeType: 'image/png', buffer: bytes });
  await expect.poll(async () => (await snapshot(page)).filename).toBe(name);
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  await expect.poll(async () => (await snapshot(page)).analysis?.status).toBe('Ready');
  await expect.poll(async () => (await snapshot(page)).ready).toBe(true);
  return bytes;
}

function selectedView(current: StudioSnapshot): StudioView {
  const view = current.views.find(item => item.scheme === current.scheme);
  if (!view) throw new Error(`missing selected ${current.scheme} preview`);
  return view;
}

function nodeFor(view: StudioView, type: string): InspectedNode {
  const result = view.inspection.nodes.find(item => item.type === type);
  if (!result) throw new Error(`missing rendered ${type}`);
  return result;
}

async function nodePoint(page: Page, selector: string, view: StudioView, node: InspectedNode): Promise<{ x: number; y: number }> {
  const canvas = page.locator(`${selector} canvas`);
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`missing canvas in ${selector}`);
  return {
    x: box.x + (node.bounds.x + node.bounds.width / 2) * box.width / view.document.canvas.width,
    y: box.y + (node.bounds.y + node.bounds.height / 2) * box.height / view.document.canvas.height,
  };
}

async function previewPixels(page: Page, selector: string): Promise<Buffer> {
  return page.locator(`${selector} canvas`).screenshot();
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertNoPreview(current: StudioSnapshot, resourceCount = 0): void {
  expect(current).toMatchObject({ ready: false, kind: null, resourceCount, views: [] });
}

test('the consumer studio begins empty without exposing a manual component mode', async ({ page }) => {
  await ready(page);

  const current = await snapshot(page);
  expect(current).toMatchObject({ ready: false, busy: false, scheme: 'original', compare: false, kind: null, filename: '', resourceCount: 0, analysis: { status: 'Idle', summary: '' }, views: [] });
  await expect(page.locator('#reference-preview')).toBeHidden();
  await expect(page.locator('#studio-export')).toBeDisabled();
  await expect(page.locator('#preview-kind, [data-preview-kind], #intent-editor, #scenario, #canvas-host')).toHaveCount(0);
});

test('a PNG is sent to the semantic endpoint and its ready Panel/Switch result compiles without a manual choice', async ({ page }) => {
  const requests: VisionSource[] = [];
  await ready(page, async (route, source) => {
    requests.push(source);
    await route.fulfill({ json: panelResponse(source, '识别为通知设置面板，其中包含一个开关。') });
  });
  const original = await uploadReference(page, 'notifications.png');

  expect(requests).toHaveLength(1);
  const [source] = requests;
  expect(source).toMatchObject({
    path: `assets/${sha256(original)}.png`, sha256: sha256(original), width: 1, height: 1,
    mime: 'image/png', base64: original.toString('base64'),
  });
  const current = await snapshot(page);
  expect(current.kind).toBe('Panel');
  expect(current.filename).toBe('notifications.png');
  expect(current.resourceCount).toBe(1);
  expect(current.analysis).toEqual({ status: 'Ready', summary: '识别为通知设置面板，其中包含一个开关。' });
  expect(current.views).toHaveLength(1);
  const view = selectedView(current);
  expect(view.document.root.type).toBe('Panel');
  expect(view.inspection.resources).toBe(1);
  expect(view.inspection.nodes.map(node => node.type)).toEqual(expect.arrayContaining(['Panel', 'Image', 'Switch']));
  await expect(page.locator('#analysis-state')).toBeVisible();
  await expect(page.locator('#analysis-summary')).toHaveText('识别为通知设置面板，其中包含一个开关。');
  await expect(page.locator('#reference-preview')).toBeVisible();
  await expect(page.locator('#reference-image')).toBeVisible();
  await expect(page.locator('#reference-name')).toHaveText('notifications.png');
  await expect(page.locator('#preview-kind, [data-preview-kind]')).toHaveCount(0);
});

test('comparison keeps four independently mounted semantic previews and exports exact uploaded bytes', async ({ page }) => {
  await ready(page);
  const original = await uploadReference(page);
  await page.locator('#scheme-options [data-scheme="corporate"]').click();
  await expect.poll(async () => (await snapshot(page)).scheme).toBe('corporate');
  await page.locator('#studio-compare').click();
  await expect(page.locator('#studio-compare')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#comparison-grid .comparison-card')).toHaveCount(4);
  await expect(page.locator('#comparison-grid .comparison-card .preview-host canvas')).toHaveCount(4);
  const schemes = await page.locator('#comparison-grid .comparison-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-scheme')));
  expect(schemes).toEqual(['original', 'playful', 'premium', 'corporate']);

  const current = await snapshot(page);
  expect(current.compare).toBe(true);
  expect(current.views).toHaveLength(4);
  for (const view of current.views) {
    expect(view.document.root.type).toBe('Panel');
    expect(view.inspection.nodes.map(node => node.type)).toContain('Switch');
    if (view.scheme === 'original') expect(view.motionSystem).toBeNull();
    else expect(view.motionSystem?.style).toBe(view.scheme);
  }

  const originalBefore = await previewPixels(page, '#comparison-grid .comparison-card[data-scheme="original"] .preview-host');
  const corporate = current.views.find(view => view.scheme === 'corporate');
  if (!corporate) throw new Error('missing corporate comparison view');
  const point = await nodePoint(page, '#comparison-grid .comparison-card[data-scheme="corporate"] .preview-host', corporate, nodeFor(corporate, 'Switch'));
  await page.mouse.click(point.x, point.y);
  expect((await previewPixels(page, '#comparison-grid .comparison-card[data-scheme="original"] .preview-host')).equals(originalBefore)).toBe(true);

  const direct = await page.evaluate(() => (window as any).uiStudio.exportSelected()) as Bundle;
  expect(direct.motionSystem.style).toBe('corporate');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#studio-export').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.ui-bundle\.json$/);
  const file = await download.path();
  if (!file) throw new Error('download has no local path');
  const exported = JSON.parse(await readFile(file, 'utf8')) as Bundle;
  expect(exported.motionSystem.style).toBe('corporate');
  expect(exported.document.root.type).toBe('Panel');
  expect(exported.resources).toHaveLength(1);
  const resource = exported.resources[0];
  expect(Buffer.from(resource.base64, 'base64').equals(original)).toBe(true);
  expect(resource.sha256).toBe(sha256(original));
});

test('an imported v0.2 bundle preserves its timeline and motion system, then reset clears the session', async ({ page }) => {
  await ready(page);
  await uploadReference(page);
  await page.locator('#scheme-options [data-scheme="playful"]').click();
  await expect.poll(async () => (await snapshot(page)).scheme).toBe('playful');
  const bundle = await page.evaluate(() => (window as any).uiStudio.exportSelected()) as Bundle;
  const imported = structuredClone(bundle);
  imported.motion = {
    motionVersion: '0.1', id: 'imported-studio-timeline', scope: 'canvas', duration: 1000, trigger: { type: 'manual' },
    tracks: [{ targetId: imported.document.root.id, property: 'alpha', start: 0, duration: 1000, from: 0.5, to: 1, easing: 'linear' }],
  };

  await page.locator('#studio-reset').click();
  await page.locator('#open-bundle').setInputFiles({ name: 'saved.ui-bundle.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect.poll(async () => (await snapshot(page)).ready).toBe(true);
  await expect.poll(async () => (await snapshot(page)).filename).toBe('saved.ui-bundle.json');
  const restored = await snapshot(page);
  expect(restored.scheme).toBe('playful');
  expect(restored.kind).toBe('Panel');
  expect(restored.filename).toBe('saved.ui-bundle.json');
  expect(selectedView(restored).document.root.type).toBe('Panel');
  expect(selectedView(restored).motionSystem).toMatchObject({ style: 'playful' });
  expect(selectedView(restored).timelineSnapshot).toBeTruthy();
  await page.locator('#studio-replay').click();
  await expect.poll(async () => {
    const view = selectedView(await snapshot(page));
    return { timelineRunning: view.timelineSnapshot?.running === true, systemRunning: view.motionSnapshot.scheduler.running > 0 };
  }).toEqual({ timelineRunning: true, systemRunning: true });
  const exported = await page.evaluate(() => (window as any).uiStudio.exportSelected()) as Bundle;
  expect(exported.motion).toEqual(imported.motion);

  await page.locator('#studio-reset').click();
  await expect.poll(async () => (await snapshot(page)).resourceCount).toBe(0);
  expect(await snapshot(page)).toMatchObject({ kind: null, filename: '', compare: false, analysis: { status: 'Idle', summary: '' }, views: [] });
  await expect(page.locator('#studio-export')).toBeDisabled();
});

test('Unresolved and Custom-required recognition results are displayed but never default to Button or a canvas', async ({ page }) => {
  const statuses: Array<'Unresolved' | 'Custom-required'> = ['Unresolved', 'Custom-required'];
  let index = 0;
  await ready(page, async (route, source) => {
    const status = statuses[index++];
    await route.fulfill({ json: { version: '0.1', sourceSha256: source.sha256, status, summary: `${status} fixture` } });
  });

  for (const status of statuses) {
    await page.locator('#reference-file').setInputFiles({ name: `${status}.png`, mimeType: 'image/png', buffer: pngBytes });
    await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
    const current = await snapshot(page);
    expect(current.analysis).toEqual({ status, summary: `${status} fixture` });
    assertNoPreview(current, 1);
    await expect(page.locator('#analysis-state')).toBeVisible();
    await expect(page.locator('#analysis-summary')).toHaveText(`${status} fixture`);
    await expect(page.locator('#studio-stage')).toBeHidden();
    await expect(page.locator('#studio-export')).toBeDisabled();
  }
});

test('wrong source digests, invalid contracts, and missing semantic configuration all fail closed', async ({ page }) => {
  let response = 0;
  await ready(page, async (route, source) => {
    response += 1;
    if (response === 1) {
      await route.fulfill({ json: { ...panelResponse(source), sourceSha256: '0'.repeat(64) } });
      return;
    }
    if (response === 2) {
      const invalid = panelResponse(source);
      invalid.intent.root.children[1].props.checked = 'not-a-boolean';
      await route.fulfill({ json: invalid });
      return;
    }
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });

  for (const name of ['wrong-digest.png', 'invalid-contract.png', 'not-configured.png']) {
    await page.locator('#reference-file').setInputFiles({ name, mimeType: 'image/png', buffer: pngBytes });
    await expect(page.locator('#studio-error')).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
    assertNoPreview(await snapshot(page));
    await expect(page.locator('#studio-export')).toBeDisabled();
    await page.locator('#dismiss-error').click();
    await expect(page.locator('#studio-error')).toBeHidden();
  }
});

test('invalid local inputs and malformed bundles clear prior semantic output without calling the endpoint', async ({ page }) => {
  let endpointCalls = 0;
  await ready(page, async route => {
    endpointCalls += 1;
    await route.abort();
  });
  const plate = await readFile(plateFixtureUrl);
  await page.locator('#reference-file').setInputFiles({ name: 'plate.svg', mimeType: 'image/svg+xml', buffer: plate });
  await expect(page.locator('#studio-error')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  assertNoPreview(await snapshot(page));
  await page.locator('#dismiss-error').click();

  await page.locator('#reference-file').setInputFiles({ name: 'corrupt.png', mimeType: 'image/png', buffer: await readFile(corruptFixtureUrl) });
  await expect(page.locator('#studio-error')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  assertNoPreview(await snapshot(page));
  expect(endpointCalls).toBe(0);
  await page.locator('#dismiss-error').click();

  await page.locator('#open-bundle').setInputFiles({ name: 'malformed.ui-bundle.json', mimeType: 'application/json', buffer: Buffer.from('{"bundleVersion":"0.2"}') });
  await expect(page.locator('#studio-error')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).resourceCount).toBe(0);
  await expect(page.locator('#studio-export')).toBeDisabled();
});

test('a stale recognition result cannot replace the newer upload, and the mobile studio does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let requests = 0;
  let firstSeen!: () => void;
  let releaseFirst!: () => void;
  const firstRequest = new Promise<void>(resolve => { firstSeen = resolve; });
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
  await ready(page, async (route, source) => {
    requests += 1;
    if (requests === 1) {
      firstSeen();
      await firstResponse;
      await route.fulfill({ json: panelResponse(source, 'stale recognition') });
      return;
    }
    await route.fulfill({ json: panelResponse(source, 'latest recognition') });
  });
  const input = page.locator('#reference-file');
  await input.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: pngBytes });
  await firstRequest;
  await input.setInputFiles({ name: 'latest.png', mimeType: 'image/png', buffer: pngBytes });
  await expect.poll(async () => (await snapshot(page)).analysis?.summary).toBe('latest recognition');
  await expect.poll(async () => (await snapshot(page)).ready).toBe(true);
  releaseFirst();
  await page.waitForTimeout(50);
  const current = await snapshot(page);
  expect(current).toMatchObject({ filename: 'latest.png', resourceCount: 1, kind: 'Panel', analysis: { status: 'Ready', summary: 'latest recognition' } });
  expect(current.views).toHaveLength(1);
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
});

test('a pending receipt polls twice before compiling the Ready Panel/Switch result and never reposts', async ({ page }) => {
  const analysisId = '11111111-1111-4111-8111-111111111111';
  const calls: Array<{ method: string; analysisId: string | null }> = [];
  let polls = 0;
  await ready(page, async (route, source) => {
    const request = route.request();
    const method = request.method();
    const queryId = new URL(request.url()).searchParams.get('analysisId');
    calls.push({ method, analysisId: queryId });
    if (method === 'POST') {
      await route.fulfill({ status: 202, json: {
        version: '0.1', sourceSha256: source.sha256, status: 'Pending', analysisId, pollAfterSeconds: 1,
      } });
      return;
    }
    expect(method).toBe('GET');
    expect(queryId).toBe(analysisId);
    polls += 1;
    if (polls === 1) {
      await route.fulfill({ status: 202, json: {
        version: '0.1', sourceSha256: source.sha256, status: 'Pending', analysisId, pollAfterSeconds: 1,
      } });
      return;
    }
    await route.fulfill({ status: 200, json: panelResponse(source, '轮询完成：通知设置面板。') });
  });

  await uploadReference(page, 'pending-settings.png');
  expect(calls).toEqual([
    { method: 'POST', analysisId: null },
    { method: 'GET', analysisId },
    { method: 'GET', analysisId },
  ]);
  const current = await snapshot(page);
  expect(current.analysis).toEqual({ status: 'Ready', summary: '轮询完成：通知设置面板。' });
  expect(current.kind).toBe('Panel');
  expect(selectedView(current).inspection.nodes.map(node => node.type)).toEqual(expect.arrayContaining(['Panel', 'Switch']));
});

test('a semantic network abort reports a recognition failure rather than an image decoding failure and clears the old canvas', async ({ page }) => {
  let posts = 0;
  await ready(page, async (route, source) => {
    posts += 1;
    if (posts === 1) {
      await route.fulfill({ json: panelResponse(source) });
      return;
    }
    await route.abort('failed');
  });
  await uploadReference(page, 'old-preview.png');
  await page.locator('#reference-file').setInputFiles({ name: 'network-abort.png', mimeType: 'image/png', buffer: pngBytes });
  await expect(page.locator('#studio-error')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('识图');
  await expect(page.locator('#error-message')).not.toContainText('图片无法打开');
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  assertNoPreview(await snapshot(page));
  await expect(page.locator('#studio-stage')).toBeHidden();
  await expect(page.locator('#studio-export')).toBeDisabled();
  expect(posts).toBe(2);
});

test('reset and a replacement upload cancel pending polls without an automatic POST or GET', async ({ page }) => {
  const analysisId = '22222222-2222-4222-8222-222222222222';
  const calls: string[] = [];
  let posts = 0;
  await ready(page, async (route, source) => {
    const method = route.request().method();
    calls.push(method);
    if (method === 'GET') {
      await route.abort('failed');
      return;
    }
    posts += 1;
    if (posts < 3) {
      await route.fulfill({ status: 202, json: {
        version: '0.1', sourceSha256: source.sha256, status: 'Pending', analysisId, pollAfterSeconds: 1,
      } });
      return;
    }
    await route.fulfill({ json: panelResponse(source, '替换后的识图结果。') });
  });
  const input = page.locator('#reference-file');

  await input.setInputFiles({ name: 'reset-pending.png', mimeType: 'image/png', buffer: pngBytes });
  await expect.poll(() => calls.filter(method => method === 'POST').length).toBe(1);
  await page.locator('#studio-reset').click();
  await page.waitForTimeout(1200);
  expect(calls).toEqual(['POST']);

  await input.setInputFiles({ name: 'replacement-pending.png', mimeType: 'image/png', buffer: pngBytes });
  await expect.poll(() => calls.filter(method => method === 'POST').length).toBe(2);
  await input.setInputFiles({ name: 'latest-ready.png', mimeType: 'image/png', buffer: pngBytes });
  await expect.poll(async () => (await snapshot(page)).analysis?.summary).toBe('替换后的识图结果。');
  await expect.poll(async () => (await snapshot(page)).ready).toBe(true);
  await page.waitForTimeout(1200);
  expect(calls).toEqual(['POST', 'POST', 'POST']);
  expect((await snapshot(page)).filename).toBe('latest-ready.png');
});

test('a pending receipt rejects source and analysis ID drift without polling again or enabling export', async ({ page }) => {
  const firstId = '33333333-3333-4333-8333-333333333333';
  const changedId = '44444444-4444-4444-8444-444444444444';
  const calls: string[] = [];
  let posts = 0;
  await ready(page, async (route, source) => {
    const method = route.request().method();
    calls.push(method);
    if (method === 'POST') {
      posts += 1;
      if (posts === 1) {
        await route.fulfill({ status: 202, json: {
          version: '0.1', sourceSha256: '0'.repeat(64), status: 'Pending', analysisId: firstId, pollAfterSeconds: 1,
        } });
        return;
      }
      await route.fulfill({ status: 202, json: {
        version: '0.1', sourceSha256: source.sha256, status: 'Pending', analysisId: firstId, pollAfterSeconds: 1,
      } });
      return;
    }
    await route.fulfill({ status: 202, json: {
      version: '0.1', sourceSha256: source.sha256, status: 'Pending', analysisId: changedId, pollAfterSeconds: 1,
    } });
  });
  const input = page.locator('#reference-file');

  await input.setInputFiles({ name: 'pending-source-drift.png', mimeType: 'image/png', buffer: pngBytes });
  await expect(page.locator('#studio-error')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  assertNoPreview(await snapshot(page));
  await expect(page.locator('#studio-export')).toBeDisabled();
  await page.waitForTimeout(1200);
  expect(calls).toEqual(['POST']);
  await page.locator('#dismiss-error').click();

  await input.setInputFiles({ name: 'pending-id-drift.png', mimeType: 'image/png', buffer: pngBytes });
  await expect(page.locator('#studio-error')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  assertNoPreview(await snapshot(page));
  await expect(page.locator('#studio-export')).toBeDisabled();
  await page.waitForTimeout(1200);
  expect(calls).toEqual(['POST', 'POST', 'GET']);
});
