import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { appearanceApplicationFixture } from './helpers/appearance-application-fixture.ts';
import { forceZip64Stored } from './helpers/decomposition-fixture.ts';
import { componentHandoffFixture } from './helpers/component-handoff-fixture.ts';
import { importComponentHandoffWithReview } from '../src/component-handoff.ts';
import { replayReferenceState } from '../src/reference-replay.ts';
import { validateReferenceStates, validateReferenceMapping } from '../src/reference-evidence.ts';

const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const sha = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
const observed = (value: unknown) => ({ status: 'observed', value, evidence: 'Offline fixture explicitly declares this visible state.' });
async function fixture(mutate: (v: any) => void = () => {}) {
  const f = await appearanceApplicationFixture();
  const state: any = { kind: 'ui-reference-state', schemaVersion: '1.0', components: [
    { componentId: 'apply-switch', componentType: 'Switch', fields: { checked: observed(true) } },
    { componentId: 'apply-select', componentType: 'Select', fields: { selectedId: observed('low'), popupOpen: observed(true) } },
  ] };
  const scope = { kind: 'ui-acceptance-scope', schemaVersion: '1.0', referenceState: 'reference/reference-state.json',
    human_visual_acceptance: false, derivedTestStates: [], components: ['root', 'apply-button', 'apply-switch', 'apply-select'].map(componentId => ({ componentId, mode: 'compare', reason: 'Fixture coverage' })) };
  const mapping = { coordinateSpace: 'raw-image-pixel-edges-to-runtime-canvas', sourceSize: [500, 400], targetSize: [500, 400], crop: [0, 0, 500, 400], rotationDegrees: 0, flipX: false, flipY: false, scale: [1, 1], offset: [0, 0] };
  const data: any = { state, scope, mapping, original: f.imported.preview.bytes, f };
  mutate(data);
  const members = new Map<string, Uint8Array>([
    ['component.ui-bundle.json', encode(f.target)], ['appearance-binding.json', encode(f.binding)], ['decomposition/fixture.draft.zip', f.fixture.zip],
    ['reference/original.png', data.original], ['reference/reference-state.json', encode(state)], ['acceptance-scope.json', encode(scope)],
  ]);
  const entry = (path: string) => ({ path, sha256: sha(members.get(path)!) });
  const manifest = { kind: 'ai_ui_component_handoff_v2', schemaVersion: '2.0', status: 'contracts_packaged_unreviewed_draft', delivery_policy: 'unreviewed_draft', human_visual_acceptance: false,
    decomposition: entry('decomposition/fixture.draft.zip'), component_bundle: entry('component.ui-bundle.json'), appearance_binding: entry('appearance-binding.json'),
    reference: { original: { ...entry('reference/original.png'), width: 500, height: 400 }, mapping, state: entry('reference/reference-state.json'), scope: entry('acceptance-scope.json'), derivatives: [] } };
  data.after?.(manifest, members);
  members.set('handoff.json', encode(manifest));
  return { zip: forceZip64Stored([...members].map(([name, bytes]) => ({ name, bytes }))), state, scope, document: f.document };
}
test('v2 standalone archive passes official CLI in isolated directory and exposes byte-identical original', async () => {
  const f = await fixture(); const directory = await mkdtemp(join(tmpdir(), 'reference-handoff-'));
  await writeFile(join(directory, 'only.zip'), f.zip);
  const cli = fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'component-handoff', 'only.zip', '--output', 'bundle.json', '--reference-output', 'reference.json'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(await readFile(join(directory, 'reference.json'), 'utf8'));
  assert.equal(receipt.status, 'complete'); assert.equal(receipt.visualComparisonReady, true);
  assert.equal(receipt.humanVisualAcceptance, false);
  for (const file of receipt.files) assert.equal(sha(Buffer.from(file.base64, 'base64')), file.sha256);
  const bundle = JSON.parse(await readFile(join(directory, 'bundle.json'), 'utf8'));
  for (const resource of bundle.resources) assert.equal(sha(Buffer.from(resource.base64, 'base64')), resource.sha256);
});
test('v1 keeps import compatibility and explicitly lacks visual evidence', async () => {
  const result = await importComponentHandoffWithReview(await componentHandoffFixture());
  assert.equal(result.referenceEvidence.status, 'missing_reference_evidence'); assert.equal(result.referenceEvidence.visualComparisonReady, false);
});
for (const [name, mutate, code] of [
  ['missing original', (v: any) => { v.after = (_: any, m: Map<string, unknown>) => m.delete('reference/original.png'); }, 'REFERENCE_MEMBER_MISSING'],
  ['bad digest', (v: any) => { v.after = (m: any) => { m.reference.original.sha256 = '0'.repeat(64); }; }, 'REFERENCE_DIGEST_MISMATCH'],
  ['bad state digest', (v: any) => { v.after = (m: any) => { m.reference.state.sha256 = '0'.repeat(64); }; }, 'REFERENCE_DIGEST_MISMATCH'],
  ['bad scope digest', (v: any) => { v.after = (m: any) => { m.reference.scope.sha256 = '0'.repeat(64); }; }, 'REFERENCE_DIGEST_MISMATCH'],
  ['absolute original path', (v: any) => { v.after = (m: any) => { m.reference.original.path = 'C:/original.png'; }; }, 'REFERENCE_PATH_INVALID'],
  ['unsafe path', (v: any) => { v.after = (m: any) => { m.reference.original.path = '../original.png'; }; }, 'REFERENCE_PATH_INVALID'],
  ['wrong image dimensions', (v: any) => { v.after = (m: any) => { m.reference.original.width = 501; }; }, 'REFERENCE_SIZE_MISMATCH'],
  ['missing transform', (v: any) => { delete v.mapping.rotationDegrees; }, 'REFERENCE_MAPPING_INCOMPLETE'],
  ['overflowing transform', (v: any) => { v.mapping.scale = [2, 1]; }, 'REFERENCE_MAPPING_BOUNDS'],
  ['wrong target', (v: any) => { v.mapping.targetSize = [1, 1]; }, 'REFERENCE_SIZE_MISMATCH'],
  ['nonexistent component', (v: any) => { v.state.components[0].componentId = 'missing'; }, 'REFERENCE_STATE_COMPONENT'],
  ['nonexistent option', (v: any) => { v.state.components[1].fields.selectedId.value = 'missing'; }, 'REFERENCE_STATE_OPTION'],
  ['unknown cannot carry a guessed value', (v: any) => { v.state.components[0].fields.checked = { status: 'unknown', reason: 'Hidden', value: false }; }, 'REFERENCE_STATE_UNKNOWN'],
  ['derived state cannot be reference evidence', (v: any) => { v.state.components[0].fields.checked.status = 'contract-derived'; }, 'REFERENCE_STATE_EVIDENCE'],
  ['missing component state', (v: any) => { v.state.components.pop(); }, 'REFERENCE_STATE_COVERAGE'],
  ['invalid scope reference', (v: any) => { v.scope.components[0].componentId = 'missing'; }, 'ACCEPTANCE_SCOPE_COMPONENT'],
] as const) test(name, async () => {
  const f = await fixture(mutate); await assert.rejects(importComponentHandoffWithReview(f.zip), new RegExp(code));
});
test('unknown is preserved and replay never writes its value; open popup is explicitly replayed', async () => {
  const f = await fixture(v => { v.state.components[0].fields.checked = { status: 'unknown', reason: 'Occluded in original' }; });
  const result = await importComponentHandoffWithReview(f.zip);
  assert.equal(result.referenceEvidence.visualComparisonReady, false);
  const calls: unknown[] = [];
  const replay = replayReferenceState(result.referenceEvidence, { getDocument: () => f.document, setValue: (...args) => calls.push(args), setSelectOpen: (...args) => calls.push(args) });
  assert.deepEqual(calls, [['apply-select', 'low'], ['apply-select', true]]);
  assert.deepEqual(replay.unknownFields, ['apply-switch.checked']);
});
test('all supported reference-state component families validate option/value domains', () => {
  const types: any = { Tabs: { activeId: observed('tab') }, CheckBox: { checked: observed(true) }, Switch: { checked: observed(false) }, RadioGroup: { selectedId: observed('option') }, Select: { selectedId: observed(null), popupOpen: observed(false) }, List: { selectedId: observed('item') }, ScrollView: { scrollX: observed(0), scrollY: observed(20) }, Input: { value: observed('text') }, Slider: { value: observed(5) }, ProgressBar: { value: observed(3) }, Dialog: { open: observed(true) } };
  const children = Object.keys(types).map(type => ({ id: type, type, layout: { width: 100, height: 100 }, props: { tabs: [{ id: 'tab' }], items: [{ id: 'item' }], options: [{ id: 'option' }], min: 0, max: 10, step: 1, maxLength: 20, contentWidth: 100, contentHeight: 200 } }));
  const document = { root: { id: 'root', type: 'Container', children } };
  const state = { kind: 'ui-reference-state', schemaVersion: '1.0', components: children.map(n => ({ componentId: n.id, componentType: n.type, fields: types[n.type] })) };
  const scope = { kind: 'ui-acceptance-scope', schemaVersion: '1.0', referenceState: 'reference/reference-state.json', human_visual_acceptance: false, derivedTestStates: [], components: [document.root, ...children].map(n => ({ componentId: n.id, mode: 'compare', reason: 'Fixture' })) };
  assert.deepEqual(validateReferenceStates(state, scope, document), []);
  state.components.find(n => n.componentType === 'Slider')!.fields.value.value = 5.5;
  assert.throws(() => validateReferenceStates(state, scope, document), /REFERENCE_STATE_VALUE/);
});
test('explicit crop, flip, quarter-turn and scale have bounded output', () => {
  validateReferenceMapping({ coordinateSpace: 'raw-image-pixel-edges-to-runtime-canvas', sourceSize: [300, 200], targetSize: [100, 50], crop: [10, 20, 50, 100], flipX: true, flipY: false, rotationDegrees: 90, scale: [1, 1], offset: [0, 0] }, [300, 200], { width: 100, height: 50 });
});
test('derived reference bytes have independent digest, dimensions and source transform', async () => {
  const f = await fixture(v => { v.after = (m: any, members: Map<string, Uint8Array>) => {
    members.set('reference/derived-1.png', v.original);
    m.reference.derivatives = [{ path: 'reference/derived-1.png', sha256: sha(v.original), width: 500, height: 400, source: 'reference/original.png', mapping: v.mapping }];
  }; });
  const result = await importComponentHandoffWithReview(f.zip);
  assert.equal(result.referenceEvidence.files.length, 4);
  const bad = await fixture(v => { v.after = (m: any, members: Map<string, Uint8Array>) => {
    members.set('reference/derived-1.png', v.original);
    m.reference.derivatives = [{ path: 'reference/derived-1.png', sha256: sha(v.original), width: 500, height: 401, source: 'reference/original.png', mapping: v.mapping }];
  }; });
  await assert.rejects(importComponentHandoffWithReview(bad.zip), /REFERENCE_SIZE_MISMATCH/);
});
