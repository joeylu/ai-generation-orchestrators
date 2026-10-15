import test from 'node:test';
import assert from 'node:assert/strict';
import { editorData, presetDocument } from '../src/panel/data.mjs';
import { attachBackground } from '../src/panel/backgrounds.mjs';
import { validateDocument, resourceClosure } from '../src/panel/document.mjs';
import { validateBackgroundPackage, encodePng, decodePng, backgroundGeometry } from '../src/slicing/package.mjs';

const ctx = await editorData();
const sample = () => presetDocument(ctx.presets.presets[0], ctx);
const pack = () => ({ kind: 'ui_panel_background', version: '1.0', defaultMultiplier: 2,
  asset: { source: { sha256: 'a'.repeat(64), width: 128, height: 96 }, density: 2,
    bordersPx: { left: 17, top: 12, right: 24, bottom: 20 }, pngBase64: encodePng(new Uint8Array(48)) } });
test('Panel background package keeps source pixels separate from instance dimensions and multiplier', () => {
  const p = validateBackgroundPackage(pack());
  const g = backgroundGeometry(p.asset, { width: 400, height: 250 }, p.defaultMultiplier);
  assert.equal(g.borders.left, 8.5); assert.equal(g.multiplier, 2);
  assert.deepEqual(decodePng(p.asset.pngBase64), new Uint8Array(48));
  for (const change of [p => p.asset.path = 'file.png', p => p.defaultMultiplier = 0, p => p.asset.bordersPx.left = 128, p => p.asset.pngBase64 = '!'.repeat(48)]) {
    const bad = pack(); change(bad); assert.throws(() => validateBackgroundPackage(bad));
  }
});
test('Attaching a background promotes the document, preserves layout and deduplicates shared assets', () => {
  const original = sample(), panel = original.nodes.find(n => n.recipeRef.startsWith('panel@'));
  const attached = validateDocument(attachBackground(original, panel.id, pack()), ctx);
  const twice = validateDocument(attachBackground(attached, panel.id, { ...pack(), defaultMultiplier: 3 }), ctx);
  assert.equal(twice.version, '0.2'); assert.equal(Object.keys(twice.panelBackgrounds).length, 1);
  assert.deepEqual(twice.nodes.find(n => n.id === panel.id).size, panel.size);
  assert.equal(twice.nodes.find(n => n.id === panel.id).props.pixelsPerUnitMultiplier, 3);
  assert.equal(original.panelBackgrounds, undefined);
  assert.deepEqual(resourceClosure(twice, ctx).panelBackgrounds, [{ id: 'background-1', ...pack().asset.source }]);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(twice)), ctx), twice);
});
test('Wrong targets, locked ancestors, missing assets and invalid instance geometry are rejected', () => {
  const doc = sample(), panel = doc.nodes.find(n => n.recipeRef.startsWith('panel@'));
  assert.throws(() => attachBackground(doc, doc.rootId, pack()), { code: 'background.target' });
  const locked = structuredClone(doc); locked.nodes.find(n => n.id === locked.rootId).locked = true;
  assert.throws(() => attachBackground(locked, panel.id, pack()), { code: 'edit.locked' });
  const good = attachBackground(doc, panel.id, pack());
  for (const change of [d => d.version = '0.1', d => delete d.panelBackgrounds['background-1'], d => d.panelBackgrounds['background-1'].extra = true]) {
    const bad = structuredClone(good); change(bad); assert.throws(() => validateDocument(bad, ctx));
  }
  const tiny = structuredClone(good); tiny.nodes.find(n => n.id === panel.id).props.pixelsPerUnitMultiplier = 0.125;
  tiny.panelBackgrounds['background-1'].density = 1; tiny.panelBackgrounds['background-1'].bordersPx.left = 90;
  assert.throws(() => validateDocument(tiny, ctx), { code: 'slice.minimum' });
});
