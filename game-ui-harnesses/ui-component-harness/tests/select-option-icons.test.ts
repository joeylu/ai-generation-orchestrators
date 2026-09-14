import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectOptionIconsFixture } from './helpers/select-option-icons-fixture.ts';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { validateAppearanceBinding, appearanceDocumentSha256 } from '../src/appearance-binding.ts';
import { validateDocument } from '../src/tree-contract.ts';
import { importComponentHandoffWithReview } from '../src/component-handoff.ts';
import { componentHandoffEntries } from '../src/decomposition-import.ts';
import { exportReferenceHandoff, zip } from '../src/reference-persistence.ts';
import { validateBundle, createBundle } from '../src/bundle.ts';

const f = await selectOptionIconsFixture();
const select = (binding: any) => binding.bindings[2].states.select;
const runtime = (doc: any) => doc.root.children[0].props.appearance;

test('Select option IDs, local rectangles and authenticated image resources compile', async () => {
  const result = await importComponentHandoffWithReview(f.zip);
  const icons = runtime(result.bundle.document).optionIcons;
  assert.deepEqual(icons.items.map((i: any) => i.optionId), ['blue','red','green']);
  for (const item of icons.items) assert.ok(result.bundle.resources.some(r => r.path === item.icon.image));
});

for (const [name, mutate, error] of [
  ['version', (s: any) => s.optionIcons.version = '2.0', /UNSUPPORTED_VERSION/],
  ['unknown option', (s: any) => s.optionIcons.items[0].optionId = 'missing', /UNKNOWN_OPTION/],
  ['duplicate', (s: any) => s.optionIcons.items[0].optionId = 'red', /DUPLICATE_OPTION/],
  ['missing item', (s: any) => s.optionIcons.items.pop(), /OPTION_COVERAGE_REQUIRED/],
  ['missing layer', (s: any) => s.optionIcons.items[0].icon.layerId = 'missing', /UNKNOWN_LAYER/],
  ['negative position', (s: any) => s.optionIcons.items[0].icon.layout.x = -1, /INVALID_LAYOUT/],
  ['nonfinite size', (s: any) => s.optionIcons.items[0].icon.layout.width = Infinity, /INVALID_LAYOUT/],
  ['zero height', (s: any) => s.optionIcons.items[0].icon.layout.height = 0, /INVALID_LAYOUT/],
  ['row overflow', (s: any) => s.optionIcons.items[0].icon.layout.y = 40, /OPTION_LAYOUT_OUT_OF_BOUNDS/],
  ['text overlap', (s: any) => s.optionIcons.items[0].labelLayout.x = 20, /OPTION_ICON_TEXT_OVERLAP/],
  ['unsafe area', (s: any) => s.popupContentLayout.x = 100, /POPUP_CONTENT_OUT_OF_BOUNDS/],
  ['no area', (s: any) => delete s.popupContentLayout, /POPUP_CONTENT_REQUIRED/],
  ['coordinates', (s: any) => s.optionIcons.coordinateSpace = 'global', /UNSUPPORTED_COORDINATE_SPACE/],
  ['unknown field', (s: any) => s.optionIcons.script = 'anything', /UNKNOWN_FIELD/],
] as const) test(`Select icon declaration rejects ${name}`, async () => {
  const b = structuredClone(f.binding); mutate(select(b));
  await assert.rejects(validateAppearanceBinding(b, f.document, f.imported), error);
});

test('Explicit null means no icon; legacy iconless binding/document still work', async () => {
  const b = structuredClone(f.binding); select(b).optionIcons.items[0].icon = null;
  const partial = await applyAppearanceBinding(f.target, f.imported, b);
  assert.equal(runtime(partial.document).optionIcons.items[0].icon, null);
  delete select(b).optionIcons;
  const old = await applyAppearanceBinding(f.target, f.imported, b);
  assert.equal(runtime(old.document).optionIcons, undefined);
});

test('Registered scale is applied once to row layouts and references survive order-independent mapping', async () => {
  const document = structuredClone(f.document), binding = structuredClone(f.binding);
  document.canvas = {width:1000,height:800};
  for (const n of [document.root,...document.root.children]) for (const key of ['x','y','width','height']) n.layout[key] *= 2;
  binding.registration.targetCanvas = document.canvas; binding.registration.transform.scale = 2;
  for (const b of binding.bindings) if (b.states) {
    const state = b.states.select ?? b.states.button;
    for (const key of ['x','y','width','height']) state.labelLayout[key] *= 2;
    if (b.states.select) {
      state.popupPlacement.gap *= 2;
      for (const key of ['x','y','width','height']) state.popupContentLayout[key] *= 2;
      for (const item of state.optionIcons.items) for (const rect of [item.labelLayout,item.icon.layout]) for (const key of ['x','y','width','height']) rect[key] *= 2;
    }
  }
  binding.documentSha256 = await appearanceDocumentSha256(document);
  const target = await createBundle(document,[],{kind:'programmatic-fixture',description:'Explicit scale regression'});
  const scaled = await applyAppearanceBinding(target,f.imported,binding), original = await applyAppearanceBinding(f.target,f.imported,f.binding);
  assert.deepEqual(runtime(scaled.document).optionIcons,runtime(original.document).optionIcons);
});

test('Runtime document and bundle reject invalid paths, missing resources and bad digest', async () => {
  const {bundle} = await importComponentHandoffWithReview(f.zip);
  const broken: any = JSON.parse(JSON.stringify(bundle)); delete broken.componentHandoff; broken.bundleVersion = '0.1';
  const icons = runtime(broken.document).optionIcons;
  icons.items[0].icon.image = '../escape.png'; assert.throws(() => validateDocument(broken.document));
  icons.items[0].icon.image = 'missing.png'; await assert.rejects(validateBundle(broken), /RESOURCE|MISSING/);
  const corrupt: any = JSON.parse(JSON.stringify(bundle)); delete corrupt.componentHandoff; corrupt.bundleVersion = '0.1';
  const iconPath = runtime(corrupt.document).optionIcons.items[0].icon.image;
  corrupt.resources.find((r:any)=>r.path===iconPath).sha256 = '0'.repeat(64);
  await assert.rejects(validateBundle(corrupt), /SHA256|HASH|DIGEST|CHECKSUM_MISMATCH/);
  const badRuntime: any = structuredClone(bundle.document); runtime(badRuntime).optionIcons.version='unknown';
  assert.throws(()=>validateDocument(badRuntime),/UNSUPPORTED_VERSION/);
  const bytes = new Map(f.entries); const png = new Uint8Array(bytes.get('reference/original.png')!); png[png.length - 1] ^= 1; bytes.set('reference/original.png', png);
  await assert.rejects(importComponentHandoffWithReview(zip(bytes)), /SHA256|DIGEST/);
  const edited = structuredClone(f.imported); edited.resources[0].bytes[0] ^= 1;
  await assert.rejects(applyAppearanceBinding(f.target, edited, f.binding));
});

test('Save/reopen/export/isolated official CLI preserves icon bytes, state and reference evidence', async () => {
  const {bundle} = await importComponentHandoffWithReview(f.zip);
  const saved: any = JSON.parse(JSON.stringify(bundle)); saved.document.root.children[0].props.selectedId = 'green';
  const output = await exportReferenceHandoff(await validateBundle(saved));
  const before = await componentHandoffEntries(f.zip), after = await componentHandoffEntries(output);
  for (const [name, bytes] of before) if (name !== 'handoff.json') assert.deepEqual(after.get(name), bytes, name);
  const dir = await mkdtemp(join(tmpdir(), 'select-icons-')), input = join(dir, 'only.zip'), target = join(dir, 'imported.json');
  await writeFile(input, output);
  const cli = fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'component-handoff', input, '--output', target], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const round = JSON.parse(await readFile(target, 'utf8'));
  assert.equal(round.document.root.children[0].props.selectedId, 'green');
  assert.deepEqual(runtime(round.document).optionIcons, runtime(bundle.document).optionIcons);
  assert.deepEqual(round.resources, bundle.resources);
});
