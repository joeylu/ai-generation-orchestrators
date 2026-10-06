/** Independent semantic oracle for eight dependent edits. No model access. */
import assert from 'node:assert/strict';
import { validatePanelSpec } from '../src/spec.mjs';
import { digestJson } from '../src/canonical.mjs';

const rows = spec => spec.sections.flatMap(section => section.rows);
export function findStressRow(spec, label) {
  const matches = rows(spec).filter(row => (row.kind === 'button' ? row.buttonLabel : row.label) === label);
  assert.equal(matches.length, 1, `Expected unique row: ${label}`);
  return matches[0];
}
function normalized(spec) {
  const copy = structuredClone(spec);
  for (const row of rows(copy)) if (row.action?.kind === 'reset-initial') row.action.fields.sort();
  return copy;
}
export async function checkStressEdit(beforeInput, afterInput, step) {
  const before = validatePanelSpec(beforeInput), after = validatePanelSpec(afterInput), expected = structuredClone(before);
  const main = findStressRow(expected, step.expectation === 'default50' || step.expectation === 'label' ? '主音量' : '总音量');
  const button = rows(expected).find(row => row.kind === 'button');
  assert(button); assert.equal(button.action.kind, 'reset-initial');
  const remove = label => {
    const row = findStressRow(expected, label);
    const section = expected.sections.find(section => section.rows.some(value => value.id === row.id));
    section.rows = section.rows.filter(value => value.id !== row.id);
    expected.state = expected.state.filter(field => field.id !== row.bind);
    if (expected.assets) expected.assets.rowIcons = expected.assets.rowIcons.filter(icon => icon.rowId !== row.id);
    button.action.fields = button.action.fields.filter(id => id !== row.bind);
  };
  switch (step.expectation) {
    case 'default50': expected.state.find(field => field.id === main.bind).initial = 50; break;
    case 'label': main.label = '总音量'; break;
    case 'add': {
      const added = findStressRow(after, '音效音量');
      const field = after.state.find(field => field.id === added.bind);
      assert.equal(added.kind, 'slider'); assert.equal(added.enabled, true);
      assert.deepEqual(added.recipe, { id: 'settings.slider', version: '0.1.0' });
      assert.deepEqual(field, { id: added.bind, type: 'number', min: 0, max: 100, step: 1, initial: 40 });
      assert(!rows(before).some(row => row.id === added.id));
      assert(!before.state.some(value => value.id === added.bind));
      assert(!after.assets?.rowIcons.some(icon => icon.rowId === added.id));
      const section = expected.sections.find(section => section.rows.some(row => row.id === main.id));
      section.rows.splice(section.rows.findIndex(row => row.id === main.id) + 1, 0, structuredClone(added));
      expected.state.push(structuredClone(field));
      break;
    }
    case 'resetAll': button.action.fields = ['总音量', '音效音量', '静音'].map(label => findStressRow(expected, label).bind); break;
    case 'layout': expected.title = '声音选项'; expected.layout.maxHeight = 480; break;
    case 'deleteMute': remove('静音'); break;
    case 'buttonLabel': button.buttonLabel = '恢复声音'; break;
    case 'deleteEffects': remove('音效音量'); break;
    default: throw new Error('STRESS_UNKNOWN_STEP');
  }
  assert.deepEqual(normalized(after), normalized(expected), 'Only requested changes may be applied');
  return { inputStressSemanticVersion: '0.1', status: 'PASS', stepId: step.id,
    beforeSpecSha256: await digestJson(before), afterSpecSha256: await digestJson(after),
    checks: ['requested-business-change', 'all-unmentioned-properties-preserved', 'row-state-and-reset-dependencies'],
    modelCalls: 0, humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' };
}

/** Known legal patches for exercising the driver, explicitly not real-model acceptance. */
export async function stressFixturePatch(spec, step) {
  const main = findStressRow(spec, step.expectation === 'default50' || step.expectation === 'label' ? '主音量' : '总音量');
  const button = rows(spec).find(row => row.kind === 'button');
  let operations;
  switch (step.expectation) {
    case 'default50': operations = [{ op: 'set-state-initial', fieldId: main.bind, value: 50 }]; break;
    case 'label': operations = [{ op: 'set-row-label', rowId: main.id, label: '总音量' }]; break;
    case 'add': {
      const section = spec.sections.find(section => section.rows.some(row => row.id === main.id));
      operations = [{ op: 'add-row', sectionId: section.id, afterRowId: main.id,
        row: { id: 'stress-effects', kind: 'slider', recipe: { id: 'settings.slider', version: '0.1.0' }, label: '音效音量',
          bind: 'stress-effects-value', enabled: true, event: 'panel.stress-effects', format: { fractionDigits: 0, prefix: '', suffix: '' } },
        state: { id: 'stress-effects-value', type: 'number', min: 0, max: 100, step: 1, initial: 40 } }];
      break;
    }
    case 'resetAll': operations = [{ op: 'set-button-action', rowId: button.id,
      action: { kind: 'reset-initial', fields: ['总音量', '音效音量', '静音'].map(label => findStressRow(spec, label).bind) } }]; break;
    case 'layout': operations = [{ op: 'set-panel-title', title: '声音选项' }, { op: 'set-layout', layout: { ...spec.layout, maxHeight: 480 } }]; break;
    case 'deleteMute':
    case 'deleteEffects': {
      const row = findStressRow(spec, step.expectation === 'deleteMute' ? '静音' : '音效音量');
      operations = [{ op: 'set-button-action', rowId: button.id, action: { kind: 'reset-initial', fields: button.action.fields.filter(id => id !== row.bind) } },
        { op: 'remove-row', rowId: row.id }]; break;
    }
    case 'buttonLabel': operations = [{ op: 'set-button-label', rowId: button.id, buttonLabel: '恢复声音' }]; break;
    default: throw new Error('STRESS_UNKNOWN_STEP');
  }
  return { patchVersion: '0.1', baseSpecSha256: await digestJson(spec), reason: 'Driver fixture for the explicit edit request; not model output.', operations };
}
export function stressFixtureProposal(context, patch) {
  return { editProposalVersion: '0.1', contextSha256: context.sha256, patch,
    decisions: patch.operations.map((_, operationIndex) => ({ operationIndex,
      basis: { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text } })), unresolved: [] };
}
