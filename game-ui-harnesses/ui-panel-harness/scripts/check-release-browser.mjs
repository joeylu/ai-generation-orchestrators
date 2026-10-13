#!/usr/bin/env node
/** Check the actual installed delivery and ES browser module; no external services or models. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOutputDirectory, writeNewJson } from '../src/io.mjs';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';

const args = process.argv.slice(2);
assert(args.length === 4 && args[0] === '--acceptance' && args[2] === '--output', 'RELEASE_BROWSER_ARGUMENTS');
const input = resolve(args[1]), output = await createOutputDirectory(args[3]);
const { chromium } = await loadWorkspaceTool('@playwright/test');
const checks = [], errors = [], pass = name => checks.push({ name, status: 'PASS' });
const runtime = await readFile(resolve(input, 'browser-runtime.js'));
const bundle = await readFile(resolve(input, 'pixi/panel.bundle.json'));
let imageReport={artifacts:[]};
try{imageReport=JSON.parse(await readFile(resolve(input,'image-report.json'),'utf8'));assert.equal(imageReport.status,'PASS');}catch(error){if(error.code!=='ENOENT')throw error;}
const imageBundles=Object.fromEntries(await Promise.all(imageReport.artifacts.map(async item=>[item.id,await readFile(resolve(input,item.pixiDirectory,'panel.bundle.json'))])));
const html = `<!doctype html><meta charset="utf-8"><div id="surface"></div><script type="module">
import * as runtime from './browser-runtime.js';
const path=new URL(location.href).searchParams.get('bundle')??'panel.bundle.json';
const bundle=await runtime.validateBundle(await(await fetch('./'+path)).json());
const events=[];const host=runtime.createPixiPanelHost({onEvent:event=>events.push(event)});const panel=await host.add('module',bundle,{container:document.getElementById('surface')});
window.sdkModule={runtime,host,panel,bundle,events};</script>`;
const server = createServer((request, response) => {
  const resources = { '/': ['text/html; charset=utf-8', html], '/browser-runtime.js': ['text/javascript; charset=utf-8', runtime],
    '/panel.bundle.json': ['application/json', bundle],...Object.fromEntries(Object.entries(imageBundles).map(([id,bytes])=>['/'+id+'.bundle.json',['application/json',bytes]])) };
  const item = resources[new URL(request.url,'http://localhost').pathname];
  response.writeHead(item ? 200 : 404, { 'Content-Type': item?.[0] ?? 'text/plain' }); response.end(item?.[1] ?? 'not found');
});
let browser, page, report;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['file:', 'data:', 'blob:'].includes(url.protocol) || url.hostname === '127.0.0.1') await route.continue();
    else { errors.push('UNEXPECTED_REMOTE_REQUEST'); await route.abort(); }
  });
  await page.goto(pathToFileURL(resolve(input, 'pixi/index.html')).href);
  await page.waitForFunction(() => document.getElementById('status')?.dataset.state === 'ready');
  assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await page.evaluate(() => window.panelDelivery.bundle.spec.sections.flatMap(section => section.rows).find(row => row.buttonLabel === '继续').buttonLabel), '继续');
  pass('actual-exported-zip-opens-offline-and-mounts-edited-panel');
  await page.locator('canvas').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.panelDelivery.events().length === 1);
  pass('offline-pixi-button-delivers-one-actual-keyboard-action');
  await page.screenshot({ path: resolve(output, 'offline-panel.png'), fullPage: true });
  await page.evaluate(() => window.panelDelivery.destroy());
  assert.equal(await page.locator('canvas').count(), 0);
  pass('offline-panel-releases-owned-canvas');
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.sdkModule?.panel.status === 'OPEN');
  assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await page.evaluate(() => window.sdkModule.runtime.version), '0.1.0');
  const exported = await page.evaluate(() => window.sdkModule.panel.exportBundle());
  assert.deepEqual(exported, JSON.parse(bundle.toString('utf8')));
  pass('self-contained-es-module-renders-and-exports-the-same-bundle');
  await page.evaluate(() => window.sdkModule.host.destroy());
  assert.equal(await page.locator('canvas').count(), 0);
  assert.deepEqual(errors, []);
  pass('module-cleanup-and-both-runtimes-have-no-browser-errors-or-remote-requests');
  for(const item of imageReport.artifacts)for(const format of ['IIFE','ES']){
    if(format==='IIFE'){
      await page.goto(pathToFileURL(resolve(input,item.pixiDirectory,'index.html')).href);
      await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');
    }else{
      await page.goto(`http://127.0.0.1:${server.address().port}/?bundle=${item.id}.bundle.json`);
      await page.waitForFunction(()=>window.sdkModule?.panel.status==='OPEN');
    }
    const actual=await page.evaluate(format=>format==='IIFE'?{bundle:window.panelDelivery.bundle,inspection:window.panelDelivery.inspect()}:{bundle:window.sdkModule.bundle,inspection:window.sdkModule.panel.inspect()},format);
    assert.equal(actual.bundle.sha256,item.bundleSha256);const spec=actual.bundle.spec,nodes=actual.inspection.nodes;
    for(const section of spec.sections){
      const image=section.rows.find(row=>row.kind==='image'),plate=nodes.find(node=>node.id===`${spec.id}.row.${image.id}.control`);
      const ids=[`${spec.id}.section.${section.id}.title`,...(image.source===null?[plate.id+'.placeholder']:[])];
      if(item.compilerVersion==='0.30.0')for(const id of ids){
        const text=nodes.find(node=>node.id===id)?.renderedTextBounds?.[0];assert(text);
        assert(Math.abs(text.bounds.x+text.bounds.width/2-plate.bounds.x-plate.bounds.width/2)<1);
      }
    }
    pass('installed-image-card-actual-glyph-centers-'+item.id+'-'+format);
    await page.screenshot({path:resolve(output,item.id+'-'+format+'.png'),fullPage:true});
    const canvas=page.locator('canvas'),button=spec.sections[0].rows.find(row=>row.kind==='button'),buttonId=`${spec.id}.row.${button.id}.control`;
    await canvas.focus();
    for(let count=0;count<24&&await canvas.getAttribute('data-focused-component')!==buttonId;count++)await page.keyboard.press('Tab');
    assert.equal(await canvas.getAttribute('data-focused-component'),buttonId);await page.keyboard.press('Enter');
    await page.waitForFunction(format=>format==='IIFE'?window.panelDelivery.events().length===1:window.sdkModule.events.length===1,format);
    const eventName=await page.evaluate(format=>format==='IIFE'?window.panelDelivery.events()[0].event.name:window.sdkModule.events[0].event.name,format);
    assert.equal(eventName,spec.sections[0].rows.find(row=>row.kind==='button').event);
    const exported=await page.evaluate(format=>format==='IIFE'?window.panelDelivery.panel.exportBundle():window.sdkModule.panel.exportBundle(),format);
    assert.deepEqual(exported.spec,spec);assert.deepEqual(exported.state,actual.bundle.state);
    await page.evaluate(format=>format==='IIFE'?window.panelDelivery.destroy():window.sdkModule.host.destroy(),format);assert.equal(await page.locator('canvas').count(),0);
    pass('installed-image-keyboard-export-and-cleanup-'+item.id+'-'+format);
  }
  assert.deepEqual(errors,[]);
  report = { status: 'PASS', browser: browser.version(), checks, errors, realModelCalls: 0, unityNative: 'NOT_RUN' };
} catch (error) {
  report = { status: 'FAIL', checks, errors, code: String(error.message), realModelCalls: 0, unityNative: 'NOT_RUN' };
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeNewJson(output, 'browser-report.json', report);
  console.log(JSON.stringify({ status: report.status, checks: checks.length, realModelCalls: 0, errors }));
}
