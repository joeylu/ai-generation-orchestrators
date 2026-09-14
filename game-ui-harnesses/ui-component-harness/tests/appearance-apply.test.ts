import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessError } from '../src/contract.ts';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { bundleResources, createBundle, validateBundle } from '../src/bundle.ts';
import { appearanceDocumentSha256 } from '../src/appearance-binding.ts';
import { appearanceApplicationFixture } from './helpers/appearance-application-fixture.ts';
import { firstBatchAppearanceFixture } from './helpers/first-batch-appearance-fixture.ts';
import { secondBatchAppearanceFixture } from './helpers/second-batch-appearance-fixture.ts';

test('v0.2 binding deterministically applies Button, Switch, and Select appearances with original evidence', async () => {
  const value = await appearanceApplicationFixture();
  const applied = await applyAppearanceBinding(value.target, value.imported, value.binding);
  await validateBundle(JSON.parse(JSON.stringify(applied)));
  const nodes = new Map((applied.document.schemaVersion === '0.2' && 'children' in applied.document.root ? applied.document.root.children : []).map(node => [node.id, node]));
  assert.deepEqual((nodes.get('apply-button') as any).props.appearance.labelLayout, { x: 10, y: 5, width: 80, height: 30 });
  assert.deepEqual((nodes.get('apply-switch') as any).props.appearance.thumbPositions.on, { x: 144, y: 4 });
  assert.equal((nodes.get('apply-select') as any).props.appearance.popupGap, 2);
  assert.equal((nodes.get('apply-select') as any).props.appearance.fieldTextColor, '#FFFFFF');
  assert.equal(bundleResources(applied).filter(resource => resource.path.startsWith(`appearance/${value.imported.archiveSha256}/`)).length, 6);
  assert.equal(value.document.root.children.some((node: any) => node.props.appearance), false, 'target input remains unchanged');
});

test('Select popup content layout converts target-popup-local bounds into popupCanvas-local bounds', async () => {
  const value = await appearanceApplicationFixture();
  const document = structuredClone(value.document) as any;
  document.canvas = { width: 1000, height: 800 };
  document.root.layout = { x: 0, y: 0, width: 1000, height: 800 };
  const nodes = new Map(document.root.children.map((node: any) => [node.id, node]));
  nodes.get('apply-button').layout = { x: 20, y: 20, width: 200, height: 80 };
  nodes.get('apply-switch').layout = { x: 20, y: 140, width: 360, height: 80 };
  nodes.get('apply-select').layout = { x: 20, y: 260, width: 240, height: 80 };
  const binding = structuredClone(value.binding) as any;
  binding.documentSha256 = await appearanceDocumentSha256(document);
  binding.registration.targetCanvas = { width: 1000, height: 800 };
  binding.registration.transform = { scale: 2, offset: { x: 0, y: 0 } };
  binding.bindings[0].states.button.labelLayout = { coordinateSpace: 'target-component-local', x: 20, y: 10, width: 160, height: 60 };
  binding.bindings[1].states.switch.thumbPositions = { coordinateSpace: 'target-component-local', anchor: 'top-left', off: { x: 8, y: 8 }, on: { x: 288, y: 8 } };
  binding.bindings[1].states.switch.labelLayout = { coordinateSpace: 'target-component-local', x: 96, y: 10, width: 180, height: 60 };
  binding.bindings[2].states.select.labelLayout = { coordinateSpace: 'target-component-local', x: 20, y: 10, width: 140, height: 60 };
  binding.bindings[2].states.select.popupPlacement.gap = 4;
  binding.bindings[2].states.select.popupContentLayout = {
    coordinateSpace: 'target-popup-local', x: 24, y: 36, width: 192, height: 120,
  };
  const target = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Scaled Select popup content conversion regression.' });
  const applied = await applyAppearanceBinding(target, value.imported, binding);
  const select = (applied.document.root.children as any[]).find(node => node.id === 'apply-select');
  assert.deepEqual(select.props.appearance.popupContentLayout, { x: 12, y: 18, width: 96, height: 60 });
  await validateBundle(applied);
});

test('v0.2 binding applies CheckBox, RadioGroup, Input, ProgressBar, and Slider without mutating the target', async () => {
  const value = await firstBatchAppearanceFixture(), applied = await applyAppearanceBinding(value.target, value.imported, value.binding);
  await validateBundle(JSON.parse(JSON.stringify(applied)));
  const nodes = new Map((applied.document.schemaVersion === '0.2' && 'children' in applied.document.root ? applied.document.root.children : []).map(node => [node.id, node]));
  assert.deepEqual((nodes.get('apply-checkbox') as any).props.appearance.labelLayout, { x: 50, y: 5, width: 140, height: 40 });
  assert.deepEqual((nodes.get('apply-radio') as any).props.appearance.items.map((item: any) => item.optionId), ['low', 'high']);
  assert.deepEqual((nodes.get('apply-input') as any).props.appearance.placeholderLayout, { x: 12, y: 8, width: 216, height: 34 });
  assert.deepEqual((nodes.get('apply-progress') as any).props.appearance.fillClip, { x: 10, y: 8, width: 220, height: 14 });
  assert.deepEqual((nodes.get('apply-slider') as any).props.appearance.thumbPositions.max, { x: 210, y: 10 });
  assert.equal(bundleResources(applied).filter(resource => resource.path.startsWith(`appearance/${value.imported.archiveSha256}/`)).length, 12);
  assert.equal(value.document.root.children.some((node: any) => node.props.appearance), false);
});

test('first-batch application rejects overlapping RadioGroup hit areas and stale Slider thumb geometry', async () => {
  const value = await firstBatchAppearanceFixture();
  const overlap = structuredClone(value.binding) as any; overlap.bindings[1].states.radioGroup.options[1].hitArea.y = 50;
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, overlap), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'OVERLAPPING_HIT_AREAS'));
  const stale = structuredClone(value.binding) as any; stale.bindings[4].states.slider.thumbPositions.max.x = 190;
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, stale), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'SLIDER_VALUE_GEOMETRY_MISMATCH'));
  const diagonal = structuredClone(value.binding) as any; diagonal.bindings[4].states.slider.thumbPositions.max.y = 12;
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, diagonal), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'SLIDER_AXIS_MISMATCH'));
  const bakedInputText = structuredClone(value.binding) as any; bakedInputText.bindings[2].parts.push({ role: 'placeholder', layerId: 'scene-background' });
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, bakedInputText), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'ROLE_NOT_ALLOWED'));
});

test('ProgressBar accepts an inset cavity mask and rejects clips outside the fill', async () => {
  const value = await firstBatchAppearanceFixture(); const binding:any = structuredClone(value.binding);
  const clip=binding.bindings[3].states.progressBar.fillClip;
  Object.assign(clip,{x:14,y:10,width:212,height:10});
  const applied:any=await applyAppearanceBinding(value.target,value.imported,binding);
  assert.deepEqual(applied.document.root.children.find((n:any)=>n.id==='apply-progress').props.appearance.fillClip,{x:14,y:10,width:212,height:10});
  clip.x=9;
  await assert.rejects(applyAppearanceBinding(value.target,value.imported,binding),/FILL_CLIP_GEOMETRY_MISMATCH/);
});

test('List imports painted row height separately from its interval and rejects hit areas in gaps',async()=>{
  const f=await secondBatchAppearanceFixture(5); const applied:any=await applyAppearanceBinding(f.target,f.imported,f.binding);
  const list=applied.document.root.children.find((n:any)=>n.id==='apply-list');
  assert.equal(list.props.itemHeight,50); assert.equal(list.props.appearance.rowCanvas.height,45);
  const bad:any=structuredClone(f.binding); bad.bindings[1].states.list.hitArea.height=50;
  await assert.rejects(applyAppearanceBinding(f.target,f.imported,bad),/ITEM_LAYOUT_OUT_OF_BOUNDS/);
});

test('v0.2 binding applies the remaining eight types from explicit reusable templates', async () => {
  const value = await secondBatchAppearanceFixture(), applied = await applyAppearanceBinding(value.target, value.imported, value.binding);
  await validateBundle(JSON.parse(JSON.stringify(applied)));
  const nodes = new Map((applied.document.schemaVersion === '0.2' && 'children' in applied.document.root ? applied.document.root.children : []).map(node => [node.id, node]));
  assert.deepEqual((nodes.get('apply-scroll') as any).props.appearance.scrollbarThumbPositions.max, { x: 180, y: 80 });
  assert.deepEqual((nodes.get('apply-list') as any).props.appearance.hitArea, { x: 0, y: 0, width: 200, height: 50 });
  assert.equal((nodes.get('apply-dialog') as any).props.appearance.overlayCanvas.width, 800);
  assert.deepEqual((nodes.get('apply-tabs') as any).props.appearance.labelLayout, { x: 90, y: 5, width: 100, height: 30 });
  assert.equal((nodes.get('apply-tabs') as any).props.appearance.activeTextColor, '#FFFFFF');
  assert.deepEqual((nodes.get('apply-tabs') as any).props.appearance.icons.map((item: any) => item.tabId), ['tab-a', 'tab-b']);
  assert.equal((nodes.get('apply-image') as any).props.source, `appearance/${value.imported.archiveSha256}/image-layer.png`);
  assert.equal((nodes.get('apply-text') as any).props.text, 'Live semantic text');
  assert.ok((nodes.get('apply-container') as any).props.appearance);
  assert.equal((nodes.get('apply-panel') as any).props.title, 'Profile');
  assert.equal(bundleResources(applied).filter(resource => resource.path.startsWith(`appearance/${value.imported.archiveSha256}/`)).length, 21);
  assert.equal(value.document.root.children.some((node: any) => node.props.appearance), false);
});

test('second-batch application rejects stale dynamic state and implicit repeated samples', async () => {
  const value = await secondBatchAppearanceFixture();
  const staleScroll = structuredClone(value.binding) as any; staleScroll.bindings[0].states.scrollView.thumbPositions.max.y = 70;
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, staleScroll), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'SCROLL_VALUE_GEOMETRY_MISMATCH'));
  const wrongSelection = structuredClone(value.binding) as any; wrongSelection.bindings[1].parts[2].itemId = 'first';
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, wrongSelection), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'SELECTED_ITEM_MISMATCH'));
  const nonModalOverlay = structuredClone(value.target) as any; nonModalOverlay.document.root.children[2].props.modal = false;
  const nonModalBinding = structuredClone(value.binding) as any; nonModalBinding.documentSha256 = await (await import('../src/appearance-binding.ts')).appearanceDocumentSha256(nonModalOverlay.document);
  await assert.rejects(applyAppearanceBinding(nonModalOverlay, value.imported, nonModalBinding), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'OVERLAY_MODAL_MISMATCH'));
  const wrongActiveTab = structuredClone(value.binding) as any; wrongActiveTab.bindings[3].parts[1].tabId = 'tab-a';
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, wrongActiveTab), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'ACTIVE_TAB_MISMATCH'));
  const missingTabIcon = structuredClone(value.binding) as any; missingTabIcon.bindings[3].parts = missingTabIcon.bindings[3].parts.filter((part: any) => !(part.role === 'active-icon' && part.tabId === 'tab-a'));
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, missingTabIcon), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'MISSING_TAB_ICON_ROLE'));
});

test('application rejects legacy binding, stale popup geometry, and existing appearance instead of guessing or overwriting', async () => {
  const value = await appearanceApplicationFixture();
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, { ...value.binding, version: '0.1' }), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'UNSUPPORTED_FIELD' || issue.code === 'APPLICATION_BINDING_REQUIRED'));
  const badPopup = structuredClone(value.binding) as any; badPopup.bindings[2].states.select.popupPlacement.gap = 3;
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, badPopup), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'SELECT_POPUP_GEOMETRY_MISMATCH'));
  const applied = await applyAppearanceBinding(value.target, value.imported, value.binding);
  const rebound = { ...value.binding, documentSha256: await (await import('../src/appearance-binding.ts')).appearanceDocumentSha256(applied.document as any) };
  await assert.rejects(applyAppearanceBinding(applied, value.imported, rebound), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'EXISTING_APPEARANCE'));
});
