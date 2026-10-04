#!/usr/bin/env node
/** Acceptance client for the existing component workbench; never starts a server. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '../../ui-component-harness/node_modules/@playwright/test/index.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { projectPanelEvent } from '../src/state.mjs';
import { readJson, createOutputDirectory, writeNewJson, harnessRoot } from '../src/io.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// The workbench exports resources in tree traversal order; ordering has no asset semantics.
const sortedResources = resources => [...resources].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const portableBundle = bundle => ({ ...bundle, resources: sortedResources(bundle.resources) });
const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  assert(['--bundle', '--url', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]], 'Expected --bundle, --url and --output exactly once');
  options[args[i]] = args[i + 1];
}
assert(Object.keys(options).length === 3, 'Required: --bundle <panel.bundle.json> --url <loopback URL> --output <fresh directory>');
const url = new URL(options['--url']);
assert(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash, 'Literal HTTP loopback URL required');
if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) url.pathname = url.pathname.replace(/(?:index\.html)?$/, 'workbench.html');
assert(url.pathname.endsWith('/workbench.html'), 'Existing workbench.html required');
const directory = await createOutputDirectory(options['--output']);
const report = { version: '0.1', status: 'RUNNING', checks: [], screenshots: [], providerCalls: 0,
  scope: 'Settings panel in existing Pixi workbench build; embedded images when present; acceptance client starts no server and writes no sibling files',
  humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN', font: 'Environment font family; not a bundled font' };
const pass = (name, evidence = {}) => report.checks.push({ name, status: 'PASS', ...evidence });
let browser, context, page, stage = 'validate-panel-wrapper';
try {
  const core = await loadWorkspaceCore(), wrapper = await validatePanelBundle(await readJson(options['--bundle']), core);
  report.panelSha256 = wrapper.sha256;
  pass(stage);
  const nodes = new Map();
  const visit = node => { nodes.set(node.id, node); for (const child of node.children ?? []) visit(child); };
  visit(wrapper.componentBundle.document.root);
  const slider = wrapper.bindings.find(binding => nodes.get(binding.nodeId)?.type === 'Slider' && binding.enabled);
  const toggle = wrapper.bindings.find(binding => nodes.get(binding.nodeId)?.type === 'Switch' && binding.enabled);
  assert(slider && toggle, 'Acceptance requires an enabled Slider and Switch binding');
  assert.equal(wrapper.state[toggle.fieldId], true, 'Acceptance fixture requires an initially checked switch');
  const props = nodes.get(slider.nodeId).props;
  const textBinding = wrapper.componentBundle.document.valueTextBindings?.bindings.find(binding => binding.sourceId === slider.nodeId);
  assert(textBinding, 'Slider needs a derived value Text');
  let projected = structuredClone(wrapper.state);
  const textFor = value => textBinding.parts.map(part => typeof part === 'string' ? part : value.toFixed(part.fractionDigits)).join('');
  stage = 'identify-served-build';
  const fetchLocal = async target => {
    assert.equal(target.origin, url.origin, 'Build asset must remain on the same loopback origin');
    const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert(response.ok, 'Existing preview returned an unsuccessful response');
    return Buffer.from(await response.arrayBuffer());
  };
  const html = await fetchLocal(url), htmlText = html.toString('utf8');
  const assets = [...htmlText.matchAll(/(?:src|href)="([^"?#]+\.js)"/g)].map(match => new URL(match[1], url));
  assert(assets.length, 'Expected a built workbench with JS assets');
  const buildFiles = [];
  for (const asset of [url, ...new Map(assets.map(asset => [asset.href, asset])).values()]) {
    assert(/^\/(?:workbench\.html|assets\/[A-Za-z0-9._-]+\.js)$/.test(asset.pathname), 'Unsupported build asset path');
    const served = asset.href === url.href ? html : await fetchLocal(asset);
    const local = await readFile(new URL(`../../ui-component-harness/dist${asset.pathname}`, import.meta.url));
    assert.equal(sha(served), sha(local), 'Existing served build differs from local dist');
    buildFiles.push({ path: asset.pathname.slice(1), servedSha256: sha(served), localDistSha256: sha(local), equal: true });
  }
  report.build = { scope: 'Served bytes match local dist; current source equivalence is not asserted', files: buildFiles };
  pass(stage);
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = { channel: 'msedge', version: browser.version() };
  const problems = [];
  const healthy = async () => { assert.equal(problems.length, 0, problems[0]); assert(await page.locator('#error').isHidden(), 'Workbench reported an error'); };
  const events = () => page.locator('#events li').evaluateAll(items => items.map(item => { try { return JSON.parse(item.textContent); } catch { return null; } }).filter(Boolean).reverse());
  const clearEvents = () => page.locator('#clear-events').click();
  const inspect = () => page.evaluate(() => window.uiHarness.inspect());
  const nodeState = async id => (await inspect()).nodes.find(node => node.id === id);
  const checkImages = async () => {
    const images = [...nodes.values()].filter(node => node.type === 'Image');
    const rendered = await inspect();
    assert.equal(rendered.resources, wrapper.componentBundle.resources.length, 'Every embedded texture must be prepared');
    assert.deepEqual((await page.evaluate(() => window.uiHarness.resourcePaths())).sort(), wrapper.componentBundle.resources.map(r => r.path).sort());
    for (const image of images) {
      const actual = rendered.nodes.find(n => n.id === image.id);
      assert(actual?.visible && actual.bounds.width > 0 && actual.bounds.height > 0, 'Image must be rendered at positive bounds');
      assert(Math.abs(actual.bounds.width - image.layout.width) < 1 && Math.abs(actual.bounds.height - image.layout.height) < 1, 'Image bounds differ from compiled layout');
    }
    // Check the interior of each icon badge, excluding rounded edges. A missing image
    // would leave a flat badge even if the Image node and resource list looked valid.
    for (const image of images.filter(n => n.id.endsWith('.icon'))) {
      const bounds = rendered.nodes.find(n => n.id === image.id).bounds;
      const pixels = await page.evaluate(async ({bounds, color}) => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const source = document.querySelector('#canvas-host canvas');
        const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
        const ctx = copy.getContext('2d'); ctx.drawImage(source, 0, 0);
        const rgb = [1,3,5].map(i => parseInt(color.slice(i, i + 2),16));
        const data = ctx.getImageData(Math.round(bounds.x + 6), Math.round(bounds.y + 6), 16,16).data;
        let nonBadge = 0;
        for (let i=0; i<data.length; i+=4) if (rgb.some((v,c) => Math.abs(data[i+c]-v)>25)) nonBadge++;
        return nonBadge;
      }, {bounds, color: image.props.style.backgroundColor});
      assert(pixels >= 3, 'Icon texture pixels must appear inside its badge');
    }
    return { images: images.length, embeddedPngs: wrapper.componentBundle.resources.length, iconPixels: 'CHECKED' };
  };
  const checkText = async value => {
    const node = await nodeState(textBinding.targetId);
    assert.equal(node.renderedTextBounds.map(item => item.text).join(''), textFor(value), 'Derived slider text mismatch');
  };
  const screenshot = async name => { await page.locator('#canvas-host canvas').screenshot({ path: resolve(directory, name) }); report.screenshots.push(name); };
  const openPage = async () => {
    context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      if (target.origin === url.origin || ['data:', 'blob:'].includes(target.protocol)) return route.continue();
      problems.push('Nonlocal browser request blocked'); return route.abort();
    });
    page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', () => problems.push('Uncaught browser error'));
    page.on('console', entry => { if (entry.type() === 'error') problems.push('Browser console error'); });
    page.on('requestfailed', () => problems.push('Browser resource request failed'));
    page.on('response', response => { if (response.status() >= 400) problems.push('Browser resource HTTP error'); });
    await page.goto(url.href, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForFunction(() => Boolean(window.uiHarness));
    const adapter = await page.evaluate(() => window.uiHarness.workflowAdapter);
    assert(adapter.version === '0.1' && adapter.engine === 'pixi.js', 'Unsupported workbench adapter');
    report.browser.adapter = adapter; await healthy();
  };
  const geometry = async id => {
    const state = await nodeState(id); assert(state?.visible, 'Input target must be visible');
    await page.evaluate(bounds => { const area = document.querySelector('.canvas-area'); area.scrollTop = Math.max(0, bounds.y + bounds.height / 2 - area.clientHeight / 2); }, state.bounds);
    const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox(), size = wrapper.componentBundle.document.canvas;
    assert(box?.width && box?.height, 'Canvas must have actual rendered geometry');
    return { x: box.x + state.bounds.x * box.width / size.width, y: box.y + state.bounds.y * box.height / size.height,
      width: state.bounds.width * box.width / size.width, height: state.bounds.height * box.height / size.height, scale: box.width / size.width };
  };
  const checkChange = async (binding, expected, source) => {
    const changes = (await events()).filter(event => event.type === 'change');
    assert.equal(changes.length, 1, 'One committed user change expected');
    assert.equal(changes[0].id, binding.nodeId); assert.equal(changes[0].value, expected); assert.equal(changes[0].source, source);
    const result = projectPanelEvent(wrapper.spec, projected, changes[0]); projected = result.state;
    assert.deepEqual(result.event, { name: binding.event, fieldId: binding.fieldId, value: expected, source });
    return changes[0];
  };
  const drag = async expected => {
    const current = (await nodeState(slider.nodeId)).value, g = await geometry(slider.nodeId);
    const point = value => g.x + (14 + (value - props.min) / (props.max - props.min) * (g.width / g.scale - 28)) * g.scale;
    await clearEvents(); await page.mouse.move(point(current), g.y + g.height / 2); await page.mouse.down();
    await page.mouse.move(point(expected), g.y + g.height / 2, { steps: 8 });
    assert.equal((await nodeState(slider.nodeId)).value, current, 'Drag preview must not prematurely commit');
    assert.equal((await events()).filter(event => event.type === 'change').length, 0, 'No change before release');
    await checkText(expected); await page.mouse.up();
    assert.equal((await nodeState(slider.nodeId)).value, expected); await checkText(expected); await healthy();
    return checkChange(slider, expected, 'mouse');
  };
  stage = 'initial-import'; await openPage(); await clearEvents();
  await page.evaluate(bundle => window.uiHarness.importBundle(bundle), wrapper.componentBundle); await healthy();
  assert.equal((await events()).filter(event => event.type === 'change').length, 0, 'Initialization emitted change');
  for (const binding of wrapper.bindings) assert.equal((await nodeState(binding.nodeId)).value, projected[binding.fieldId]);
  assert.equal((await nodeState(slider.nodeId)).value, projected[slider.fieldId]); await checkText(projected[slider.fieldId]);
  assert.equal((await nodeState(toggle.nodeId)).value, projected[toggle.fieldId]);
  assert.deepEqual(portableBundle(await page.evaluate(() => window.uiHarness.exportBundle())), portableBundle(wrapper.componentBundle));
  for (const node of (await inspect()).nodes) for (const item of node.renderedTextBounds ?? []) {
    assert(!item.implicitTruncation && item.bounds.width <= node.bounds.width + 1 && item.bounds.height <= node.bounds.height + 1, 'Text overflow or implicit truncation');
  }
  await screenshot('initial.png'); pass(stage, { state: structuredClone(projected), initializationChanges: 0, textOverflow: false });
  if (wrapper.assetClosure) { stage = 'embedded-asset-rendering'; pass(stage, await checkImages()); }
  stage = 'slider-pointer-release';
  const firstValue = projected[slider.fieldId] === props.max ? props.min : props.max;
  pass(stage, { event: await drag(firstValue) });
  stage = 'switch-off-preserves-volume'; await clearEvents();
  const toggleGeometry = await geometry(toggle.nodeId); await page.mouse.click(toggleGeometry.x + toggleGeometry.width / 2, toggleGeometry.y + toggleGeometry.height / 2);
  assert.equal((await nodeState(toggle.nodeId)).value, false); assert.equal((await nodeState(slider.nodeId)).value, firstValue);
  pass(stage, { event: await checkChange(toggle, false, 'mouse'), volume: firstValue });
  stage = 'adjust-volume-while-off'; const secondValue = firstValue === props.max ? props.min : props.max;
  const event = await drag(secondValue); assert.equal((await nodeState(toggle.nodeId)).value, false); pass(stage, { event, switchField: toggle.fieldId, switchValue: projected[toggle.fieldId] });
  stage = 'keyboard-slider-step'; await clearEvents();
  const canvas = page.locator('#canvas-host canvas'); await canvas.focus();
  for (let count = 0; count <= wrapper.bindings.length && await canvas.getAttribute('data-focused-component') !== slider.nodeId; count++) await page.keyboard.press('Tab');
  assert.equal(await canvas.getAttribute('data-focused-component'), slider.nodeId, 'Slider keyboard focus unavailable');
  const key = secondValue === props.max ? 'ArrowLeft' : 'ArrowRight', keyboardValue = secondValue + (key === 'ArrowRight' ? props.step : -props.step);
  await page.keyboard.press(key); assert.equal((await nodeState(slider.nodeId)).value, keyboardValue); await checkText(keyboardValue);
  pass(stage, { event: await checkChange(slider, keyboardValue, 'keyboard') });
  stage = 'disabled-control'; await page.evaluate(id => window.uiHarness.setEnabled(id, false), slider.nodeId); await clearEvents();
  const disabledGeometry = await geometry(slider.nodeId); await page.mouse.click(disabledGeometry.x + disabledGeometry.width / 2, disabledGeometry.y + disabledGeometry.height / 2);
  assert.equal((await nodeState(slider.nodeId)).value, keyboardValue); assert.equal((await nodeState(slider.nodeId)).enabled, false);
  assert.equal((await events()).filter(event => event.type === 'change').length, 0); await healthy(); pass(stage);
  // Extra sliders introduced by a patch must change their own field and event only.
  for (const binding of wrapper.bindings.filter(item => item.nodeId !== slider.nodeId && item.enabled && nodes.get(item.nodeId)?.type === 'Slider')) {
    stage = `independent-slider-${binding.fieldId}`;
    const before = structuredClone(projected), ownProps = nodes.get(binding.nodeId).props;
    const expected = before[binding.fieldId] === ownProps.max ? ownProps.min : ownProps.max;
    const g = await geometry(binding.nodeId), x = expected === ownProps.max ? g.x + g.width - 14 * g.scale : g.x + 14 * g.scale;
    await clearEvents(); await page.mouse.click(x, g.y + g.height / 2);
    const event = await checkChange(binding, expected, 'mouse');
    for (const other of wrapper.bindings) {
      assert.equal((await nodeState(other.nodeId)).value, other === binding ? expected : before[other.fieldId], 'A slider changed an unrelated control');
    }
    const valueBinding = wrapper.componentBundle.document.valueTextBindings.bindings.find(item => item.sourceId === binding.nodeId);
    const rendered = (await nodeState(valueBinding.targetId)).renderedTextBounds.map(item => item.text).join('');
    assert.equal(rendered, valueBinding.parts.map(part => typeof part === 'string' ? part : expected.toFixed(part.fractionDigits)).join(''));
    await healthy(); pass(stage, { event, preservedOtherFields: true });
  }
  await screenshot('interacted.png');
  stage = 'snapshot-export'; const saved = await core.validateBundle(await page.evaluate(() => window.uiHarness.exportBundle()));
  assert.deepEqual(sortedResources(saved.resources), sortedResources(wrapper.componentBundle.resources), 'Interaction must not replace pinned asset bytes');
  await writeNewJson(directory, 'component.snapshot.bundle.json', saved); await writeNewJson(directory, 'panel.snapshot.state.json', projected);
  pass(stage, { state: projected, scope: 'Component snapshot includes runtime disabled state; original PanelSpec remains unchanged' });
  const teardown = async () => {
    await page.evaluate(() => window.uiHarness.clear());
    const state = await page.evaluate(() => ({ ...window.uiHarness.inspect(), paths: window.uiHarness.resourcePaths(), motion: window.uiHarness.inspectMotionSystem(), timeline: window.uiHarness.motionSnapshot() ?? null }));
    assert.equal(state.instances, 0); assert.equal(state.externalListeners, 0); assert.equal(state.resources, 0);
    assert.deepEqual(state.nodes, []); assert.deepEqual(state.paths, []); assert.equal(state.motion, null); assert.equal(state.timeline, null); await healthy();
  };
  await teardown(); await context.close(); stage = 'fresh-context-restoration'; await openPage(); await clearEvents();
  await page.evaluate(bundle => window.uiHarness.importBundle(bundle), saved); await healthy();
  assert.equal((await events()).filter(event => event.type === 'change').length, 0);
  assert.equal((await nodeState(slider.nodeId)).value, keyboardValue); assert.equal((await nodeState(slider.nodeId)).enabled, false);
  assert.equal((await nodeState(toggle.nodeId)).value, false); await checkText(keyboardValue);
  for (const binding of wrapper.bindings) assert.equal((await nodeState(binding.nodeId)).value, projected[binding.fieldId]);
  assert.deepEqual(portableBundle(await page.evaluate(() => window.uiHarness.exportBundle())), portableBundle(saved)); await screenshot('restored.png'); pass(stage);
  if (wrapper.assetClosure) { stage = 'restored-asset-rendering'; pass(stage, await checkImages()); }
  stage = 'runtime-teardown'; await teardown(); pass(stage);
  report.status = 'PASS'; report.nonlocalRequests = 0;
} catch (error) {
  report.status = 'FAIL'; report.checks.push({ name: stage, status: 'FAIL' });
  report.error = String(error.message).replaceAll(harnessRoot, '<harness>').replace(/[A-Za-z]:[\\/][^\n"'<>]+/g, '<local-path>');
  process.exitCode = 1;
} finally {
  try { await context?.close(); } finally { await browser?.close(); }
  await writeNewJson(directory, 'browser-report.json', report);
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: 'browser-report.json', error: report.error }));
}
