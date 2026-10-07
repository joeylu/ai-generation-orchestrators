#!/usr/bin/env node
/** Real Pixi + panel session acceptance. Routes static files in-browser; opens no server. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { readJson, createOutputDirectory, writeNewJson } from '../src/io.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle, createPanelBundle, panelBundleAssetInputs } from '../src/panel-bundle.mjs';
import { choiceId, controlId, initialPanelState } from '../src/compiler.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(['--preview', '--bundle', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]], 'Expected --preview, --bundle, --output');
  options[args[i]] = args[i + 1];
}
assert.equal(Object.keys(options).length, 3);
const directory = await createOutputDirectory(options['--output']);
const report = { version: '0.1', status: 'RUNNING', checks: [], screenshots: [], providerCalls: 0,
  scope: 'Static preview with real Pixi runtime and attachPanelSession; no server started',
  nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN' };
const pass = (name, evidence = {}) => report.checks.push({ name, status: 'PASS', ...evidence });
let browser, context, page, stage = 'validate-static-preview';
try {
  const core = await loadWorkspaceCore();
  const bundle = await validatePanelBundle(await readJson(options['--bundle']), core);
  const manifest = await readJson(resolve(options['--preview'], 'preview-build.json'));
  assert.equal(manifest.status, 'COMPLETE'); assert.equal(manifest.panelSha256, bundle.sha256);
  assert.deepEqual(manifest.files.map(f => f.path).sort(), ['index.html', 'preview.js']);
  const files = new Map();
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(options['--preview'], file.path));
    assert.equal(await digestBytes(bytes), file.sha256); files.set('/' + file.path, bytes);
  }
  report.build = manifest; report.panelSha256 = bundle.sha256; pass(stage);
  const rows = bundle.spec.sections.flatMap(s => s.rows);
  const slider = rows.find(r => r.kind === 'slider' && r.enabled), toggle = rows.find(r => r.kind === 'switch' && r.enabled);
  const select = rows.find(r => r.kind === 'select' && r.enabled), reset = rows.find(r => r.kind === 'button' && r.enabled && r.action.kind === 'reset-initial');
  assert(slider && toggle && select && reset, 'Fixture must exercise all four controls');
  assert.deepEqual([...reset.action.fields].sort(), bundle.spec.state.map(s => s.id).sort(), 'Fixture resets all fields');
  const selectField = bundle.spec.state.find(f => f.id === select.bind), sliderField = bundle.spec.state.find(f => f.id === slider.bind);
  assert(selectField.options.length >= 3, 'Fixture needs at least three enum choices');
  const id = row => controlId(bundle.spec.id, row.id), defaults = initialPanelState(bundle.spec);
  const problems = [];
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = { channel: 'msedge', version: browser.version() };
  const healthy = async () => { assert.deepEqual(problems, []); assert.equal(await page.locator('#status').getAttribute('data-state'), 'ready'); };
  const open = async () => {
    context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:4179' && files.has(url.pathname) && !url.search)
        return route.fulfill({ body: files.get(url.pathname), contentType: url.pathname.endsWith('.html') ? 'text/html' : 'text/javascript' });
      if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
      problems.push('Unexpected external or unlisted request'); return route.abort();
    });
    page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => problems.push(e.message));
    page.on('console', e => { if (e.type() === 'error') problems.push(e.text()); });
    await page.goto('http://127.0.0.1:4179/index.html');
    await page.waitForFunction(() => document.getElementById('status').dataset.state === 'ready'); await healthy();
  };
  const state = () => page.evaluate(() => window.panelHarness.getState());
  const events = () => page.evaluate(() => window.panelHarness.events());
  const clear = () => page.evaluate(() => window.panelHarness.clearEvents());
  const inspect = () => page.evaluate(() => window.panelHarness.inspect());
  const node = async row => (await inspect()).nodes.find(n => n.id === id(row));
  const point = async bounds => {
    const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded();
    const b = await canvas.boundingBox(); assert(b);
    return { x: b.x + bounds.x * b.width / bundle.spec.canvas.width, y: b.y + bounds.y * b.height / bundle.spec.canvas.height,
      sx: b.width / bundle.spec.canvas.width, sy: b.height / bundle.spec.canvas.height };
  };
  const clickRow = async row => {
    const bounds = (await node(row)).bounds, p = await point(bounds);
    await page.mouse.click(p.x + bounds.width / 2 * p.sx, p.y + bounds.height / 2 * p.sy);
  };
  const screenshot = async name => { await page.locator('#canvas-host canvas').screenshot({ path: resolve(directory, name) }); report.screenshots.push(name); };
  const textCheck = async () => {
    for (const n of (await inspect()).nodes) for (const text of n.renderedTextBounds ?? [])
      assert(!text.implicitTruncation && text.bounds.width <= n.bounds.width + 1 && text.bounds.height <= n.bounds.height + 1, 'No text overflow');
  };
  const mouseSelect = async option => {
    await clear(); await clickRow(select);
    const n = await node(select), popup = n.popupBounds;
    assert(n.popupOpen && popup); assert(popup.x >= 0 && popup.y >= 0 && popup.x + popup.width <= bundle.spec.canvas.width + 1 && popup.y + popup.height <= bundle.spec.canvas.height + 1);
    assert.deepEqual(n.popupItems.map(i => i.optionId), selectField.options.map(o => choiceId(bundle.spec.id, select.id, o.id)));
    for (const item of n.popupItems) for (const text of item.textBounds ?? []) assert(text.bounds.width <= popup.width && text.bounds.height <= popup.height / selectField.options.length);
    await screenshot('select-open.png');
    const index = selectField.options.findIndex(o => o.id === option), p = await point(popup);
    await page.mouse.click(p.x + popup.width / 2 * p.sx, p.y + (index + .5) * popup.height / selectField.options.length * p.sy);
    assert.equal((await state())[select.bind], option); assert.equal((await node(select)).popupOpen, false);
    assert.deepEqual(await events(), [{name:select.event, fieldId:select.bind, value:option, source:'mouse'}]);
  };
  const setSliderWithMouse = async value => {
    await clear(); const n = await node(slider), p = await point(n.bounds);
    const x = 14 + (value - sliderField.min) / (sliderField.max - sliderField.min) * (n.bounds.width - 28);
    await page.mouse.click(p.x + x * p.sx, p.y + n.bounds.height / 2 * p.sy);
    assert.equal((await state())[slider.bind], value);
    assert.deepEqual(await events(), [{name:slider.event,fieldId:slider.bind,value,source:'mouse'}]);
  };
  const assertReset = async source => {
    assert.deepEqual(await state(), defaults);
    assert.deepEqual(await events(), [{name:reset.event,rowId:reset.id,action:'reset-initial',state:defaults,source}]);
    const doc = await page.evaluate(() => window.panelHarness.getDocument());
    const all = new Map(); const visit = n => { all.set(n.id,n); for(const c of n.children??[])visit(c); }; visit(doc.root);
    assert.equal(all.get(id(slider)).props.value, defaults[slider.bind]);
    assert.equal(all.get(id(toggle)).props.checked, defaults[toggle.bind]);
    assert.equal(all.get(id(select)).props.selectedId, choiceId(bundle.spec.id,select.id,defaults[select.bind]));
    const valueBinding = doc.valueTextBindings.bindings.find(b=>b.sourceId===id(slider));
    const rendered=(await inspect()).nodes.find(n=>n.id===valueBinding.targetId);
    assert.equal(rendered.renderedTextBounds.map(t=>t.text).join(''),valueBinding.parts.map(p=>typeof p==='string'?p:defaults[slider.bind].toFixed(p.fractionDigits)).join(''));
  };
  const teardown = async () => {
    await page.evaluate(() => window.panelHarness.destroy());
    assert.equal(await page.locator('#canvas-host canvas').count(), 0);
    assert.equal(await page.evaluate(() => { try {window.panelHarness.getState(); return false;} catch {return true;} }), true);
    assert.equal(await page.locator('#export').isDisabled(), true); await context.close();
  };
  stage='initial-panel-session'; await open(); assert.deepEqual(await state(),bundle.state); assert.deepEqual(await events(),[]);
  assert.equal((await inspect()).resources,bundle.componentBundle.resources.length); await textCheck(); await screenshot('initial.png'); pass(stage,{state:await state(),embeddedPngs:bundle.componentBundle.resources.length});
  stage='pointer-select-and-popup';
  const chosen=selectField.options.find(o=>o.id!==defaults[select.bind]).id;
  await mouseSelect(chosen); pass(stage,{semanticValue:chosen});
  stage='keyboard-select'; await clear(); await page.locator('#canvas-host canvas').focus();
  for(let count=0;count<rows.length+2 && await page.locator('#canvas-host canvas').getAttribute('data-focused-component')!==id(select);count++) await page.keyboard.press('Tab');
  assert.equal(await page.locator('#canvas-host canvas').getAttribute('data-focused-component'),id(select));
  await page.keyboard.press('ArrowDown'); const next=selectField.options[selectField.options.findIndex(o=>o.id===chosen)+1].id;
  assert.equal((await state())[select.bind],next); assert.deepEqual(await events(),[{name:select.event,fieldId:select.bind,value:next,source:'keyboard'}]); pass(stage);
  stage='changed-numeric-and-boolean-state'; const alternate=defaults[slider.bind]===sliderField.min?sliderField.max:sliderField.min;
  await setSliderWithMouse(alternate); await clear(); await clickRow(toggle);
  assert.equal((await state())[toggle.bind],!defaults[toggle.bind]); assert.equal((await state())[slider.bind],alternate); await screenshot('changed.png'); pass(stage,{state:await state()});
  stage='pointer-reset-to-authored-defaults'; await clear(); await clickRow(reset); await assertReset('mouse'); await textCheck(); pass(stage,{hostEvents:1});
  stage='export-current-panel'; await mouseSelect(chosen); await setSliderWithMouse(alternate);
  const savedState=await state(); const saved=await validatePanelBundle(await page.evaluate(()=>window.panelHarness.exportBundle()),core);
  assert.deepEqual(saved.spec,bundle.spec); assert.deepEqual(saved.state,savedState); assert.deepEqual(saved.componentBundle.resources,bundle.componentBundle.resources);
  await writeNewJson(directory,'panel.snapshot.bundle.json',saved); await writeNewJson(directory,'panel.snapshot.state.json',savedState); pass(stage,{state:savedState});
  stage='download-current-panel';
  const downloaded=page.waitForEvent('download'); await page.locator('#export').click();
  const download=await downloaded, downloadedFile=resolve(directory,'downloaded.panel.bundle.json');
  await download.saveAs(downloadedFile);
  assert.deepEqual(await validatePanelBundle(await readJson(downloadedFile),core),saved); pass(stage);
  await teardown(); stage='fresh-context-restore'; await open();
  await page.evaluate(input=>window.panelHarness.importBundle(input),saved); await healthy(); assert.deepEqual(await state(),savedState); assert.deepEqual(await events(),[]); await screenshot('restored.png'); pass(stage);
  stage='keyboard-reset-after-restore'; await clear(); await page.locator('#canvas-host canvas').focus();
  for(let count=0;count<rows.length+2 && await page.locator('#canvas-host canvas').getAttribute('data-focused-component')!==id(reset);count++) await page.keyboard.press('Tab');
  assert.equal(await page.locator('#canvas-host canvas').getAttribute('data-focused-component'),id(reset));
  await page.keyboard.press('Space'); await assertReset('keyboard'); pass(stage,{defaultsSource:'PanelSpec.initial, not restored snapshot'});
  stage='disabled-select-and-button'; const disabled=structuredClone(bundle.spec);
  for(const row of disabled.sections.flatMap(s=>s.rows)) if([select.id,reset.id].includes(row.id)) row.enabled=false;
  const disabledBundle=await createPanelBundle(disabled,bundle.catalog,core,savedState,panelBundleAssetInputs(bundle,core));
  await page.evaluate(input=>window.panelHarness.importBundle(input),disabledBundle); await clear(); await clickRow(select); await clickRow(reset);
  assert.equal((await node(select)).popupOpen,false); assert.deepEqual(await state(),savedState); assert.deepEqual(await events(),[]); await healthy(); pass(stage);
  stage='stale-import-failure-cannot-overwrite-new-import';
  await page.evaluate(async ({oldBundle,newBundle})=>{
    const digest=crypto.subtle.digest.bind(crypto.subtle); let rejectOld,entered;
    const started=new Promise(resolve=>{entered=resolve;});
    crypto.subtle.digest=(...args)=>{crypto.subtle.digest=digest;entered();return new Promise((_,reject)=>{rejectOld=reject;});};
    const stale=window.panelHarness.importBundle(oldBundle); await started;
    await window.panelHarness.importBundle(newBundle); rejectOld(new Error('Injected stale digest failure')); await stale;
  },{oldBundle:bundle,newBundle:saved});
  await healthy(); assert.deepEqual(await state(),savedState); assert.equal(await page.locator('#canvas-host canvas').count(),1); pass(stage);
  stage='late-file-read-cannot-replace-new-selection';
  await page.evaluate(async ({oldBundle,newBundle})=>{
    const input=document.getElementById('import');
    let release; window.releaseOldPanelRead=()=>release(JSON.stringify(oldBundle));
    const oldFile=new File(['delayed'],'old.json',{type:'application/json'});
    oldFile.text=()=>new Promise(resolve=>{release=resolve;});
    const selectFile=file=>{const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change'));};
    selectFile(oldFile); selectFile(new File([JSON.stringify(newBundle)],'new.json',{type:'application/json'}));
  },{oldBundle:bundle,newBundle:disabledBundle});
  await page.waitForFunction(selectId=>document.getElementById('status').dataset.state==='ready'&&window.panelHarness.inspect().nodes.find(n=>n.id===selectId)?.enabled===false,id(select));
  await page.evaluate(async()=>{window.releaseOldPanelRead();delete window.releaseOldPanelRead;await new Promise(resolve=>requestAnimationFrame(resolve));});
  await healthy(); assert.equal((await node(select)).enabled,false); assert.deepEqual(await state(),savedState); pass(stage);
  stage='teardown'; await teardown(); pass(stage,{canvasRemoved:true,sessionUnavailable:true,scope:'Public lifecycle observed; internal resource counters are unavailable after renderer destruction'});
  stage='file-url-offline-open';
  context=await browser.newContext({viewport:{width:1500,height:1100},serviceWorkers:'block',offline:true});
  page=await context.newPage(); page.on('pageerror',e=>problems.push(e.message));
  page.on('console',e=>{if(e.type()==='error')problems.push(e.text());});
  await page.goto(pathToFileURL(resolve(options['--preview'],'index.html')).href);
  await page.waitForFunction(()=>document.getElementById('status').dataset.state==='ready');
  await healthy(); assert.deepEqual(await state(),bundle.state); await mouseSelect(chosen);
  await clear(); await clickRow(reset); await assertReset('mouse');
  pass(stage,{network:'offline',scheme:'file',interaction:'select and reset'}); await teardown();
  assert.deepEqual(problems, []); report.status='PASS';
} catch(error) { report.status='FAIL'; report.failedStage=stage; report.failure={name:error.name,message:String(error.message).slice(0,1000)}; process.exitCode=1; }
finally { await context?.close().catch(()=>{}); await browser?.close().catch(()=>{}); await writeNewJson(directory,'browser-report.json',report); }
process.stdout.write(JSON.stringify({status:report.status,checks:report.checks.length,failedStage:report.failedStage})+'\n');
