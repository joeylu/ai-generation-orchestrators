import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { core, nodesOf } from './helpers.mjs';
import { digestJson } from '../src/canonical.mjs';
import { createPlanningContext, validatePlanningContext } from '../src/planning-context.mjs';
import { buildNativePanelIntentResponseSchema, materializePanelIntent, validateNativePanelIntentEvidence } from '../src/panel-intent.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { createPanelEditContext, validatePanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { buildCodexEditResponseSchema, codexEditOperationContracts } from '../src/codex-edit-schema.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { composePanelBundles, validatePanelComposition } from '../src/panel-composition.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { projectPanelEvent } from '../src/state.mjs';
import { controlId } from '../src/compiler.mjs';
import { roleRequest, roleIntent } from '../examples/adaptive-v1/fixture.mjs';

const catalog = JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json', import.meta.url), 'utf8'));
const legacyContext = await createPlanningContext(roleRequest, catalog);
const role = (await materializePanelIntent(legacyContext, roleIntent(legacyContext))).spec;
const section = { id: 'transport', title: '播放控制', rows: ['⏮', '⏯', '⏭'].map((buttonLabel, i) => ({
  id: `transport${i}`, kind: 'button', label: '', buttonLabel, enabled: true,
  recipe: { id: 'settings.button', version: '0.1.0' }, event: `music.action${i}`, action: { kind: 'emit' },
})) };
const spec = { ...role, id: 'music-player', title: '音乐播放器', state: [], sections: [section],
  panelSpecVersion: '0.9', appearance: null,
  actionLayouts: [{ sectionId: section.id, direction: 'row', align: 'center', gap: 16, buttonWidth: 56, buttonHeight: 56, shape: 'circle' }],
  layout: { ...role.layout, body: { ...role.layout.body, children: [{ kind: 'section', sectionId: section.id, width: 'fill' }] } },
};
const source = await createPanelBundle(spec, catalog, core);
const buttons = b => nodesOf(b.componentBundle.document).filter(n => n.type === 'Button');
const empty = () => ({ backgroundColor: null, textColor: null, borderColor: null, borderWidth: null, cornerRadius: null, width: null, height: null, shape: null });
const styleOp = overrides => ({ op: 'set-button-style', rowId: 'transport1', style: overrides === null ? null : { ...empty(), ...overrides } });
const orderOp = { op: 'set-row-order', sectionId: 'transport', rowIds: ['transport2', 'transport1', 'transport0'] };
const patch = async (s, operations) => ({ patchVersion: '0.1', baseSpecSha256: await digestJson(s), reason: 'Explicit isolated fixture.', operations });
async function changed(operations, b = source) {
  const result = await applyPanelPatch(b.spec, await patch(b.spec, operations));
  return validatePanelBundle(await createPanelBundle(result.spec, catalog, core, b.state), core);
}

test('reordering moves existing stable identities, actions and glyphs together', async () => {
  const b = await changed([orderOp]), nodes = buttons(b);
  assert.deepEqual(b.spec.sections[0].rows.map(row => row.id), orderOp.rowIds);
  for (const row of b.spec.sections[0].rows) {
    assert.deepEqual(row, section.rows.find(old => old.id === row.id));
    assert.equal(projectPanelEvent(b.spec, b.state, { type: 'activate', id: controlId(b.spec.id, row.id), source: 'mouse' }).event.name, row.event);
  }
  assert(nodes[0].layout.x < nodes[1].layout.x && nodes[1].layout.x < nodes[2].layout.x);
  assert.deepEqual(b.state, source.state); assert.deepEqual(b.spec.assets, source.spec.assets);
});

for (const rowIds of [['transport0'], ['transport0', 'transport0', 'transport2'], ['transport0', 'transport1', 'missing'], [0, 1, 2]])
  test(`invalid reorder ${JSON.stringify(rowIds)} leaves the source untouched`, async () => {
    const before = await digestJson(source);
    await assert.rejects(changed([{ op: 'set-panel-title', title: '不能部分应用' }, { ...orderOp, rowIds }]));
    assert.equal(await digestJson(source), before);
  });

test('reorder rejects add/remove in its section and cross-section identities', async () => {
  await assert.rejects(changed([orderOp, { op: 'remove-row', rowId: 'transport0' }]), /separate edits/);
  await assert.rejects(changed([{ ...orderOp, sectionId: 'missing' }]), /existing section/);
  await assert.rejects(changed([orderOp, orderOp]), /overlap/);
});

test('a reordered, larger purple middle circle changes only its own presentation', async () => {
  const b = await changed([orderOp, styleOp({ backgroundColor: '#7C3AED', width: 80, height: 80, shape: 'circle' })]);
  assert.equal(b.spec.panelSpecVersion, '0.10'); assert.equal(b.compilerVersion, '0.10.0');
  const nodes = buttons(b), middle = nodes.find(n => n.id === controlId(spec.id, 'transport1'));
  assert.equal(middle.layout.width, 80); assert.equal(middle.layout.height, 80); assert.equal(middle.props.style.cornerRadius, 40);
  assert.equal(middle.props.style.backgroundColor, '#7C3AED');
  for (const id of ['transport0', 'transport2']) {
    const n = nodes.find(n => n.id === controlId(spec.id, id)), old = buttons(source).find(n => n.id === controlId(spec.id, id));
    assert.equal(n.layout.width, 56); assert.deepEqual(n.props.style, old.props.style);
  }
  assert.equal(nodes[1].layout.x - nodes[0].layout.x, 72); assert.equal(nodes[2].layout.x - nodes[1].layout.x, 96);
  assert.deepEqual([...b.actions].sort((a,b)=>a.rowId.localeCompare(b.rowId)), [...source.actions].sort((a,b)=>a.rowId.localeCompare(b.rowId)));
});

test('local outline colors and radius override only their button, and clearing restores inherited geometry', async () => {
  const b = await changed([styleOp({ backgroundColor: '#FFFFFF', textColor: '#334155', borderColor: '#334155', borderWidth: 2, shape: 'default', cornerRadius: 0 })]);
  const n = buttons(b)[1]; assert.equal(n.props.style.backgroundColor, '#FFFFFF');
  assert.equal(n.props.style.textColor, '#334155'); assert.equal(n.props.style.borderWidth, 2); assert.equal(n.props.style.cornerRadius, 0);
  const cleared = await changed([styleOp(null)], b);
  assert.deepEqual(cleared.spec.buttonStyles, []);
  assert.deepEqual(buttons(cleared).map(n => ({ layout: n.layout, style: n.props.style })), buttons(source).map(n => ({ layout: n.layout, style: n.props.style })));
  assert.equal(cleared.spec.panelSpecVersion, '0.10');
  assert.deepEqual((await changed([styleOp(null)])).spec, source.spec);
});

for (const [name, value] of [['CSS color', { backgroundColor: 'url(secret)' }], ['alpha color', { backgroundColor: '#11223344' }],
  ['fractional target', { width: 55.5 }], ['small target', { width: 20 }], ['large border', { borderWidth: 9 }],
  ['ellipse', { shape: 'circle', width: 80, height: 56 }], ['bad shape', { shape: 'triangle' }]])
  test(`unsafe or unrepresentable button ${name} is rejected atomically`, async () => {
    const before = await digestJson(source);
    await assert.rejects(changed([{ op: 'set-panel-title', title: '不能部分应用' }, styleOp(value)]));
    assert.equal(await digestJson(source), before);
  });

test('per-button dimensions respect group width, label fit, target kind and complete style fields', async () => {
  await assert.rejects(changed([styleOp({ width: 512, height: 512 })]), /exceeds/);
  await assert.rejects(changed([styleOp({ width: 80 })]), /must match/);
  const incomplete = styleOp({}); delete incomplete.style.width; await assert.rejects(changed([incomplete]), /complete/);
  await assert.rejects(changed([{ ...styleOp({}), rowId: 'missing' }]));
  const long = structuredClone(source.spec); long.sections[0].rows[1].buttonLabel = '不允许缩掉的长按钮标题';
  await assert.rejects(createPanelBundle(long, catalog, core), /labels do not fit/);
});

test('static Text content changes independently from panel title and field label', async () => {
  const textSpec = structuredClone(role), s = textSpec.sections[0];
  s.rows.unshift({ id: 'intro', kind: 'text', label: '提示', text: '请输入角色名', recipe: { id: 'settings.text', version: '0.1.0' } });
  const base = await createPanelBundle(textSpec, catalog, core), op = { op: 'set-text', rowId: 'intro', text: '名字确定后还能修改' };
  const b = await changed([op], base);
  assert.equal(b.spec.title, base.spec.title); assert.equal(b.spec.sections[0].rows[0].label, '提示');
  assert.equal(b.spec.sections[0].rows[0].text, op.text); assert.deepEqual(b.state, base.state);
  await assert.rejects(changed([{ ...op, rowId: 'row0' }], base), /Text/);
  for (const text of ['两行\n不可隐式折行', '', 'a'.repeat(1001)]) await assert.rejects(changed([{ ...op, text }], base));
});

test('Current context exposes control edits; saved 0.3 does not gain capabilities', async () => {
  const request = { ...roleRequest, id: 'edit-player', text: '交换上一首和下一首，播放键变为紫色大圆，其他保持不变。' };
  const c = await createPanelEditContext(source.spec, catalog, request);
  assert.equal(c.editContextVersion, '0.8'); assert.equal(c.capabilities.buttonStylePolicy, 'per-button-v1');
  const schema = await buildCodexEditResponseSchema({ draft: true, context: c }), operations = codexEditOperationContracts(schema, c).map(o => o.operation);
  for (const op of ['set-row-order', 'set-text', 'set-button-style']) assert(operations.includes(op));
  const draft = { codexEditDraftVersion: '0.3', contextSha256: c.sha256, patch: await patch(c.spec, [orderOp, styleOp({ backgroundColor: '#7C3AED', width: 80, height: 80 })]),
    bases: [0, 1].map(() => ({ kind: 'request-interpretation', quote: request.text })), unresolved: [], noChange: null };
  const proposal = await materializeCodexEditDraft(c, draft);
  assert.equal((await checkPanelEditProposal(c, proposal)).status, 'READY_TO_APPLY');
  const old = structuredClone(c); old.editContextVersion = '0.3'; delete old.selection; delete old.capabilities.buttonFontPolicy; delete old.capabilities.titleBarPolicy; delete old.capabilities.textWrapPolicy; old.capabilities.operations = old.capabilities.operations.filter(op => op !== 'set-text-wrap'); old.capabilities.operations = old.capabilities.operations.filter(op => op !== 'set-title-bar'); old.capabilities.operations = old.capabilities.operations.filter(op => op !== 'set-button-font-size'); delete old.capabilities.buttonStylePolicy;
  old.capabilities.operations = old.capabilities.operations.filter(op => !['set-row-order', 'set-text', 'set-button-style'].includes(op));
  delete old.sha256; old.sha256 = await digestJson(old); assert.deepEqual(await validatePanelEditContext(old), old);
  const oldSchema = await buildCodexEditResponseSchema({ draft: true, context: old });
  assert(!JSON.stringify(oldSchema).includes('set-button-style'));
  await assert.rejects(materializeCodexEditDraft(old, { ...draft, contextSha256: old.sha256 }), /EDIT_PATCH/);
  const forged = structuredClone(proposal); forged.decisions[0].basis = { kind: 'design-choice', reason: '自作主张' };
  await assert.rejects(checkPanelEditProposal(c, forged), /request evidence/);
});

test('styles survive composition namespace remapping and Unity keeps the same geometry and event binding', async () => {
  const a = await changed([orderOp, styleOp({ backgroundColor: '#7C3AED', width: 80, height: 80 })]);
  const b = await createPanelBundle({ ...a.spec, id: 'other-player' }, catalog, core);
  const request = { panelCompositionRequestVersion: '0.1', id: 'two-players', title: '播放器组合', sources: [{ namespace: 'first', bundleSha256: a.sha256 }, { namespace: 'second', bundleSha256: b.sha256 }],
    layout: 'column', width: 420, canvasWidth: 484, canvasHeight: 640, maxHeight: 560, surfaceFrom: null };
  const composition = await composePanelBundles(request, [a, b], core); await validatePanelComposition(composition, [a, b], core);
  assert.equal(composition.bundle.spec.panelSpecVersion, '0.10'); assert.equal(composition.bundle.spec.buttonStyles.length, 2);
  assert.equal(buttons(composition.bundle).filter(n => n.layout.width === 80).length, 2);
  const unity = await createUnityDocument(a, core), node = unity.nodes.find(n => n.id === controlId(spec.id, 'transport1'));
  assert.equal(node.width, 80); assert.equal(node.cornerRadius, 40); assert.equal(node.backgroundColor, '#7C3AED');
  assert.deepEqual([...unity.controls].sort((a,b)=>a.nodeId.localeCompare(b.nodeId)), [...(await createUnityDocument(source, core)).controls].sort((a,b)=>a.nodeId.localeCompare(b.nodeId)));
});

test('local styles retain live form state and count toward the same persistent ten-round limit', async () => {
  const s = structuredClone(role); s.sections.push(section); s.layout.body.children.push({ kind: 'section', sectionId: section.id, width: 'fill' });
  const b = await createPanelBundle(s, catalog, core, { row0: '蓝莓玩家' }), model = await createWorkbenchModel({ catalog, pool: null }, core);
  await model.importPanel(b);
  for (let i = 0; i < 10; i++) await model.patch(await patch(model.getSnapshot().panel.spec, [styleOp({ backgroundColor: i % 2 ? '#112233' : '#445566' })]));
  assert.deepEqual(model.getSnapshot().panel.state, b.state); assert.equal(model.getEditBudget().used, 10);
  await model.undo(); await model.importPanel(await model.exportPanel());
  await assert.rejects(model.patch(await patch(model.getSnapshot().panel.spec, [styleOp(null)])), /WORKBENCH_EDIT_LIMIT/); model.dispose();
});

const generationRequest = { ...roleRequest, id: 'generated-player', text: '生成音乐播放器：上一首、播放、下一首分别用⏮、⏯、⏭表示，三个56像素圆形按钮横向居中，间距16，只发出点击事件。' };
const generationContext = await createPlanningContext(generationRequest, catalog, undefined, { actionLayouts: true });
function playerIntent(c = generationContext) {
  return { panelIntentVersion: '0.9', contextSha256: c.sha256, unresolved: [], panel: { id: c.request.id, title: '音乐播放器', themeKey: `${catalog.themes[0].id}@${catalog.themes[0].version}`, panelSurface: null,
    layout: { width: null, canvasWidth: null, canvasHeight: null, maxHeight: null, overflow: 'auto' }, body: { kind: 'column', children: [{ kind: 'section', title: '播放控制',
      actionLayout: { direction: 'row', align: 'center', gap: 16, buttonWidth: 56, buttonHeight: 56, shape: 'circle', sourceRef: 'request' },
      rows: ['⏮', '⏯', '⏭'].map(label => ({ kind: 'button', label, recipeKey: 'settings.button@0.1.0', sourceRef: 'request', icon: null, enabled: true, action: 'emit', resetRows: [], submitRows: [] })),
    }] } } };
}

test('opt-in generation supports native circles while old context and intent remain byte compatible', async () => {
  assert.equal(legacyContext.planningContextVersion, '0.7'); assert.equal(generationContext.planningContextVersion, '0.8');
  assert.deepEqual(await validatePlanningContext(generationContext), generationContext);
  const schema = buildNativePanelIntentResponseSchema(generationContext);
  assert.deepEqual(schema.properties.panelIntentVersion.enum, ['0.9']); assert(schema.$defs.body.anyOf[0].required.includes('actionLayout'));
  const intent = playerIntent(), proposal = await materializePanelIntent(generationContext, intent); validateNativePanelIntentEvidence(generationContext, intent);
  assert.equal(proposal.spec.panelSpecVersion, '0.9'); assert.deepEqual(proposal.spec.sections[0].rows.map(r => r.id), ['row0', 'row1', 'row2']);
  assert(proposal.decisions.some(d => d.target === 'action-layout:section0' && d.basis.quote === generationRequest.text));
  const b = await validatePanelBundle(await createPanelBundle(proposal.spec, catalog, core), core);
  assert.equal(new Set(buttons(b).map(n => n.layout.y)).size, 1); assert(buttons(b).every(n => n.layout.width === 56 && n.props.style.cornerRadius === 28));
  assert.deepEqual(await materializePanelIntent(legacyContext, roleIntent(legacyContext)), await materializePanelIntent(legacyContext, roleIntent(legacyContext)));
  await assert.rejects(materializePanelIntent(legacyContext, { ...intent, contextSha256: legacyContext.sha256 }), /INTENT_VERSION/);
});

test('ordinary initial panels use explicit null action layout without upgrading saved Spec', async () => {
  const c = await createPlanningContext(roleRequest, catalog, undefined, { actionLayouts: true }), intent = roleIntent(c);
  intent.panelIntentVersion = '0.9'; intent.panel.body.children[0].actionLayout = null;
  const p = await materializePanelIntent(c, intent); validateNativePanelIntentEvidence(c, intent);
  assert.deepEqual(p.spec, role); assert.throws(() => validateNativePanelIntentEvidence(c, roleIntent(c)), /INTENT_VERSION/);
});

test('native 0.9 dispatch excludes blank section titles before model inference', () => {
  const current = buildNativePanelIntentResponseSchema(generationContext).$defs.body.anyOf[0].properties.title;
  assert.equal(current.minLength, 1); assert.equal(current.maxLength, 120); assert.equal(current.pattern, '\\S');
  assert(current.description.includes('separate from a row label'));
  assert(new RegExp(current.pattern).test('播放控制'));
  for (const blank of ['', '   ', '\t\n']) assert.equal(new RegExp(current.pattern).test(blank), false);
});

test('blank native section title remains a terminal validation failure without inserted text', async () => {
  const intent = playerIntent(); intent.panel.body.children[0].title = '';
  const before = structuredClone(intent);
  await assert.rejects(materializePanelIntent(generationContext, intent), error => error.code === 'text' && error.path === '$.panel.sections[0].title');
  assert.deepEqual(intent, before);
  const valid = playerIntent(); assert.equal((await materializePanelIntent(generationContext, valid)).spec.sections[0].title, '播放控制');
});

test('old native 0.8 response schema retains its saved section title contract', () => {
  const old = buildNativePanelIntentResponseSchema(legacyContext).$defs.body.anyOf[0].properties.title;
  assert.equal(old.minLength, undefined); assert.equal(old.pattern, undefined);
  assert.equal(old.description, 'A section heading inside the panel. Setting this heading does not replace the overall panel.title.');
});

test('initial explicit button sizes participate in auto width instead of overflowing a narrow default', async () => {
  const intent = playerIntent(); Object.assign(intent.panel.body.children[0].actionLayout, { buttonWidth: 140, buttonHeight: 140 });
  const b = await createPanelBundle((await materializePanelIntent(generationContext, intent)).spec, catalog, core);
  assert(b.spec.layout.width >= 140 * 3 + 16 * 2 + 48); assert(buttons(b).every(n => n.layout.width === 140));
  const narrow = structuredClone(intent); narrow.panel.layout.width = 300; await assert.rejects(materializePanelIntent(generationContext, narrow), /exceeds/);
});

for (const [name, mutate] of [['wrong source', s => { s.actionLayout.sourceRef = 'old'; }], ['missing field', s => { delete s.actionLayout; }],
  ['ellipse', s => { s.actionLayout.buttonHeight = 44; }], ['mixed section', s => { s.rows[0] = { ...roleIntent(legacyContext).panel.body.children[0].rows[0] }; }]])
  test(`initial arrangement rejects ${name} without rewriting the request or response`, async () => {
    const intent = playerIntent(); mutate(intent.panel.body.children[0]); const before = structuredClone(intent);
    await assert.rejects(materializePanelIntent(generationContext, intent)); assert.deepEqual(intent, before);
  });

test('Studio prepares the new native contract without submitting a model request', async () => {
  const model = await createWorkbenchModel({ catalog, pool: null }, core);
  const prepared = await model.prepare(generationRequest);
  assert.equal(prepared.context.planningContextVersion, '0.9');
  assert.deepEqual(buildNativePanelIntentResponseSchema(prepared.context).properties.panelIntentVersion.enum, ['0.10']); model.dispose();
});

test('new public schemas and reachable native style branches resolve every referenced definition', async () => {
  const schemas = await Promise.all((await readdir(new URL('../schemas/', import.meta.url))).filter(file=>file.endsWith('.json')).map(async file=>JSON.parse(await readFile(new URL('../schemas/'+file,import.meta.url),'utf8'))));
  const registry = new Map(schemas.map(schema=>[schema.$id,schema]));
  const visit=(value,owner)=>{if(!value||typeof value!=='object')return;if(value.$ref){const[id,fragment='']=value.$ref.split('#');let target=id?registry.get(id):owner;for(const part of fragment.split('/').slice(1))target=target?.[part.replaceAll('~1','/').replaceAll('~0','~')];assert(target,value.$ref);}Object.values(value).forEach(child=>visit(child,owner));};
  schemas.forEach(schema=>visit(schema,schema));
  const b=await changed([styleOp({backgroundColor:'#7C3AED',width:80,height:80})]);
  const c=await createPanelEditContext(b.spec,catalog,{...roleRequest,text:'播放键改为蓝色，其他不变。'});
  const native=await buildCodexEditResponseSchema({draft:true,context:c});visit(native,native);
  const style=Object.values(native.$defs).find(shape=>shape.properties?.op?.enum?.[0]==='set-button-style');
  assert(style);assert.deepEqual(style.required,['op','rowId','style']);
  assert.equal(registry.get('urn:ai-game-assets:panel-spec:0.10').properties.panelSpecVersion.const,'0.10');
  assert.equal(registry.get('urn:ai-game-assets:panel-edit-context:0.4').properties.editContextVersion.const,'0.4');
  assert(registry.get('urn:ai-game-assets:panel-proposal:0.8').properties.spec.oneOf.some(s=>s.$ref==='urn:ai-game-assets:panel-spec:0.9'));
});

test('a taller first form-footer button reserves enough group height for every sibling', async () => {
  const b = await createPanelBundle(role, catalog, core);
  const op = { ...styleOp({ width: 120, height: 100, shape: 'default' }), rowId: 'row1' };
  const after = await changed([op], b), nodes = buttons(after);
  const group = nodesOf(after.componentBundle.document).find(n=>n.id===role.id+'.section.'+role.sections[0].id);
  assert.equal(nodes[0].layout.height, 100);
  assert.equal(nodes[0].layout.y+nodes[0].layout.height/2, nodes[1].layout.y+nodes[1].layout.height/2);
  assert(nodes.every(n=>n.layout.y+n.layout.height<=group.layout.height));
});
