import test from 'node:test';
import assert from 'node:assert/strict';
import { createLegacyLayeredCase } from '../scripts/legacy-layered-case.mjs';
import { legacyLayeredFixtureZip } from './helpers/legacy-layered-fixture.mjs';

const plan = { documentId: 'settings-reconstruction', backgroundColor: '#FFFFFF', buttons: [{ layerId: 'cancel', label: '取消' }, { layerId: 'confirm', label: '确定' }, { layerId: 'close', label: '关闭' }] };
test('legacy case uses only explicit Button mappings and preserves remaining PNG layers and legacy provenance', async () => {
  const result = await createLegacyLayeredCase(legacyLayeredFixtureZip(), plan);
  const nodes = result.bundle.document.root.children;
  assert.deepEqual(nodes.filter(node => node.type === 'Button').map(node => node.id), ['layer-cancel', 'layer-confirm', 'layer-close']);
  for (const node of nodes) {
    if (node.type === 'Image') assert.equal(node.props.drawBackground, false);
    else assert.ok(result.bundle.resources.some(resource => resource.path === node.props.backgroundImage));
  }
  assert.equal(result.report.status, 'compiled_not_browser_validated');
  assert.equal(result.report.businessActions, 'NOT_WIRED');
  assert.match(result.bundle.provenance.description, /experimental_ui_layered_export_delivery_v1/);
  assert.deepEqual(plan.buttons.map(button => button.layerId), ['cancel', 'confirm', 'close']);
});
test('legacy case rejects unknown or duplicate mappings and never guesses control roles from layer names', async () => {
  const bytes = legacyLayeredFixtureZip();
  await assert.rejects(createLegacyLayeredCase(bytes, { ...plan, buttons: [{ layerId: 'unknown', label: '' }] }), /CASE_BUTTON_LAYER_NOT_FOUND/);
  await assert.rejects(createLegacyLayeredCase(bytes, { ...plan, buttons: [plan.buttons[0], plan.buttons[0]] }), /CASE_BUTTON_INVALID/);
  const one = await createLegacyLayeredCase(bytes, { ...plan, buttons: [plan.buttons[0]] });
  assert.equal(one.bundle.document.root.children.find(node => node.id === 'layer-confirm').type, 'Image');
});
