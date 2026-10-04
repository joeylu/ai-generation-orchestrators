import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { core, fixture, catalog, copy, nodesOf } from './helpers.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { exportUnityKit } from '../src/unity-export-io.mjs';
import { digestBytes } from '../src/canonical.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const flowCatalog = await json('../examples/modern-mint-layout.catalog.json');
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'unity-export-'));
const make = async name => createPanelBundle(await json(`../examples/layout-v1/${name}.panel.json`), flowCatalog, core);

test('native lowering keeps every source node and parent in all four layout samples', async () => {
  for (const sample of ['settings', 'settings-compact', 'pause', 'character']) {
    const bundle = await make(sample), original = copy(bundle), document = await createUnityDocument(bundle, core);
    assert.deepEqual(bundle, original);
    assert.deepEqual(document, await createUnityDocument(copy(bundle), core));
    assert.equal(document.panelSha256, bundle.sha256);
    const source = nodesOf(bundle.componentBundle.document);
    assert.equal(document.nodes.length, source.length);
    const seen = new Set();
    for (const [index, node] of document.nodes.entries()) {
      assert.equal(node.id, source[index].id); assert.equal(node.type, source[index].type);
      assert.deepEqual({x:node.x,y:node.y,width:node.width,height:node.height}, source[index].layout);
      if (index) assert(seen.has(node.parentId)); else assert.equal(node.parentId, '');
      seen.add(node.id);
    }
    assert.equal(document.controls.length, bundle.spec.sections.flatMap(s => s.rows).filter(r => r.kind !== 'text').length);
    assert.equal(bundle.capabilities.target, 'pixi');
  }
});

test('standalone buttons export directly under their section without a native row background', async () => {
  const bundle = await make('settings'), document = await createUnityDocument(bundle, core);
  for (const section of bundle.spec.sections) for (const row of section.rows.filter(row => row.kind === 'button' && row.label === '')) {
    assert.equal(document.nodes.some(node => node.id === `${bundle.spec.id}.row.${row.id}`), false);
    const button = document.nodes.find(node => node.id === `${bundle.spec.id}.row.${row.id}.control`);
    assert.equal(button.parentId, `${bundle.spec.id}.section.${section.id}`); assert.equal(button.type, 'Button');
    const control = document.controls.find(control => control.rowId === row.id);
    assert.equal(control.nodeId, button.id); assert.deepEqual(control.resetFields, row.action.fields ?? []);
  }
});

test('native state stores current values separately from authored reset values and enum IDs', async () => {
  const spec = await json('../examples/layout-v1/settings.panel.json');
  const original = await make('settings'), current = {...original.state, volume: 21, quality:'fine', musicEnabled:false};
  const document = await createUnityDocument(await createPanelBundle(spec, flowCatalog, core, current), core);
  const fields = new Map(document.fields.map(f => [f.id,f]));
  assert.equal(fields.get('volume').numberValue, 21); assert.equal(fields.get('volume').initialNumber, 70);
  assert.equal(fields.get('musicEnabled').booleanValue, false); assert.equal(fields.get('musicEnabled').initialBoolean, true);
  assert.equal(fields.get('quality').stringValue, 'fine'); assert.equal(fields.get('quality').initialString, 'balanced');
  assert.deepEqual(fields.get('quality').options, spec.state.find(f => f.id === 'quality').options);
  const reset = document.controls.find(c => c.action === 'reset-initial');
  assert.deepEqual(reset.resetFields, spec.sections.flatMap(s => s.rows).find(r => r.id === reset.rowId).action.fields);
  assert.equal(document.controls.find(c => c.fieldId === 'volume').suffix, '%');
});

test('empty-state menus and readonly text export without synthetic fields or events', async () => {
  const pause = await createUnityDocument(await make('pause'), core);
  const character = await createUnityDocument(await make('character'), core);
  assert.deepEqual(pause.fields, []); assert.deepEqual(character.fields, []);
  assert(pause.controls.every(c => c.action === 'emit' && c.fieldId === ''));
  assert.equal(character.controls.length, 1);
  assert(character.nodes.some(n => n.type === 'Text' && n.text === 'Lv. 24'));
});

test('Unity names follow stable panel IDs while display titles change independently', async () => {
  const spec = copy(fixture), first = await createUnityDocument(await createPanelBundle(spec, catalog, core), core);
  spec.title = '更改后的中文标题';
  const next = await createUnityDocument(await createPanelBundle(spec, catalog, core), core);
  assert.equal(first.panelId, next.panelId); assert.equal(first.nodes[0].id, next.nodes[0].id);
  assert.notEqual(first.panelSha256, next.panelSha256);
  for (const id of ['CON', 'nul', 'LPT1', 'com9']) {
    spec.id = id;
    await assert.rejects(createUnityDocument(await createPanelBundle(spec, catalog, core), core), { code: 'UNITY_PANEL_ID_RESERVED' });
  }
});

test('legacy stack bundles use the same native adapter without upgrading source contracts', async () => {
  const bundle = await createPanelBundle(fixture, catalog, core);
  const document = await createUnityDocument(bundle, core);
  assert.equal(document.panelSpecVersion, '0.1'); assert.equal(bundle.panelBundleVersion, '0.1');
  assert.equal(document.controls.length, 2); assert(document.nodes.every(n => n.type !== 'ScrollView'));
});

test('slider tick-index mapping preserves decimal and large offset semantics and rejects excessive ticks', async () => {
  const spec = copy(fixture), field = spec.state.find(f => f.type === 'number');
  Object.assign(field, {min:1_000_000_000,max:1_000_000_100,step:0.5,initial:1_000_000_005.5});
  const valid = await createUnityDocument(await createPanelBundle(spec, catalog, core), core);
  assert.equal(valid.fields[0].numberValue, field.initial); assert.equal(valid.fields[0].step, 0.5);
  Object.assign(field, {min:0,max:1_000_001,step:1,initial:0});
  const bundle = await createPanelBundle(spec, catalog, core), output = join(work,'unsupported');
  await assert.rejects(exportUnityKit(bundle, core, output), {code:'UNITY_SLIDER_PRECISION_LIMIT'});
  await assert.rejects(stat(output), {code:'ENOENT'});
  Object.assign(field, {min:1000,max:1001,step:0.1,initial:1000});
  await assert.rejects(createUnityDocument(await createPanelBundle(spec,catalog,core),core), {code:'UNITY_NUMBER_PRECISION'});
});

test('nine-slice export retains asymmetric PNG regions and extracts only fingerprinted selected bytes', async () => {
  const spec = copy(fixture); spec.panelSpecVersion = '0.2';
  const png = new Uint8Array(await readFile(new URL('../examples/custom-assets/panel-surface.png',import.meta.url)));
  const hash = await digestBytes(png), key = 'test-kit/surface@1.0.0';
  spec.assets = {library:{id:'test-assets',sha256:'a'.repeat(64)},panelSurface:key,rowIcons:[]};
  const closure = {assetClosureVersion:'0.1',library:copy(spec.assets.library),records:[{key,role:'shape',width:64,height:64,
    slice:{left:7,top:11,right:9,bottom:13},sha256:hash,bytes:png.length}]};
  const bundle = await createPanelBundle(spec,catalog,core,undefined,{closure,resources:[{path:`textures/${hash}.png`,mime:'image/png',bytes:png}]});
  const document = await createUnityDocument(bundle,core), regions = document.nodes.filter(n=>n.hasRegion);
  assert.equal(regions.length,9); assert.equal(document.assets.length,1);
  const bottomLeft = regions.find(n=>n.id.endsWith('.2.0'));
  assert.equal(bottomLeft.regionY,51); assert.equal(bottomLeft.regionHeight,13); assert.equal(bottomLeft.regionWidth,7);
  const output = join(work,'images'); await exportUnityKit(bundle,core,output);
  assert.deepEqual(new Uint8Array(await readFile(join(output,document.assets[0].path))),png);
});

test('native kit bytes and script GUIDs are deterministic and build evidence never claims Unity ran', async () => {
  const bundle = await make('settings');
  for (const name of ['first','second']) await exportUnityKit(bundle,core,join(work,name));
  const first = JSON.parse(await readFile(join(work,'first','export-manifest.json'),'utf8'));
  const second = JSON.parse(await readFile(join(work,'second','export-manifest.json'),'utf8'));
  assert.deepEqual(first,second); assert.equal(first.verification.unityImport,'NOT_RUN');
  for (const file of first.files) {
    const bytes = await readFile(join(work,'first',file.path));
    assert.equal(bytes.length,file.bytes); assert.equal(await digestBytes(bytes),file.sha256);
    assert.deepEqual(bytes,await readFile(join(work,'second',file.path)));
  }
  const source = JSON.parse(await readFile(join(work,'first','panel.bundle.json'),'utf8'));
  assert.deepEqual(source,bundle);
  assert(first.files.some(f=>f.path.endsWith('/PanelController.cs.meta')));
  await assert.rejects(exportUnityKit(bundle,core,join(work,'first')), /OUTPUT_EXISTS/);
});

test('tampered bundles and escaping output paths are rejected before native kit publication', async () => {
  const bundle = await make('settings'), output = join(work,'forged');
  const forged = copy(bundle); forged.componentBundle.document.root.children[0].layout.x += 1;
  await assert.rejects(exportUnityKit(forged,core,output)); await assert.rejects(stat(output),{code:'ENOENT'});
  await assert.rejects(exportUnityKit(bundle,core,resolve(root,'../native-outside')), /OUTPUT_OUTSIDE_HARNESS/);
});

test('CLI exports a validated native kit and rejects unsupported flags without launching an engine', async () => {
  const bundle = await make('pause'), input = join(work,'input.json'); await writeFile(input,JSON.stringify(bundle));
  const run = (...args) => spawnSync(process.execPath,['scripts/cli.mjs',...args],{cwd:root,encoding:'utf8'});
  const valid = run('export-unity',input,'--output',join(work,'cli'));
  assert.equal(valid.status,0,valid.stderr); assert.equal(JSON.parse(valid.stdout).status,'UNITY_IMPORT_KIT_BUILT');
  assert.equal(JSON.parse(valid.stdout).unityImport,'NOT_RUN');
  const invalid = run('export-unity',input,'--output',join(work,'cli-bad'),'--unity','not-an-engine');
  assert.notEqual(invalid.status,0); await assert.rejects(stat(join(work,'cli-bad')),{code:'ENOENT'});
});
