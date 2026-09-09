import test from 'node:test';
import assert from 'node:assert/strict';
import { walkNodes } from '../src/tree-contract.ts';
import {
  compileSemanticObservation,
  NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1,
  validateNeutralSemanticPreviewPolicy,
} from '../src/vision-semantic-compiler.ts';

const source = { path: 'assets/reference.png', sha256: 'a'.repeat(64), width: 500, height: 400 };

function component(
  id: string,
  parentId: string | null,
  componentType: string,
  visibleProps: Record<string, unknown>,
  x: number,
  y: number,
  width = 80,
  height = 30,
) {
  return {
    id, parentId, componentType, bounds: { x, y, width, height },
    evidence: `Visible ${componentType} semantics.`, visibleProps,
  };
}

/** One source-visible instance of every v0.2 semantic type. */
function allTypes() {
  return {
    version: '0.2', sourceSha256: source.sha256, status: 'Observed', summary: 'Every supported semantic component is visibly represented.', components: [
      component('root', null, 'Container', {}, 0, 0, 500, 400),
      component('image', 'root', 'Image', {}, 10.2, 20.8, 20.01, 20),
      component('text', 'root', 'Text', { text: '' }, 40, 20),
      component('button', 'root', 'Button', { label: '' }, 130, 20),
      component('switch', 'root', 'Switch', { label: '', checked: false }, 220, 20),
      component('checkbox', 'root', 'CheckBox', { label: '', checked: false }, 310, 20),
      component('radio', 'root', 'RadioGroup', { selectedId: null, options: [{ id: 'r-one', label: 'One' }] }, 10, 70),
      component('input', 'root', 'Input', { value: '', placeholder: '', inputType: 'text' }, 100, 70),
      component('select', 'root', 'Select', { selectedId: null, options: [{ id: 's-one', label: 'One' }] }, 190, 70),
      component('progress', 'root', 'ProgressBar', { value: 0, max: 1 }, 280, 70),
      component('progress-label', 'progress', 'Text', { text: '0 / 1' }, 300, 76, 40, 12),
      component('slider', 'root', 'Slider', { value: 0.12, min: 0.1, max: 0.15 }, 10, 120),
      component('scroll', 'root', 'ScrollView', {}, 100, 120, 90, 60),
      component('scroll-button', 'scroll', 'Button', { label: 'Visible child' }, 110, 145, 120, 30),
      component('list', 'root', 'List', { selectedId: null, items: [{ id: 'item-one', label: 'One' }, { id: 'item-two', label: 'Two' }] }, 200, 120, 80, 60),
      component('panel', 'root', 'Panel', { title: '' }, 290, 120),
      component('dialog', 'root', 'Dialog', { open: false, title: '' }, 380, 120),
      component('tabs', 'root', 'Tabs', { activeId: 'tab-one', tabs: [{ id: 'tab-one', label: 'Visible' }] }, 10, 210),
    ],
  };
}

function withoutTabs() {
  const observation = allTypes();
  observation.components = observation.components.filter(component => component.id !== 'tabs');
  return observation;
}

test('neutral policy is deeply immutable and requires an explicit exact policy argument', () => {
  assert.equal(Object.isFrozen(NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1), true);
  assert.equal(Object.isFrozen(NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1.style), true);
  assert.equal(Object.isFrozen(NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1.interactive.input), true);
  assert.equal(validateNeutralSemanticPreviewPolicy(structuredClone(NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1)), NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1);

  const malformed = structuredClone(NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1);
  malformed.style.textColor = '#FFFFFF';
  assert.throws(() => validateNeutralSemanticPreviewPolicy(malformed), /SEMANTIC_PREVIEW_POLICY_INVALID/);
});

test('compiler preserves every observed semantic value, uses only disclosed neutral preview choices, and does not mutate input', () => {
  const observation = withoutTabs(), before = structuredClone(observation);
  const result = compileSemanticObservation(observation, source, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1);
  assert.equal(result.status, 'Ready');
  assert.deepEqual(observation, before);
  if (result.status !== 'Ready') return;

  const nodes = new Map(walkNodes(result.document).map(node => [node.id, node]));
  assert.equal(result.document.id, 'semantic-preview');
  assert.equal(nodes.get('button')?.props.enabled, true);
  assert.deepEqual(nodes.get('input')?.props, {
    value: '', placeholder: '', inputType: 'text', readOnly: false, maxLength: 1024, enabled: true,
    style: NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1.style,
  });
  assert.equal(nodes.get('dialog')?.props.modal, false);
  assert.equal(nodes.get('text')?.props.wrap, 'word');
  assert.equal(nodes.get('text')?.props.overflow, 'clip');
  assert.equal(nodes.get('slider')?.props.step, 0.01);
  assert.deepEqual(nodes.get('scroll')?.props, {
    scrollX: 0, scrollY: 0, contentWidth: 130, contentHeight: 60,
    style: NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1.style,
  });
  assert.equal(nodes.get('list')?.props.itemHeight, 30);
  assert.deepEqual(nodes.get('image')?.props.region, { x: 10, y: 20, width: 21, height: 21 });
  assert.deepEqual(nodes.get('image')?.layout, { x: 10.2, y: 20.8, width: 20.01, height: 20 });

  const root = result.document.root;
  assert.equal(root.type, 'Container');
  if (root.type === 'Container') {
    // Text semantically owned by ProgressBar is legal source semantics but is
    // flattened to ProgressBar's render parent because ProgressBar is a leaf.
    const label = root.children.find(node => node.id === 'progress-label');
    assert.deepEqual(label?.layout, { x: 300, y: 76, width: 40, height: 12 });
  }
  assert.equal(result.previewPolicy.disclosure.includes('cannot recover'), true);
});

test('tabs never receive invented content placeholders and block as Unresolved', () => {
  const result = compileSemanticObservation(allTypes(), source, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1);
  assert.equal(result.status, 'Unresolved');
  if (result.status === 'Ready') return;
  assert.deepEqual(result.missing, [{
    componentId: 'tabs', field: 'tabs.contentId',
    reason: 'Visible tab labels do not establish tab content; hidden content cannot be represented by a placeholder.',
  }]);
  assert.equal('document' in result, false);
});

test('missing facts are aggregated, while observed false and empty values remain valid', () => {
  const observation = {
    version: '0.2', sourceSha256: source.sha256, status: 'Observed', summary: 'Several facts are not visible.', components: [
      component('root', null, 'Container', {}, 0, 0, 500, 400),
      component('input', 'root', 'Input', {}, 10, 10),
      component('slider', 'root', 'Slider', { value: 0 }, 10, 50),
      component('dialog', 'root', 'Dialog', { open: false }, 10, 90),
      component('panel', 'root', 'Panel', {}, 10, 130),
    ],
  };
  const result = compileSemanticObservation(observation, source, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1);
  assert.equal(result.status, 'Unresolved');
  if (result.status === 'Ready') return;
  assert.deepEqual(result.missing.map(item => `${item.componentId}.${item.field}`), [
    'input.value', 'input.placeholder', 'input.inputType', 'slider.min', 'slider.max', 'dialog.title', 'panel.title',
  ]);
});

test('malformed sources and duplicate observation IDs fail closed before a document can be created', () => {
  assert.throws(() => compileSemanticObservation(withoutTabs(), { ...source, width: 0 }, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1), /VISION_INVALID_OBSERVATION/);
  const oversized = withoutTabs();
  oversized.components[0].bounds.width = 5000;
  assert.throws(() => compileSemanticObservation(oversized, { ...source, width: 5000 }, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1), /SEMANTIC_COMPILER_CANVAS_LIMIT/);
  const duplicate = withoutTabs();
  duplicate.components.push(structuredClone(duplicate.components[0]));
  assert.throws(() => compileSemanticObservation(duplicate, source, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1), /VISION_OBSERVATION_DUPLICATE_ID/);
});

test('wrapper and document IDs are deterministic and avoid observed IDs and semantic entry IDs', () => {
  const observation = {
    version: '0.2', sourceSha256: source.sha256, status: 'Observed', summary: 'Two independent observed controls are visible.', components: [
      component('semantic-preview', null, 'CheckBox', { label: '', checked: false }, 10, 10),
      component('semantic-preview-root', null, 'RadioGroup', { selectedId: null, options: [{ id: 'semantic-preview-2', label: 'One' }] }, 120, 10),
    ],
  };
  const first = compileSemanticObservation(observation, source, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1);
  const second = compileSemanticObservation(observation, source, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1);
  assert.equal(first.status, 'Ready');
  assert.deepEqual(second, first);
  if (first.status !== 'Ready') return;
  assert.equal(first.document.id, 'semantic-preview-3');
  assert.equal(first.document.root.id, 'semantic-preview-root-2');
  assert.deepEqual(first.document.root.type === 'Container' ? first.document.root.children.map(node => node.id) : [], [
    'semantic-preview', 'semantic-preview-root',
  ]);
});

test('a sole observed leaf receives one deterministic wrapper child without changing its identity', () => {
  const observation = {
    version: '0.2', sourceSha256: source.sha256, status: 'Observed', summary: 'One unchecked choice is visible.', components: [
      component('leaf', null, 'CheckBox', { label: '', checked: false }, 10, 10),
    ],
  };
  const result = compileSemanticObservation(observation, source, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1);
  assert.equal(result.status, 'Ready');
  if (result.status !== 'Ready' || result.document.root.type !== 'Container') return;
  assert.equal(result.document.root.id, 'semantic-preview-root');
  assert.deepEqual(result.document.root.children.map(node => node.id), ['leaf']);
  assert.deepEqual(result.document.root.children[0]?.layout, { x: 10, y: 10, width: 80, height: 30 });
});
