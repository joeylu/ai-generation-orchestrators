import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VISION_PREVIEW_POLICY_V1,
  validateVisionPreviewPolicyV1,
  type PreviewPolicyNode,
} from '../src/vision-preview-policy.ts';

function node(componentType: PreviewPolicyNode['componentType'], props: Record<string, unknown>): PreviewPolicyNode {
  return { componentType, props };
}

test('v1 policy is deeply immutable and identifies non-observed preview configuration', () => {
  assert.equal(VISION_PREVIEW_POLICY_V1.version, 'v1');
  assert.equal(VISION_PREVIEW_POLICY_V1.kind, 'preview-configuration');
  assert.equal(VISION_PREVIEW_POLICY_V1.observedFactDefaults, false);
  assert.equal(VISION_PREVIEW_POLICY_V1.textContentDefaults, false);
  assert.equal(Object.isFrozen(VISION_PREVIEW_POLICY_V1), true);
  assert.equal(Object.isFrozen(VISION_PREVIEW_POLICY_V1.requiredProps), true);
  for (const props of Object.values(VISION_PREVIEW_POLICY_V1.requiredProps)) assert.equal(Object.isFrozen(props), true);
});

test('v1 accepts every policy-owned preview setting when explicitly supplied', () => {
  assert.doesNotThrow(() => validateVisionPreviewPolicyV1([
    node('Button', { label: 'Continue', enabled: true }),
    node('Switch', { label: 'Sound', checked: true, enabled: true }),
    node('CheckBox', { label: 'Terms', checked: false, enabled: true }),
    node('RadioGroup', { selectedId: null, options: [], enabled: true }),
    node('Input', { value: '', placeholder: '', inputType: 'text', enabled: true, readOnly: false, maxLength: 1024 }),
    node('Select', { selectedId: null, options: [], enabled: true }),
    node('Slider', { value: 0.5, min: 0, max: 1, step: 0.1, enabled: true }),
    node('List', { selectedId: null, items: [], itemTemplate: 'text-row', itemHeight: 20, enabled: true }),
    node('Dialog', { open: false, title: '', modal: false }),
    node('Tabs', { activeId: 'main', tabs: [], enabled: true }),
    node('Text', { text: 'Observed label', wrap: 'none', overflow: 'clip', lineHeight: 16 }),
  ]));
});

test('v1 rejects omitted or conflicting preview settings without mutating the supplied nodes', () => {
  const missingEnabled = [node('Button', { label: 'Continue' })];
  assert.throws(() => validateVisionPreviewPolicyV1(missingEnabled), /VISION_PREVIEW_POLICY_VIOLATION/);
  assert.deepEqual(missingEnabled, [node('Button', { label: 'Continue' })]);

  for (const invalid of [
    node('Input', { enabled: true, readOnly: true, maxLength: 1024 }),
    node('Input', { enabled: true, readOnly: false, maxLength: 512 }),
    node('Dialog', { modal: true }),
    node('Text', { text: 'Observed', wrap: 'word', overflow: 'clip' }),
    node('Text', { text: 'Observed', wrap: 'none', overflow: 'ellipsis' }),
    node('Slider', { value: 0.5, min: 0, max: 1, step: 0.25, enabled: false }),
  ]) assert.throws(() => validateVisionPreviewPolicyV1([invalid]), /VISION_PREVIEW_POLICY_VIOLATION/);
});

test('v1 does not prescribe Slider step, Text line height, or content', () => {
  assert.doesNotThrow(() => validateVisionPreviewPolicyV1([
    node('Slider', { value: 0.75, min: 0, max: 1, step: 0.25, enabled: true }),
    node('Text', { text: 'Observed caption', wrap: 'none', overflow: 'clip', lineHeight: 23 }),
  ]));
});
