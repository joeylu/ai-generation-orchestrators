import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessError } from '../src/contract.ts';
import { compileTree, validateTreeIntent, validateTreePolicy, type TreeIntent, type TreePolicy } from '../src/tree-compiler.ts';

function inputs(): { intent: TreeIntent; policy: TreePolicy; facts: Record<string, { width: number; height: number }> } {
  const style = { backgroundColor: '#FFFFFF', borderColor: '#113355', borderWidth: 1, cornerRadius: 4, textColor: '#001122', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal' as const, opacity: 1 };
  const intent: TreeIntent = { intentVersion: '0.2', id: 'compiler-document', root: {
    id: 'root', componentType: 'Container', props: { style }, children: [
      { id: 'image', componentType: 'Image', props: { source: 'assets/icon.png', fit: 'contain', style } },
      { id: 'button', componentType: 'Button', props: { label: '', enabled: true, style }, children: [
        { id: 'button-label', componentType: 'Text', props: { text: 'Save', wrap: 'none', overflow: 'error', lineHeight: 20, style } },
      ] },
      { id: 'tabs', componentType: 'Tabs', props: { activeId: 'tab-info', tabs: [{ id: 'tab-info', label: 'Info', contentId: 'page-info' }], enabled: true, style }, children: [
        { id: 'page-info', componentType: 'Container', props: { style }, children: [] },
      ] },
    ],
  } };
  const layout: TreePolicy['layout'] = {
    root: { x: 0, y: 0, width: 1000, height: 800 }, image: { x: 10, y: 10, width: 80, height: 40 },
    button: { x: 100, y: 10, width: 100, height: 40 }, 'button-label': { x: 8, y: 8, width: 84, height: 24 },
    tabs: { x: 10, y: 70, width: 300, height: 180 }, 'page-info': { x: 8, y: 40, width: 280, height: 130 },
  };
  return {
    intent,
    policy: { canvas: { width: 1000, height: 800 }, layout, layoutSource: { kind: 'measured', description: 'Measured against the supplied engineering fixture.' } },
    facts: { 'assets/icon.png': { width: 64, height: 32 } },
  };
}

function expectStage(run: () => unknown, stage: HarnessError['stage'], code: string, path?: string): void {
  assert.throws(run, (error: unknown) => error instanceof HarnessError && error.stage === stage
    && error.issues.some(issue => issue.code === code && (path === undefined || issue.path === path)));
}

test('tree compiler is deterministic, preserves inputs, and returns all explicit layouts', () => {
  const { intent, policy, facts } = inputs();
  const before = structuredClone([intent, policy, facts]);
  const first = compileTree(intent, facts, policy);
  const second = compileTree(intent, facts, policy);
  assert.deepEqual(second, first);
  assert.equal(first.root.type, 'Container');
  assert.equal(first.root.children[0].props.source, 'assets/icon.png');
  assert.deepEqual([intent, policy, facts], before);
  first.root.layout.width = 1;
  assert.equal(second.root.layout.width, 1000);
});

test('intent forbids layout, Unresolved, Custom, missing composites, and source path guesses', () => {
  const cases: Array<[string, (intent: any) => void, string, string]> = [
    ['layout in intent', intent => intent.root.children[0].layout = { x: 0, y: 0, width: 1, height: 1 }, 'UNSUPPORTED_FIELD', '$intent.root.children[0].layout'],
    ['unresolved component', intent => intent.root.children[0].componentType = 'Unresolved', 'UNRESOLVED_INTENT', '$intent.root.children[0].componentType'],
    ['custom component', intent => intent.root.children[0].componentType = 'Custom', 'UNSUPPORTED_TYPE', '$intent.root.children[0].componentType'],
    ['missing button children', intent => delete intent.root.children[1].children, 'REQUIRED', '$intent.root.children[1].children'],
    ['unsafe resource', intent => intent.root.children[0].props.source = 'file:///private.png', 'INVALID_RESOURCE_REFERENCE', '$intent.root.children[0].props.source'],
  ];
  for (const [, mutate, code, path] of cases) {
    const { intent } = inputs(); mutate(intent);
    expectStage(() => validateTreeIntent(intent), 'intent', code, path);
  }
});

test('policy requires provenance and exactly one finite layout for each renderable node', () => {
  const missing = inputs(); delete missing.policy.layout.button;
  expectStage(() => compileTree(missing.intent, missing.facts, missing.policy), 'compile', 'MISSING_LAYOUT', '$policy.layout["button"]');

  const extra = inputs(); extra.policy.layout.ghost = { x: 0, y: 0, width: 1, height: 1 };
  expectStage(() => compileTree(extra.intent, extra.facts, extra.policy), 'compile', 'UNUSED_LAYOUT', '$policy.layout["ghost"]');

  const invalid = inputs(); invalid.policy.layoutSource.kind = 'automatic' as never;
  expectStage(() => validateTreePolicy(invalid.policy), 'compile', 'UNSUPPORTED_VALUE', '$policy.layoutSource.kind');

  const nonfinite = inputs(); nonfinite.policy.layout.image.width = Infinity;
  expectStage(() => validateTreePolicy(nonfinite.policy), 'compile', 'INVALID_NUMBER', '$policy.layout["image"].width');
});

test('image facts are source-keyed actual decode facts and regions are checked against their bounds', () => {
  const missing = inputs(); delete missing.facts['assets/icon.png'];
  expectStage(() => compileTree(missing.intent, missing.facts, missing.policy), 'compile', 'MISSING_IMAGE_FACTS');

  const extra = inputs(); extra.facts['assets/unused.png'] = { width: 1, height: 1 };
  expectStage(() => compileTree(extra.intent, extra.facts, extra.policy), 'compile', 'UNUSED_IMAGE_FACTS');

  const invalidDimensions = inputs(); invalidDimensions.facts['assets/icon.png'].height = 1.5;
  expectStage(() => compileTree(invalidDimensions.intent, invalidDimensions.facts, invalidDimensions.policy), 'compile', 'INVALID_IMAGE_FACT');

  const cropped = inputs(); cropped.intent.root.children[0].props.region = { x: 48, y: 0, width: 20, height: 20 };
  expectStage(() => compileTree(cropped.intent, cropped.facts, cropped.policy), 'compile', 'IMAGE_REGION_OUT_OF_BOUNDS');
});
