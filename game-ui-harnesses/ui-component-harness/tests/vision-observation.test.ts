import test from 'node:test';
import assert from 'node:assert/strict';
import { compileStagedVisionResult, OBSERVATION_ERROR_CODES, validateObservation } from '../src/vision-observation.ts';

const source = { path: 'assets/reference.png', sha256: 'a'.repeat(64), width: 200, height: 100 };
const style = {
  id: 'base', backgroundColor: '#FFFFFF', borderColor: '#000000', borderWidth: 1, cornerRadius: 0,
  textColor: '#000000', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1,
};
function component(id: string, parentId: string | null, componentType: string, visibleProps: Record<string, unknown>, bounds = { x: 0, y: 0, width: 100, height: 40 }) {
  return { id, parentId, componentType, bounds, evidence: `Visible ${componentType} outline and text.`, visibleProps };
}
function observation() {
  return {
    version: '0.1', sourceSha256: source.sha256, status: 'Observed', summary: 'A framed action is visible.', components: [
      component('root', null, 'Container', {}, { x: 0, y: 0, width: 200, height: 100 }),
      component('action', 'root', 'Button', { label: 'Continue' }, { x: 20, y: 20, width: 120, height: 48 }),
    ],
  };
}
function semanticObservation() {
  return {
    version: '0.2', sourceSha256: source.sha256, status: 'Observed', summary: 'A meter and its visible label are present.', components: [
      component('root', null, 'Container', {}, { x: 0, y: 0, width: 200, height: 100 }),
      component('meter', 'root', 'ProgressBar', { value: 75, max: 100 }, { x: 20, y: 20, width: 120, height: 20 }),
      component('meter-label', 'meter', 'Text', { text: '75%' }, { x: 70, y: 22, width: 30, height: 16 }),
    ],
  };
}
function contract() {
  return {
    version: '0.2', sourceSha256: source.sha256, status: 'Ready', summary: 'A framed action is visible.',
    classification: 'composite', observedTypes: ['Container', 'Button'], documentId: 'observed-action', canvas: { width: 200, height: 100 }, styles: [style], nodes: [
      { id: 'root', parentId: null, componentType: 'Container', styleId: 'base', props: {}, layout: { x: 0, y: 0, width: 200, height: 100 } },
      { id: 'action', parentId: 'root', componentType: 'Button', styleId: 'base', props: { label: 'Continue', enabled: true }, layout: { x: 20, y: 20, width: 120, height: 48 } },
    ],
  };
}
function staged(status: 'Ready' | 'Unresolved' | 'Custom-required' = 'Ready') {
  return { version: '0.3', sourceSha256: source.sha256, status, summary: 'Staged semantic result.', observation: observation(), contract: contract() as unknown };
}

test('observation accepts bounded visible facts without defaults or mutation', () => {
  const value = observation(), before = structuredClone(value);
  const result = validateObservation(value, source);
  assert.equal(result.status, 'Observed');
  assert.deepEqual(value, before);
  assert.equal(OBSERVATION_ERROR_CODES.includes('VISION_OBSERVATION_PROPS_MISMATCH'), true);
});

test('observation rejects hidden properties, source-bound violations, bounds, and invalid graph references', () => {
  const hidden = observation(); hidden.components[1].visibleProps.enabled = true;
  assert.throws(() => validateObservation(hidden, source), /VISION_INVALID_OBSERVATION/);
  const bounds = observation(); bounds.components[1].bounds.width = 500;
  assert.throws(() => validateObservation(bounds, source), /VISION_OBSERVATION_BOUNDS_INVALID/);
  const parent = observation(); parent.components[1].parentId = 'missing';
  assert.throws(() => validateObservation(parent, source), /VISION_OBSERVATION_UNKNOWN_PARENT/);
  const cycle = observation(); cycle.components.push(component('other', 'action', 'Container', {})); cycle.components[1].parentId = 'other';
  assert.throws(() => validateObservation(cycle, source), /VISION_OBSERVATION_CYCLE/);
  const stale = observation(); stale.sourceSha256 = 'b'.repeat(64);
  assert.throws(() => validateObservation(stale, source), /VISION_INVALID_OBSERVATION/);
});

test('v0.2 observation contains only source-visible semantics and permits semantic leaf parents', () => {
  assert.equal(validateObservation(semanticObservation(), source).status, 'Observed');

  const v0_1LeafParent = observation();
  v0_1LeafParent.components[1] = component('meter', 'root', 'ProgressBar', { value: 75, max: 100 });
  v0_1LeafParent.components.push(component('meter-label', 'meter', 'Text', { text: '75%' }));
  assert.throws(() => validateObservation(v0_1LeafParent, source), /VISION_OBSERVATION_PARENT_NOT_COMPOSITE/);

  for (const [type, props] of [
    ['Image', { fit: 'contain' }], ['Image', { region: { x: 0, y: 0, width: 1, height: 1 } }],
    ['Text', { text: 'Label', wrap: 'word' }], ['Text', { text: 'Label', overflow: 'ellipsis' }], ['Text', { text: 'Label', lineHeight: 20 }],
    ['Slider', { min: 0, max: 10, value: 4, step: 1 }],
    ['ScrollView', { scrollX: 1 }], ['ScrollView', { contentWidth: 100 }],
  ] as const) {
    const candidate = semanticObservation();
    candidate.components[1] = component('candidate', 'root', type, props);
    candidate.components.splice(2, 1);
    assert.throws(() => validateObservation(candidate, source), /VISION_INVALID_OBSERVATION/);
  }

  const semanticSlider = semanticObservation();
  semanticSlider.components[1] = component('slider', 'root', 'Slider', { min: 0, max: 10, value: 4 });
  semanticSlider.components.splice(2, 1);
  assert.equal(validateObservation(semanticSlider, source).status, 'Observed');
  const semanticScroll = semanticObservation();
  semanticScroll.components[1] = component('scroll', 'root', 'ScrollView', {});
  semanticScroll.components.splice(2, 1);
  assert.equal(validateObservation(semanticScroll, source).status, 'Observed');
});

test('observation rejects non-finite and contradictory visible numeric facts without supplying defaults', () => {
  const nonNumericValue = observation();
  nonNumericValue.components[1] = component('meter', 'root', 'ProgressBar', { value: 'ten' });
  assert.throws(() => validateObservation(nonNumericValue, source), /VISION_INVALID_OBSERVATION/);
  const nonNumericMin = observation();
  nonNumericMin.components[1] = component('slider', 'root', 'Slider', { min: Number.NaN });
  assert.throws(() => validateObservation(nonNumericMin, source), /VISION_INVALID_OBSERVATION/);
  const exceedsMax = observation();
  exceedsMax.components[1] = component('meter', 'root', 'ProgressBar', { value: 11, max: 10 });
  assert.throws(() => validateObservation(exceedsMax, source), /VISION_INVALID_OBSERVATION/);
  const outOfRange = observation();
  outOfRange.components[1] = component('slider', 'root', 'Slider', { value: 2, min: 3, max: 8, step: 1 });
  assert.throws(() => validateObservation(outOfRange, source), /VISION_INVALID_OBSERVATION/);
  const invalidStep = observation();
  invalidStep.components[1] = component('slider', 'root', 'Slider', { value: 3, min: 0, step: 2 });
  assert.throws(() => validateObservation(invalidStep, source), /VISION_INVALID_OBSERVATION/);
  const observedNegativeRange = observation();
  observedNegativeRange.components[1] = component('slider', 'root', 'Slider', { value: -4, min: -10, max: -2, step: 2 });
  assert.equal(validateObservation(observedNegativeRange, source).status, 'Observed');
});

test('observation keeps option, item, and tab IDs globally distinct from component IDs and validates selected references', () => {
  const componentCollision = observation();
  componentCollision.components[1] = component('select', 'root', 'Select', { options: [{ id: 'root', label: 'Root' }] });
  assert.throws(() => validateObservation(componentCollision, source), /VISION_INVALID_OBSERVATION/);
  const entryCollision = observation();
  entryCollision.components[1] = component('select', 'root', 'Select', { options: [{ id: 'shared', label: 'Shared' }] });
  entryCollision.components.push(component('list', 'root', 'List', { items: [{ id: 'shared', label: 'Shared' }] }));
  assert.throws(() => validateObservation(entryCollision, source), /VISION_INVALID_OBSERVATION/);
  const missingSelection = observation();
  missingSelection.components[1] = component('select', 'root', 'Select', { selectedId: 'absent', options: [{ id: 'present', label: 'Present' }] });
  assert.throws(() => validateObservation(missingSelection, source), /VISION_INVALID_OBSERVATION/);
  const missingActiveTab = observation();
  missingActiveTab.components[1] = component('tabs', 'root', 'Tabs', { activeId: 'absent', tabs: [{ id: 'present', label: 'Present' }] });
  assert.throws(() => validateObservation(missingActiveTab, source), /VISION_INVALID_OBSERVATION/);
});

test('observed Image regions must remain within the source image', () => {
  const outside = observation();
  outside.components[1] = component('image', 'root', 'Image', { region: { x: 199, y: 0, width: 2, height: 1 } });
  assert.throws(() => validateObservation(outside, source), /VISION_OBSERVATION_BOUNDS_INVALID/);
});

test('staged Ready compiles only after observed identities, visible props, and parents bind', () => {
  const result = compileStagedVisionResult(staged(), source);
  assert.equal(result.status, 'Ready');
  if (result.status === 'Ready') assert.equal(result.document.root.id, 'root');

  const props = staged(); (props.contract as ReturnType<typeof contract>).nodes[1].props.label = 'Different';
  assert.throws(() => compileStagedVisionResult(props, source), /VISION_OBSERVATION_PROPS_MISMATCH/);
  const missing = staged(); (missing.contract as ReturnType<typeof contract>).nodes = [(missing.contract as ReturnType<typeof contract>).nodes[0]];
  (missing.contract as ReturnType<typeof contract>).observedTypes = ['Container'];
  assert.throws(() => compileStagedVisionResult(missing, source), /VISION_OBSERVATION_MISSING_NODE/);
  const type = staged(); (type.contract as ReturnType<typeof contract>).nodes[1] = { ...((type.contract as ReturnType<typeof contract>).nodes[1]), componentType: 'Switch', props: { label: 'Continue', checked: false, enabled: true } };
  (type.contract as ReturnType<typeof contract>).observedTypes = ['Container', 'Switch'];
  assert.throws(() => compileStagedVisionResult(type, source), /VISION_OBSERVATION_TYPE_MISMATCH/);
});

test('binding permits only extra Containers between observed parents and rejects extra semantic nodes', () => {
  const throughContainer = staged();
  const data = throughContainer.contract as ReturnType<typeof contract>;
  data.nodes.splice(1, 0, { id: 'wrapper', parentId: 'root', componentType: 'Container', styleId: 'base', props: {}, layout: { x: 10, y: 10, width: 160, height: 70 } });
  data.nodes[2].parentId = 'wrapper'; data.observedTypes = ['Container', 'Button'];
  assert.equal(compileStagedVisionResult(throughContainer, source).status, 'Ready');

  const extraControl = staged();
  (extraControl.contract as ReturnType<typeof contract>).nodes.push({ id: 'extra', parentId: 'root', componentType: 'Switch', styleId: 'base', props: { label: 'Extra', checked: false, enabled: true }, layout: { x: 1, y: 1, width: 20, height: 20 } });
  (extraControl.contract as ReturnType<typeof contract>).observedTypes = ['Container', 'Button', 'Switch'];
  assert.throws(() => compileStagedVisionResult(extraControl, source), /VISION_OBSERVATION_EXTRA_NODE/);
});

test('v0.2 binding flattens only semantic leaf parenting into its same render parent', () => {
  const semantic = semanticObservation();
  const value = staged();
  value.observation = semantic;
  const data = value.contract as ReturnType<typeof contract>;
  data.summary = semantic.summary;
  data.nodes = [
    data.nodes[0],
    { id: 'meter', parentId: 'root', componentType: 'ProgressBar', styleId: 'base', props: { value: 75, max: 100 }, layout: { x: 20, y: 20, width: 120, height: 20 } },
    { id: 'meter-label', parentId: 'root', componentType: 'Text', styleId: 'base', props: { text: '75%', wrap: 'none', overflow: 'clip', lineHeight: 16 }, layout: { x: 70, y: 22, width: 30, height: 16 } },
  ];
  data.observedTypes = ['Container', 'ProgressBar', 'Text'];
  assert.equal(compileStagedVisionResult(value, source).status, 'Ready');

  const throughHelper = structuredClone(value);
  const helperData = throughHelper.contract as ReturnType<typeof contract>;
  helperData.nodes.splice(1, 0, { id: 'semantic-helper', parentId: 'root', componentType: 'Container', styleId: 'base', props: {}, layout: { x: 10, y: 10, width: 140, height: 40 } });
  helperData.nodes.find(node => node.id === 'meter')!.parentId = 'semantic-helper';
  helperData.nodes.find(node => node.id === 'meter-label')!.parentId = 'semantic-helper';
  assert.equal(compileStagedVisionResult(throughHelper, source).status, 'Ready');

  const unrelated = structuredClone(value);
  const unrelatedData = unrelated.contract as ReturnType<typeof contract>;
  unrelatedData.nodes.splice(1, 0, { id: 'other-panel', parentId: 'root', componentType: 'Panel', styleId: 'base', props: { title: 'Other' }, layout: { x: 150, y: 10, width: 40, height: 60 } });
  unrelatedData.nodes.find(node => node.id === 'meter-label')!.parentId = 'other-panel';
  unrelatedData.observedTypes = ['Container', 'Panel', 'ProgressBar', 'Text'];
  assert.throws(() => compileStagedVisionResult(unrelated, source), /VISION_OBSERVATION_PARENT_MISMATCH/);
});

test('staged non-ready values have one valid provenance path', () => {
  const fromObservation = staged('Unresolved');
  fromObservation.observation = { version: '0.1', sourceSha256: source.sha256, status: 'Unresolved', summary: 'State is obscured.' };
  fromObservation.contract = null;
  assert.deepEqual(compileStagedVisionResult(fromObservation, source), { status: 'Unresolved', summary: fromObservation.summary });

  const fromContract = staged('Custom-required');
  fromContract.contract = { version: '0.2', sourceSha256: source.sha256, status: 'Custom-required', summary: 'Custom rendering is required.' };
  assert.deepEqual(compileStagedVisionResult(fromContract, source), { status: 'Custom-required', summary: fromContract.summary });
  const invalid = staged('Unresolved'); invalid.contract = null;
  assert.throws(() => compileStagedVisionResult(invalid, source), /VISION_INVALID_STAGED_RESULT/);
});
