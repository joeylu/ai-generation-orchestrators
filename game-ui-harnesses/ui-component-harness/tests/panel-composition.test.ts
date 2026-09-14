import test from 'node:test';
import assert from 'node:assert/strict';
import { secondBatchAppearanceFixture } from './helpers/second-batch-appearance-fixture.ts';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { validateBundle } from '../src/bundle.ts';

test('Panel accepts a single complete frame and keeps its semantic title layout', async () => {
  const f = await secondBatchAppearanceFixture();
  const binding = structuredClone(f.binding) as any;
  const row = binding.bindings.find((b: any) => b.componentType === 'Panel');
  row.parts = row.parts.filter((p: any) => p.role === 'background');
  const applied = await applyAppearanceBinding(f.target, f.imported, binding);
  await validateBundle(JSON.parse(JSON.stringify(applied)));
  const panel = (applied.document.root as any).children.find((n: any) => n.type === 'Panel');
  assert.equal(panel.props.appearance.header, undefined);
  assert.equal(panel.props.appearance.body, undefined);
  assert.equal(panel.props.title, 'Profile');
  assert.deepEqual(panel.props.appearance.titleLayout, {x:12,y:6,width:196,height:24});
  const malformed = structuredClone(applied) as any;
  malformed.document.root.children.find((n: any) => n.type === 'Panel').props.appearance.header = {};
  await assert.rejects(() => validateBundle(malformed));
});

test('legacy independent Panel header and body remain supported', async () => {
  const f = await secondBatchAppearanceFixture();
  const applied = await applyAppearanceBinding(f.target, f.imported, f.binding);
  await validateBundle(applied);
  const panel = (applied.document.root as any).children.find((n: any) => n.type === 'Panel');
  assert.ok(panel.props.appearance.header.image);
  assert.ok(panel.props.appearance.body.image);
});
