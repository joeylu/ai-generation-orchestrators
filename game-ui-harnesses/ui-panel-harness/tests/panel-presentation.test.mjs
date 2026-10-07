import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../src/io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { arrangeIntentSpec, materializePanelIntent } from '../src/panel-intent.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { compilePanel, controlId } from '../src/compiler.mjs';
import { createPresentationPolicy, sectionPurpose } from '../src/panel-presentation.mjs';
import { measureFlowLayout, measureTabbedLayout } from '../src/flow-layout.mjs';
import { projectPanelEvent } from '../src/state.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { composePanelBundles } from '../src/panel-composition.mjs';
import { roleRequest, roleIntent } from '../examples/adaptive-v1/fixture.mjs';
import { themeRequest, themeIntent } from '../examples/themes-v1/fixture.mjs';
const catalog = await readJson(new URL('../examples/modern-adaptive.catalog.json', import.meta.url)), core = await loadWorkspaceCore();
const oldCatalog = await readJson(new URL('../examples/modern-game-themes.catalog.json', import.meta.url));
const theme = catalog.themes[0];
const context = await createPlanningContext(roleRequest, catalog), proposal = await materializePanelIntent(context, roleIntent(context));
const spec = proposal.spec, bundle = await createPanelBundle(spec, catalog, core);
const all = document => { const nodes = []; const visit = node => { nodes.push(node); node.children?.forEach(visit); }; visit(document.root); return nodes; };
const settings = (s, width = null) => ({ width, canvasWidth: null, canvasHeight: null, maxHeight: null, overflow: 'auto', body: null, sourceQuote: 'Offline presentation fixture.' });

test('form uses a compact measured canvas, a stacked field and distinct grouped actions without duplicate heading', async () => {
  const nodes = all(bundle.componentBundle.document), input = nodes.find(n => n.type === 'Input'), buttons = nodes.filter(n => n.type === 'Button');
  assert.equal(bundle.compilerVersion, '0.7.3'); assert.equal(spec.layout.width, 420); assert(spec.canvas.height < 400);
  assert(!nodes.some(n => n.id.endsWith('section.section0.title')));
  assert.equal(input.layout.height, 44); assert.equal(input.layout.x, 12); assert(input.layout.y > nodes.find(n => n.id.endsWith('row.row0.label')).layout.y);
  assert.equal(buttons.length, 2); assert.equal(buttons[0].layout.y, buttons[1].layout.y); assert(buttons[1].layout.x > buttons[0].layout.x + buttons[0].layout.width);
  assert.equal(buttons[0].props.style.backgroundColor, theme.tokens.accent); assert.equal(buttons[1].props.style.backgroundColor, theme.tokens.surface);
  assert.equal(buttons[1].props.style.borderWidth, 1); assert.equal(buttons[0].layout.height, 44);
  assert.deepEqual(await validatePanelBundle(bundle, core), bundle);
});

test('form validation reserves a full line, scoped submission and cancel retain their exact typed behavior', async () => {
  const state = { row0: ' 蓝莓 ' }, compiled = compilePanel(spec, catalog, core, state), nodes = all(compiled.document);
  const input = nodes.find(n => n.type === 'Input'), error = nodes.find(n => n.id.endsWith('.required'));
  assert(error.layout.y >= input.layout.y + input.layout.height + 8);
  assert.equal(projectPanelEvent(spec, { row0: '' }, { id: controlId(spec.id, 'row1'), type: 'activate', source: 'keyboard' }).event, null);
  const submission = projectPanelEvent(spec, state, { id: controlId(spec.id, 'row1'), type: 'activate', source: 'keyboard' });
  assert.deepEqual(submission.event.values, state);
  const cancel = projectPanelEvent(spec, state, { id: controlId(spec.id, 'row2'), type: 'activate', source: 'keyboard' });
  assert.equal(cancel.event.action, 'emit'); assert.deepEqual(cancel.state, state);
  const native = await createUnityDocument(bundle, core); assert(!native.nodes.some(n => n.id.endsWith('.center-label')));
  const nativeInput = native.nodes.find(n => n.id === input.id); assert(nativeInput); assert.equal(nativeInput.height ?? nativeInput.rect?.height, 44);
});

test('long labels and narrow dimensions stack footer actions without truncating or reordering them', async () => {
  const changed = structuredClone(spec); changed.sections[0].rows[1].buttonLabel = '确认并进入下一步'; changed.sections[0].rows[2].buttonLabel = '取消并返回上一页';
  const arranged = arrangeIntentSpec(changed, settings(changed, 420), theme), checked = await createPanelBundle(arranged, catalog, core);
  const buttons = all(checked.componentBundle.document).filter(n => n.type === 'Button');
  assert(buttons[1].layout.y > buttons[0].layout.y); assert.equal(buttons[0].props.label, '确认并进入下一步');
  assert(all(checked.componentBundle.document).filter(n => n.id.endsWith('.center-label')).every(n => n.props.overflow === 'error'));
  assert.throws(() => arrangeIntentSpec(structuredClone(spec), { ...settings(spec), canvasHeight: 120, overflow: 'error' }, theme), { code: 'LAYOUT_OVERFLOW' });
  assert.throws(() => arrangeIntentSpec(structuredClone(spec), { ...settings(spec), maxHeight: 196 }, theme), { code: 'LAYOUT_OVERFLOW' });
});

test('explicit different section headings and helper actions between fields remain visible and ordered', async () => {
  const changed = structuredClone(spec); changed.sections[0].title = '账号资料';
  const helper = structuredClone(changed.sections[0].rows[2]); helper.id = 'helper'; helper.event = 'panel.helper'; helper.buttonLabel = '检查名字';
  changed.sections[0].rows.splice(1, 0, helper);
  const checked = await createPanelBundle(arrangeIntentSpec(changed, settings(changed), theme), catalog, core), nodes = all(checked.componentBundle.document);
  assert(nodes.some(n => n.props.text === '账号资料')); const buttons = nodes.filter(n => n.type === 'Button');
  assert.equal(buttons[0].props.label, '检查名字'); assert(buttons[0].layout.y < buttons[1].layout.y);
  assert.equal(buttons[1].props.style.backgroundColor, theme.tokens.accent); assert.equal(buttons[2].props.style.backgroundColor, theme.tokens.surface);
});

test('typed purpose keeps menus vertical and settings controls independently sized; tabs share the measured policy', async () => {
  const menu = structuredClone(spec); menu.state = []; menu.sections[0].rows = menu.sections[0].rows.slice(1).map(row => ({ ...row, action: { kind: 'emit' } }));
  assert.equal(sectionPurpose(menu.sections[0]), 'menu');
  const menuBundle = await createPanelBundle(arrangeIntentSpec(menu, settings(menu), theme), catalog, core), buttons = all(menuBundle.componentBundle.document).filter(n => n.type === 'Button');
  assert(buttons[1].layout.y > buttons[0].layout.y); assert.equal(buttons[0].layout.width, buttons[1].layout.width);
  const ctx = await createPlanningContext(themeRequest(theme), catalog), tabSpec = (await materializePanelIntent(ctx, themeIntent(ctx, theme))).spec;
  const layout = measureTabbedLayout(tabSpec, createPresentationPolicy(tabSpec, theme.tokens));
  assert.equal(layout.sections[0].presentation.purpose, 'settings'); assert.equal(layout.sections[1].presentation.purpose, 'settings');
  assert.equal(layout.sections[0].presentation.rows[0].height, 56); assert.equal(layout.sections[1].presentation.rows[0].height, 80);
  const tabBundle = await createPanelBundle(tabSpec, catalog, core); await validatePanelBundle(tabBundle, core);
  const settingsSpec = structuredClone(tabSpec); settingsSpec.tabs = null; settingsSpec.state = settingsSpec.state.filter(field => field.id !== tabSpec.tabs.bind);
  const settingsBundle = await createPanelBundle(arrangeIntentSpec(settingsSpec, settings(settingsSpec), theme), catalog, core);
  const result = await composePanelBundles({ panelCompositionRequestVersion: '0.1', id: 'adaptive-composite', title: '组合', sources: [{ namespace: 'role', bundleSha256: bundle.sha256 }, { namespace: 'settings', bundleSha256: settingsBundle.sha256 }], layout: 'tabs', width: null, canvasWidth: null, canvasHeight: null, maxHeight: 480, surfaceFrom: null }, [bundle, settingsBundle], core);
  await validatePanelBundle(result.bundle, core); assert.equal(result.bundle.compilerVersion, '0.7.3');
});

test('eight pinned themes compile and reject mismatched versions; legacy profiles keep their original geometry', async () => {
  for (const variant of catalog.themes) {
    const checked = await createPanelBundle((await materializePanelIntent(context, roleIntent(context, variant))).spec, catalog, core);
    await validatePanelBundle(checked, core); assert.throws(() => compilePanel(checked.spec, catalog, core, undefined, undefined, '0.7.2'), /VISUAL_STYLE_VERSION/);
  }
  const oldContext = await createPlanningContext(roleRequest, oldCatalog), oldSpec = (await materializePanelIntent(oldContext, roleIntent(oldContext))).spec;
  const old = await createPanelBundle(oldSpec, oldCatalog, core); assert.equal(old.compilerVersion, '0.7.2'); assert.equal(oldSpec.layout.width, 640);
  assert.equal(measureFlowLayout(oldSpec).sections[0].height, 308); assert(!Object.hasOwn(measureFlowLayout(oldSpec).sections[0], 'presentation'));
  const oldButtons = all(old.componentBundle.document).filter(n => n.type === 'Button'); assert(oldButtons[1].layout.y > oldButtons[0].layout.y);
  assert(oldButtons.every(n => n.props.style.backgroundColor === oldCatalog.themes[0].tokens.accent));
  await validatePanelBundle(old, core);
});
