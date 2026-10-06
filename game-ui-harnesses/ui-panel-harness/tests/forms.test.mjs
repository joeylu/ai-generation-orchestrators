import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../src/io.mjs';
import { formRequest, formIntent } from '../examples/forms-v1/fixture.mjs';
import { formEditRequest, formEditDraft } from '../examples/forms-v1/edit-fixture.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { buildCodexEditResponseSchema } from '../src/codex-edit-schema.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent, buildPanelIntentResponseSchema } from '../src/panel-intent.mjs';
import { validatePanelSpec, validatePanelState } from '../src/spec.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { createPanelEditContext, validatePanelEditContext } from '../src/edit-planning.mjs';
import { attachPanelSession, projectPanelEvent } from '../src/state.mjs';
import { controlId } from '../src/compiler.mjs';
import { formErrors, formErrorId } from '../src/forms.mjs';
import { digestJson } from '../src/canonical.mjs';
import { composePanelBundles } from '../src/panel-composition.mjs';
import { boundedEditorText } from '../src/input-editor.mjs';
import { PANEL_EVALUATION_SUITE } from '../examples/panel-evaluation/suite.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { evaluateRecipeHits, evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
const catalog = await readJson(new URL('../examples/modern-mint-forms.catalog.json', import.meta.url));
const core = await loadWorkspaceCore(), context = await createPlanningContext(formRequest, catalog);
const proposal = await materializePanelIntent(context, formIntent(context)), spec = proposal.spec;
const bundle = await createPanelBundle(spec, catalog, core);
const rows = s => s.sections.flatMap(section => section.rows);
const event = (id, type, value) => ({ id: controlId(spec.id, id), type, source: 'keyboard', ...(value === undefined ? {} : { value }) });
const patch = operations => ({ patchVersion: '0.1', baseSpecSha256: '', reason: 'Explicit fixture edits.', operations });

test('input editor clips paste and IME on Unicode boundaries and rejects malformed text', () => {
  assert.equal(boundedEditorText('名😀',2,'旧名'),'名');
  assert.equal(boundedEditorText('名😀',3,'旧名'),'名😀');
  assert.equal(boundedEditorText(' 中文 ',12,'旧名'),' 中文 ');
  assert.equal(boundedEditorText('x\n',12,'旧名'),'旧名');
  assert.equal(boundedEditorText('\uD800',12,'旧名'),'旧名');
});

test('the sixteen existing requests compile through form-capable intent and compose with an input form', async () => {
  for (const item of PANEL_EVALUATION_SUITE.cases) {
    const context = await createPlanningContext(item.request,catalog);
    assert.equal(evaluateRecipeHits(context,item.expected).status,'PASS',item.id);
    const intent=compactIntentFixture(context,item); intent.panelIntentVersion='0.6';
    const visit=node=>{if(node.kind==='section'){for(const row of node.rows)if(row.kind==='button')row.submitRows=[];}else node.children.forEach(visit);};visit(intent.panel.body);
    const proposal=await materializePanelIntent(context,intent);
    assert.equal(evaluatePanelSemantics(proposal.spec,item.expected).status,'PASS',item.id);
    const existing=await createPanelBundle(proposal.spec,catalog,core);await validatePanelBundle(existing,core);
    const result=await composePanelBundles({panelCompositionRequestVersion:'0.1',id:'with-form',title:'表单组合',sources:[{namespace:'existing',bundleSha256:existing.sha256},{namespace:'form',bundleSha256:bundle.sha256}],layout:'tabs',width:null,canvasWidth:null,canvasHeight:null,maxHeight:480,surfaceFrom:null},[existing,bundle],core);
    await validatePanelBundle(result.bundle,core);
    assert.deepEqual(rows(result.bundle.spec).find(row=>row.id==='form_r_row1').action.fields,['form_f_row0']);
  }
});
test('input intent pins version, creates string state and scoped submit without changing old catalogs', async () => {
  assert.equal(context.planningContextVersion, '0.7'); assert.equal(bundle.compilerVersion, '0.7.0');
  assert.equal(buildPanelIntentResponseSchema(context).properties.panelIntentVersion.enum[0], '0.7');
  assert.equal(bundle.panelBundleVersion, '0.7'); assert.deepEqual(await validatePanelBundle(bundle, core), bundle);
  assert.deepEqual(spec.state, [{ id: 'row0', type: 'string', initial: '', maxLength: 12 }]);
  assert.deepEqual(rows(spec)[1].action, { kind: 'submit', fields: ['row0'] });
  const old = await readJson(new URL('../examples/modern-mint-tabs.catalog.json', import.meta.url));
  assert.equal((await createPlanningContext(formRequest, old)).planningContextVersion, '0.6');
  const ordinary = structuredClone(spec); ordinary.panelSpecVersion = '0.6';
  assert.throws(() => validatePanelSpec(ordinary), { code: 'state-type' });
});
test('string snapshots retain spaces, Chinese and emoji but reject overflow, multiline and malformed Unicode', () => {
  assert.deepEqual(validatePanelState(spec, { row0: ' 小蓝莓😀 ' }), { row0: ' 小蓝莓😀 ' });
  for (const row0 of ['x'.repeat(13), 'a\nb', '\ud800', 'a\u2028b', 42, null]) assert.throws(() => validatePanelState(spec, { row0 }));
  for (const mutate of [s => { s.state[0].maxLength = 0; }, s => { rows(s)[0].validation.minLength = 13; },
    s => { rows(s)[1].action.fields = ['missing']; }, s => { rows(s)[0].inputType = 'number'; }]) {
    const invalid = structuredClone(spec); mutate(invalid); assert.throws(() => validatePanelSpec(invalid));
  }
});
test('required and minimum checks gate only submit and preserve exact raw text in host events', () => {
  assert.equal(formErrors(spec, { row0: '  ' }).row0, 'required');
  assert.equal(formErrors(spec, { row0: ' 蓝 ' }).row0, 'min-length');
  assert.equal(projectPanelEvent(spec, { row0: '' }, event('row1', 'activate')).event, null);
  assert.equal(projectPanelEvent(spec, { row0: '蓝' }, event('row1', 'activate')).event, null);
  const submitted = projectPanelEvent(spec, { row0: ' 小蓝莓 ' }, event('row1', 'activate'));
  assert.deepEqual(submitted.event.values, { row0: ' 小蓝莓 ' }); assert.equal(submitted.event.action, 'submit');
  const cancelled = projectPanelEvent(spec, submitted.state, event('row2', 'activate'));
  assert.deepEqual(cancelled.state, submitted.state); assert.equal(cancelled.event.action, 'emit');
  const readOnly = structuredClone(spec); rows(readOnly)[0].readOnly = true;
  assert.deepEqual(projectPanelEvent(readOnly, { row0: '小蓝莓' }, event('row0', 'change', '其他名字')).state, { row0: '小蓝莓' });
});
test('session shows appropriate errors, updates submit availability and retains locks on host updates', () => {
  const document = structuredClone(bundle.componentBundle.document), nodes = new Map();
  const visit = n => { nodes.set(n.id, n); for (const child of n.children ?? []) visit(child); }; visit(document.root);
  let listener; const visible = new Map();
  const runtime = { getDocument: () => document, subscribe: f => { listener = f; return () => { listener = null; }; },
    setValue(id, value) { nodes.get(id).props.value = value; listener?.({ id, type: 'change', source: 'control', value }); },
    setVisible(id, value) { assert(nodes.has(id)); visible.set(id, value); }, setEnabled(id, value) { nodes.get(id).props.enabled = value; } };
  const events = [], session = attachPanelSession(spec, runtime, e => events.push(e), bundle.state);
  assert.equal(visible.get(formErrorId(spec.id, 'row0', 'required')), true);
  session.setState({ row0: '蓝' }); assert.equal(visible.get(formErrorId(spec.id, 'row0', 'min-length')), true);
  assert.equal(nodes.get(controlId(spec.id, 'row1')).props.enabled, false);
  session.setInteractionLocked(true); session.setState({ row0: '小蓝莓' });
  assert.equal(nodes.get(controlId(spec.id, 'row1')).props.enabled, false);
  session.setInteractionLocked(false); assert.equal(nodes.get(controlId(spec.id, 'row1')).props.enabled, true);
  assert.deepEqual(events, []); assert.equal(visible.get(formErrorId(spec.id, 'row0', 'required')), false);
  listener(event('row1', 'activate')); assert.equal(events[0].action, 'submit');
  session.destroy(); assert.equal(listener, null);
});
test('input edits are bounded, keep identities and reject dependency removal or conflicting limits', async () => {
  const ctx = await createPanelEditContext(spec, catalog, { ...formRequest, text: '输入长度上限改成16，其余保持。' });
  assert(ctx.capabilities.operations.includes('set-input-properties')); assert.deepEqual(await validatePanelEditContext(ctx), ctx);
  const input = rows(spec)[0], operation = { op: 'set-input-properties', rowId: input.id, placeholder: input.placeholder,
    inputType: input.inputType, readOnly: input.readOnly, maxLength: 16, validation: input.validation };
  const p = patch([operation]); p.baseSpecSha256 = await digestJson(spec);
  const edited = await applyPanelPatch(spec, p); assert.equal(edited.spec.state[0].maxLength, 16);
  assert.equal(rows(edited.spec)[0].bind, input.bind); await createPanelBundle(edited.spec, catalog, core, { row0: '小蓝莓' });
  for (const operations of [[{ op: 'remove-row', rowId: 'row0' }], [operation, operation], [{ ...operation, maxLength: 1 }]]) {
    const invalid = patch(operations); invalid.baseSpecSha256 = p.baseSpecSha256; await assert.rejects(applyPanelPatch(spec, invalid));
  }
});

test('form edit transport lowers the actual declaration request atomically and preserves input and cancel behavior', async () => {
  const ctx = await createPanelEditContext(spec, catalog, { ...formRequest, text: formEditRequest });
  const draft = formEditDraft(ctx), before = structuredClone(draft);
  const proposal = await materializeCodexEditDraft(ctx, draft);
  assert.deepEqual(draft, before);
  assert.equal(proposal.patch.operations.length, draft.patch.operations.length);
  const edited = (await applyPanelPatch(spec, proposal.patch)).spec;
  assert.equal(edited.id, spec.id); assert.deepEqual(edited.layout, spec.layout); assert.deepEqual(edited.canvas, spec.canvas);
  assert.deepEqual(rows(edited).map(row => row.id), ['row0', 'declaration', 'row1', 'row2']);
  assert.equal(edited.state.find(field => field.id === 'row0').maxLength, 16);
  assert.deepEqual(rows(edited).find(row => row.id === 'row2'), rows(spec).find(row => row.id === 'row2'));
  const compiled = await createPanelBundle(edited, catalog, core, { row0: ' 小蓝莓😀 ', declaration: '勇敢前行' });
  await validatePanelBundle(compiled, core);
  const state = compiled.state;
  const submitted = projectPanelEvent(edited, state, event('row1', 'activate'));
  assert.deepEqual(submitted.event.values, { row0: ' 小蓝莓😀 ', declaration: '勇敢前行' });
  assert.deepEqual(projectPanelEvent(edited, state, event('row2', 'activate')).state, state);
  assert.equal(projectPanelEvent(edited, { ...state, declaration: '' }, event('row1', 'activate')).event.action, 'submit');
  assert.equal(projectPanelEvent(edited, { ...state, row0: '蓝' }, event('row1', 'activate')).event, null);
});

test('form edit transport rejects invalid values and references rather than repairing or accepting them', async () => {
  const ctx = await createPanelEditContext(spec, catalog, { ...formRequest, text: formEditRequest });
  for (const mutate of [
    d => { d.patch.operations[1].recipeKey = 'settings.slider@0.1.0'; },
    d => { d.patch.operations[1].id = 'row0'; },
    d => { d.patch.operations[1].initial = 'x'.repeat(31); },
    d => { d.patch.operations[1].initial = 'x\ny'; },
    d => { d.patch.operations[1].minLength = 31; },
    d => { d.patch.operations[1].maxLength = '30'; },
    d => { d.patch.operations[1].required = 'false'; },
    d => { d.patch.operations[1].validationMessages = { requiredMessage: '', minLengthMessage: '' }; },
    d => { d.patch.operations[1].bind = 'another-field'; },
    d => { d.patch.operations[2].action.fields = ['row0', 'missing']; },
    d => { d.patch.baseSpecSha256 = '0'.repeat(64); },
    d => { d.bases[1].quote = '不在需求中'; },
  ]) {
    const draft = formEditDraft(ctx); mutate(draft); const unchanged = structuredClone(ctx);
    await assert.rejects(materializeCodexEditDraft(ctx, draft)); assert.deepEqual(ctx, unchanged);
  }
  const custom = formEditDraft(ctx);
  custom.patch.operations[1].validationMessages = { requiredMessage: '请填写宣言', minLengthMessage: '宣言太短' };
  assert.equal((await materializeCodexEditDraft(ctx, custom)).patch.operations[1].row.validation.requiredMessage, '请填写宣言');
  const longSpec = { ...spec, id: 'p'.repeat(64) };
  const longContext = await createPanelEditContext(longSpec, catalog, { ...formRequest, text: formEditRequest });
  const longDraft = formEditDraft(longContext), longId = 'd'.repeat(64);
  longDraft.patch.operations[1].id = longId;
  longDraft.patch.operations[2].action.fields = ['row0', longId];
  assert.equal((await materializeCodexEditDraft(longContext, longDraft)).patch.operations[1].row.event, `panel.${longId}`);
  const raw = formEditDraft(ctx);
  raw.patch.operations[1] = (await materializeCodexEditDraft(ctx, raw)).patch.operations[1];
  await assert.rejects(materializeCodexEditDraft(ctx, raw), { code: 'EDIT_FIELDS' });
  const old = { ...spec, panelSpecVersion: '0.6', sections: [{ id: spec.sections[0].id, title: '旧面板', rows: [rows(spec)[2]] }], state: [], tabs: null };
  const oldContext = await createPanelEditContext(old, catalog, { ...formRequest, text: formEditRequest });
  await assert.rejects(materializeCodexEditDraft(oldContext, { ...formEditDraft(ctx), contextSha256: oldContext.sha256 }), { code: 'EDIT_PROPOSAL_VERSION' });
});

test('current native edit schema selects compact input additions only for form contexts', async () => {
  const ctx = await createPanelEditContext(spec, catalog, { ...formRequest, text: formEditRequest });
  const native = await buildCodexEditResponseSchema({ draft: true, context: ctx });
  assert.deepEqual(native.properties.codexEditDraftVersion.enum, ['0.3']);
  const shapes = Object.values(native.$defs), input = shapes.find(shape => shape.properties?.op?.enum?.[0] === 'add-input-row');
  assert(input); assert(!input.required.includes('state')); assert(!input.required.includes('bind')); assert(!input.required.includes('event'));
  assert.deepEqual(input.properties.recipeKey.enum, ['forms.input@0.1.0']);
  assert(!shapes.some(shape => shape.properties?.kind?.enum?.[0] === 'input'));
  const visit = shape => {
    if (!shape || typeof shape !== 'object') return;
    if (shape.$ref) assert(shape.$ref.startsWith('#/$defs/'));
    if (shape.type === 'object') { assert.equal(shape.additionalProperties, false); assert.deepEqual(shape.required, Object.keys(shape.properties)); }
    Object.values(shape).forEach(value => Array.isArray(value) ? value.forEach(visit) : visit(value));
  }; visit(native);
  const older = await buildCodexEditResponseSchema({ draft: true });
  assert.deepEqual(older.properties.codexEditDraftVersion.enum, ['0.3']);
  assert(!Object.values(older.$defs).some(shape => shape.properties?.op?.enum?.[0] === 'add-input-row'));
});
test('composed form namespaces isolate validation, submit payloads and raw current values', async () => {
  const sourceA = await createPanelBundle(spec, catalog, core, { row0: '小蓝莓' });
  const sourceB = await createPanelBundle({ ...spec, id: 'second-form' }, catalog, core, { row0: '' });
  const combined = await composePanelBundles({ panelCompositionRequestVersion: '0.1', id: 'form-pages', title: '组合表单',
    sources: [{ namespace: 'a', bundleSha256: sourceA.sha256 }, { namespace: 'b', bundleSha256: sourceB.sha256 }],
    layout: 'tabs', width: null, canvasWidth: null, canvasHeight: null, maxHeight: 560, surfaceFrom: null }, [sourceA, sourceB], core);
  const b = combined.bundle; assert.equal(b.spec.panelSpecVersion, '0.7');
  assert.deepEqual(rows(b.spec).find(r => r.id === 'a_r_row1').action.fields, ['a_f_row0']);
  const submit = projectPanelEvent(b.spec, b.state, { id: controlId(b.spec.id, 'a_r_row1'), type: 'activate', source: 'keyboard' });
  assert.deepEqual(submit.event.values, { a_f_row0: '小蓝莓' }); assert.equal(submit.state.b_f_row0, '');
  const hidden = projectPanelEvent(b.spec, b.state, {id:controlId(b.spec.id,'b_r_row0'),type:'change',source:'keyboard',value:'隐藏输入'});
  assert.equal(hidden.event,null); assert.deepEqual(hidden.state,b.state);
});
