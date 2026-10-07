import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core, nodesOf } from './helpers.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { roleRequest, roleIntent } from '../examples/adaptive-v1/fixture.mjs';
import { digestJson } from '../src/canonical.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { createPanelEditContext, validatePanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { buildCodexEditResponseSchema, codexEditOperationContracts } from '../src/codex-edit-schema.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { projectPanelEvent } from '../src/state.mjs';
import { controlId } from '../src/compiler.mjs';
import { composePanelBundles, validatePanelComposition } from '../src/panel-composition.mjs';
const catalog = JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json', import.meta.url), 'utf8'));
const c = await createPlanningContext(roleRequest, catalog), role = (await materializePanelIntent(c, roleIntent(c))).spec;
const section = { id: 'transport', title: '播放控制', rows: ['⏮', '⏯', '⏭'].map((buttonLabel, index) => ({
  id: `transport${index}`, kind: 'button', recipe: { id: 'settings.button', version: '0.1.0' }, label: '', buttonLabel,
  enabled: true, event: `player.transport${index}`, action: { kind: 'emit' },
})) };
const menu = { ...role, id: 'music-player', title: '音乐播放器', state: [], sections: [section],
 layout: { ...role.layout, body: { ...role.layout.body, children: [{ kind: 'section', sectionId: section.id, width: 'fill' }] } } };
const source = await createPanelBundle(menu, catalog, core);
const layout = { direction: 'row', align: 'center', gap: 16, buttonWidth: 56, buttonHeight: 56, shape: 'circle' };
const operation = value => ({ op: 'set-action-layout', sectionId: section.id, layout: value });
const patch = async (spec, operations) => ({ patchVersion: '0.1', baseSpecSha256: await digestJson(spec), reason: 'Explicit button layout fixture.', operations });
async function changed(value = layout, original = source) {
 const { spec } = await applyPanelPatch(original.spec, await patch(original.spec, [operation(value)]));
 return validatePanelBundle(await createPanelBundle(spec, catalog, core, original.state), core);
}
const buttons = b => nodesOf(b.componentBundle.document).filter(n => n.type === 'Button');

test('three existing glyph buttons become centered circles in one row without changing identities, actions or assets', async () => {
 const b = await changed(), nodes = buttons(b);
 assert.equal(b.spec.panelSpecVersion, '0.9'); assert.equal(b.panelBundleVersion, '0.9'); assert.equal(b.compilerVersion, '0.9.0');
 assert.deepEqual(b.spec.sections, source.spec.sections); assert.deepEqual(b.catalog, source.catalog); assert.deepEqual(b.actions, source.actions);
 assert.deepEqual(b.spec.assets, source.spec.assets); assert.equal(nodes.length, 3);
 assert.equal(new Set(nodes.map(n => n.layout.y)).size, 1);
 for (const n of nodes) { assert.equal(n.layout.width, 56); assert.equal(n.layout.height, 56); assert.equal(n.props.style.cornerRadius, 28); }
 assert.equal(nodes[1].layout.x - nodes[0].layout.x, 72); assert.equal(nodes[2].layout.x - nodes[1].layout.x, 72);
 const group = nodesOf(b.componentBundle.document).find(n => n.id.endsWith('.section.transport'));
 assert.equal(nodes[0].layout.x, (group.layout.width - (56 * 3 + 16 * 2)) / 2);
 for (const row of section.rows) assert.equal(projectPanelEvent(b.spec, b.state, { type: 'activate', id: controlId(b.spec.id, row.id), source: 'mouse' }).event.name, row.event);
});

test('vertical layout and restoring automatic layout replay deterministically without losing the upgraded version', async () => {
 const row = await changed(), col = await changed({ ...layout, direction: 'column', align: 'end' }, row);
 const nodes = buttons(col); assert.equal(new Set(nodes.map(n => n.layout.x)).size, 1); assert(nodes[1].layout.y > nodes[0].layout.y);
 const restored = await changed(null, col); assert.deepEqual(restored.spec.actionLayouts, []);
 assert.deepEqual(buttons(restored).map(n => n.layout), buttons(source).map(n => n.layout));
 assert.deepEqual(await validatePanelBundle(restored, core), restored); assert.deepEqual(await validatePanelBundle(source, core), source);
 const noop = await applyPanelPatch(source.spec, await patch(source.spec, [operation(null)])); assert.deepEqual(noop.spec, source.spec);
});

for (const [name, value] of [ ['ellipse', { ...layout, buttonHeight: 48 }], ['small target', { ...layout, buttonWidth: 20, buttonHeight: 20 }],
 ['fractional dimension', { ...layout, buttonWidth: 56.1 }], ['CSS geometry', { ...layout, buttonWidth: '50%' }],
 ['unknown property', { ...layout, animate: true }], ['spoofed target', { ...layout, sectionId: 'another' }], ['missing shape', { direction:'row', align:'center', gap:16, buttonWidth:56, buttonHeight:56 }] ])
 test(`invalid ${name} fails atomically`, async () => {
  const before = await digestJson(source); await assert.rejects(applyPanelPatch(source.spec, await patch(source.spec, [{ op:'set-panel-title', title:'不可部分应用' }, operation(value)])));
  assert.equal(await digestJson(source), before);
 });

test('overflow, unreadable labels and mixed input sections fail instead of shrinking or reordering', async () => {
 await assert.rejects(changed({ ...layout, buttonWidth: 256, buttonHeight: 256 }), /exceeds/);
 const long = structuredClone(menu); long.sections[0].rows[0].buttonLabel = '这个按钮不能自动省略';
 await assert.rejects(changed(layout, await createPanelBundle(long, catalog, core)), /labels do not fit/);
 await assert.rejects(applyPanelPatch(role, await patch(role, [{ ...operation(layout), sectionId: role.sections[0].id }])), /standalone button/);
 await assert.rejects(applyPanelPatch(menu, await patch(menu, [operation(layout), operation(null)])), /overlaps/);
});

test('the native model schema exposes the real operation and literal edit evidence; saved Context 0.2 still replays unchanged', async () => {
 const request = { requestVersion:'0.1', id:'panel-edit', text:'把现有三个按钮改成1:1圆形，并横向居中排列，其他不变。', target:'pixi' };
 const context = await createPanelEditContext(menu, catalog, request), schema = await buildCodexEditResponseSchema({ draft:true, context });
 assert.equal(context.editContextVersion, '0.8'); assert(context.capabilities.operations.includes('set-action-layout'));
 assert(codexEditOperationContracts(schema, context).some(o => o.operation === 'set-action-layout'));
 const proposal = await materializeCodexEditDraft(context, { codexEditDraftVersion:'0.3', contextSha256:context.sha256,
  patch:await patch(menu, [operation(layout)]), bases:[{kind:'request-interpretation',quote:request.text}], unresolved:[], noChange:null });
 assert.equal((await checkPanelEditProposal(context, proposal)).status, 'READY_TO_APPLY');
 const old = structuredClone(context); old.editContextVersion='0.2'; delete old.selection; delete old.capabilities.buttonFontPolicy; delete old.capabilities.titleBarPolicy; delete old.capabilities.textWrapPolicy; old.capabilities.operations = old.capabilities.operations.filter(op => op !== 'set-text-wrap'); old.capabilities.operations = old.capabilities.operations.filter(op => op !== 'set-title-bar'); old.capabilities.operations = old.capabilities.operations.filter(op => op !== 'set-button-font-size'); old.capabilities.operations=old.capabilities.operations.filter(op=>!['set-action-layout','set-row-order','set-text','set-button-style'].includes(op)); delete old.capabilities.actionLayoutPolicy; delete old.capabilities.buttonStylePolicy; delete old.sha256; old.sha256=await digestJson(old);
 assert.deepEqual(await validatePanelEditContext(old), old);
 const oldSchema=await buildCodexEditResponseSchema({draft:true,context:old}); assert(!JSON.stringify(oldSchema).includes('set-action-layout'));
 const bad = structuredClone(proposal); bad.contextSha256=old.sha256; await assert.rejects(checkPanelEditProposal(old,bad));
 const fabricated=structuredClone(proposal); fabricated.decisions[0].basis={kind:'design-choice',reason:'视觉优化'};
 await assert.rejects(checkPanelEditProposal(context,fabricated), /request evidence/);
});

test('layout edits retain played form text and consume one round; undo and refresh cannot refund the ten-round budget', async () => {
 const spec=structuredClone(role); spec.sections.push(section); spec.layout.body.children.push({kind:'section',sectionId:section.id,width:'fill'});
 const b=await createPanelBundle(spec,catalog,core,{row0:'蓝莓玩家'}), m=await createWorkbenchModel({catalog,pool:null},core); await m.importPanel(b);
 for(let i=0;i<10;i++) await m.patch(await patch(m.getSnapshot().panel.spec,[operation({...layout,gap:16+i})]));
 assert.deepEqual(m.getSnapshot().panel.state,b.state); assert.equal(m.getEditBudget().used,10);
 await m.undo(); assert.equal(m.getEditBudget().used,10); await m.importPanel(await m.exportPanel());
 await assert.rejects(m.patch(await patch(m.getSnapshot().panel.spec,[operation(null)])),/WORKBENCH_EDIT_LIMIT/); m.dispose();
});

test('Unity export retains square button geometry, round radius and original event wiring with a single centered label', async () => {
 const b=await changed(), doc=await createUnityDocument(b,core), nodes=doc.nodes.filter(n=>n.type==='Button');
 assert.equal(nodes.length,3); assert.equal(new Set(nodes.map(n=>n.y)).size,1);
 for(const n of nodes){assert.equal(n.width,n.height);assert.equal(n.cornerRadius,n.width/2);}
 assert(!doc.nodes.some(n=>n.id.endsWith('.center-label'))); assert.deepEqual(doc.controls,(await createUnityDocument(source,core)).controls);
});

test('composition remaps button layout section references and preserves geometry through source replay', async () => {
 const a=await changed(), b=await createPanelBundle({...a.spec,id:'other-player'},catalog,core,a.state);
 const request={panelCompositionRequestVersion:'0.1',id:'players',title:'播放器组合',sources:[{namespace:'first',bundleSha256:a.sha256},{namespace:'second',bundleSha256:b.sha256}],layout:'column',width:420,canvasWidth:484,canvasHeight:640,maxHeight:560,surfaceFrom:null};
 const result=await composePanelBundles(request,[a,b],core); await validatePanelComposition(result,[a,b],core);
 assert.equal(result.bundle.spec.actionLayouts.length,2); assert(result.bundle.spec.actionLayouts.every(l=>result.bundle.spec.sections.some(s=>s.id===l.sectionId)));
 assert.equal(buttons(result.bundle).length,6); assert(buttons(result.bundle).every(n=>n.layout.width===56 && n.layout.height===56));
});
