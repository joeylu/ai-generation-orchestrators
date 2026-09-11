import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { validateAppearanceBinding } from '../src/appearance-binding.ts';
import { appearanceApplicationFixture } from './helpers/appearance-application-fixture.ts';
import { secondBatchAppearanceFixture } from './helpers/second-batch-appearance-fixture.ts';

for (const [type, state, field, factory] of [
  ['Select', 'select', 'fieldTextColor', appearanceApplicationFixture],
  ['Tabs', 'tabs', 'activeTextColor', secondBatchAppearanceFixture],
] as const) {
  test(`${type} state color accepts only exact hex, preserves defaults and passes through`, async () => {
    const fixture = await factory();
    for (const color of [undefined, '#FFF8DF', '#abc', '#aBcDeF']) {
      const binding = structuredClone(fixture.binding) as any;
      const row = binding.bindings.find((r: any) => r.componentType === type);
      if (color === undefined) delete row.states[state][field]; else row.states[state][field] = color;
      const applied = await applyAppearanceBinding(fixture.target, fixture.imported, binding);
      const node = (applied.document.root as any).children.find((n: any) => n.type === type);
      assert.equal(node.props.appearance[field], color);
      assert.equal(Object.hasOwn(node.props.appearance, field), color !== undefined);
      assert.deepEqual(node.props.style, (fixture.document.root as any).children.find((n: any) => n.type === type).props.style);
    }
    for (const color of [null, true, 1, 'white', '#1234', '#12345678', '#fff\n', ' #fff', '#GGG']) {
      const binding = structuredClone(fixture.binding) as any;
      binding.bindings.find((r: any) => r.componentType === type).states[state][field] = color;
      await assert.rejects(() => validateAppearanceBinding(binding, fixture.document, fixture.imported));
    }
  });
}
