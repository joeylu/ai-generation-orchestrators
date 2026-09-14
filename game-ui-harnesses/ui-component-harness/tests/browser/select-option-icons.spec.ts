import { test, expect } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectOptionIconsFixture } from '../helpers/select-option-icons-fixture.ts';
import { applyAppearanceBinding } from '../../src/appearance-apply.ts';
import { componentHandoffEntries } from '../../src/decomposition-import.ts';

test('Studio Select per-option icons: true input, pixels, popup hits, keyboard and portable roundtrip', async ({ page }, info) => {
  const f = await selectOptionIconsFixture(), evidence: any[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/');
  await page.locator('#open-handoff').setInputFiles({ name: 'fixture.zip', mimeType: 'application/zip', buffer: Buffer.from(f.zip) });
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  const canvas = page.locator('#main-preview canvas');
  const snapshot = () => page.evaluate(() => window.uiStudio.snapshot().views[0]);
  const node = async () => (await snapshot()).inspection.nodes.find(n => n.id === 'region')!;
  const changes = async () => (await snapshot()).events.filter(e => e.id === 'region' && e.type === 'change');
  const click = async (x: number, y: number) => { await canvas.scrollIntoViewIfNeeded(); const b = await canvas.boundingBox(); if (!b) throw Error('canvas'); await page.mouse.click(b.x + x * b.width / 500, b.y + y * b.height / 400); };
  const capture = async (name: string) => { const bytes = await canvas.screenshot({path: info.outputPath(`${name}.png`)}); evidence.push({ name, sha256: createHash('sha256').update(bytes).digest('hex'), inspection: await node(), events: await changes() }); };
  // Read actual rasterized Pixi pixels. This does not construct an expected screenshot.
  const pixel = async (x: number, y: number) => page.evaluate(async ({data,x,y}) => {
    const image = new Image(); image.src = data; await image.decode();
    const copy = document.createElement('canvas'); copy.width = image.width; copy.height = image.height;
    const ctx = copy.getContext('2d')!; ctx.drawImage(image,0,0);
    return [...ctx.getImageData(Math.floor(x * copy.width / 500),Math.floor(y * copy.height / 400),1,1).data];
  }, {data:'data:image/png;base64,'+(await canvas.screenshot()).toString('base64'),x,y});
  const assertIcons = async () => {
    const n = await node(); expect(n.popupOpen).toBe(true);
    expect(n.popupItems?.map(i => [i.optionId,i.text])).toEqual([['red','RED CIRCLE'],['green','GREEN TRIANGLE'],['blue','BLUE DIAMOND']]);
    for (const [i,row] of n.popupItems!.entries()) {
      const b = row.iconBounds!; expect(b).not.toBeNull();
      expect(b.x).toBeGreaterThanOrEqual(78); expect(b.x + b.width).toBeLessThanOrEqual(106.001);
      expect(b.y).toBeGreaterThanOrEqual(134 + i * 48); expect(b.y + b.height).toBeLessThanOrEqual(162.001 + i * 48);
      expect(b.width / b.height).toBeCloseTo([1,20/32,2][i],4);
    }
    const red = await pixel(92,148), green = await pixel(92,196), blue = await pixel(92,244);
    expect(red[0]).toBeGreaterThan(red[1] * 2); expect(green[1]).toBeGreaterThan(green[0] * 2); expect(blue[2]).toBeGreaterThan(blue[0] * 2);
    // Transparent texture padding reveals popup; reserved icon boxes never cross the safe area.
    expect((await pixel(78,134)).slice(0,3)).toEqual([252,250,236]);
    expect((await pixel(70,120)).slice(0,3)).toEqual([252,250,236]);
  };
  expect((await node()).value).toBe('red'); expect((await node()).popupItems).toEqual([]);
  await capture('closed-initial');
  await click(160,84); await assertIcons(); await capture('open-three-icons');
  await click(64,190); expect((await node()).popupOpen).toBe(true); expect((await snapshot()).events.filter(e=>e.id==='behind'&&e.type==='activate')).toHaveLength(0);
  // A real hover must leave each icon/label attached to its option.
  const box = await canvas.boundingBox(); await page.mouse.move(box!.x+92*box!.width/500,box!.y+196*box!.height/400);
  await assertIcons(); await capture('hover-green');
  await click(92,196); expect((await node()).value).toBe('green'); expect((await node()).popupOpen).toBe(false);
  expect(await changes()).toHaveLength(1); expect((await changes())[0].source).toBe('mouse');
  expect((await snapshot()).events.filter(e=>e.id==='behind'&&e.type==='activate')).toHaveLength(0);
  await capture('selected-green-closed');
  expect((await node()).popupItems).toEqual([]); expect((await pixel(92,244)).slice(0,3)).toEqual([243,245,250]);
  // Pointer mode has no keyboard target. Tab enters Select, next Tab reaches Button; Shift+Tab returns.
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter');
  await assertIcons(); await page.keyboard.press('ArrowDown'); expect((await node()).value).toBe('blue');
  await page.keyboard.press('ArrowDown'); expect(await changes()).toHaveLength(2);
  await page.keyboard.press('ArrowUp'); expect((await node()).value).toBe('green');
  await assertIcons(); await capture('keyboard-green-open');
  await page.keyboard.press('Enter'); expect((await node()).popupOpen).toBe(false); expect(await changes()).toHaveLength(3);
  await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); expect((await node()).popupItems).toEqual([]);
  await click(160,84); await page.keyboard.press('Tab'); expect((await node()).popupOpen).toBe(false);
  await click(160,84); await click(92,196); expect(await changes()).toHaveLength(3); // same item emits no duplicate change
  await expect(canvas).toBeVisible(); await page.screenshot({path:info.outputPath('studio-page.png'),fullPage:true});
  const save = page.waitForEvent('download'); await page.locator('#studio-export').click();
  await (await save).saveAs(info.outputPath('saved.json'));
  await page.reload(); await page.locator('#open-bundle').setInputFiles(info.outputPath('saved.json'));
  await page.waitForFunction(()=>window.uiStudio?.snapshot().ready); expect((await node()).value).toBe('green');
  await click(160,84); await assertIcons(); await capture('saved-reopened'); await page.keyboard.press('Escape');
  const download = page.waitForEvent('download'); await page.getByRole('button',{name:'导出交付包',exact:true}).click();
  await (await download).saveAs(info.outputPath('roundtrip.zip'));
  const after = await componentHandoffEntries(new Uint8Array(await readFile(info.outputPath('roundtrip.zip'))));
  for (const [name,bytes] of f.entries) if (name !== 'handoff.json') expect(after.get(name),name).toEqual(bytes);
  const cli = fileURLToPath(new URL('../../scripts/cli.mjs',import.meta.url));
  const run = spawnSync(process.execPath,[cli,'component-handoff',info.outputPath('roundtrip.zip'),'--output',info.outputPath('cli-reimport.json')],{encoding:'utf8'});
  expect(run.status,run.stderr).toBe(0);
  await page.reload(); await page.locator('#open-bundle').setInputFiles(info.outputPath('cli-reimport.json'));
  await page.waitForFunction(()=>window.uiStudio?.snapshot().ready); await click(160,84); await assertIcons(); await click(92,244);
  expect((await node()).value).toBe('blue'); expect(await changes()).toHaveLength(1); await capture('cli-reimport-selected-blue');
  expect(errors).toEqual([]);
  await writeFile(info.outputPath('evidence.json'),JSON.stringify({human_visual_acceptance:false,fixture:'deterministic geometric images; no original observed state inferred',errors,evidence},null,2));
});

test('Legacy and explicit null icons preserve popup text and real selection', async ({page}) => {
  const f = await selectOptionIconsFixture();
  for (const legacy of [false,true]) {
    const binding = structuredClone(f.binding), state = binding.bindings[2].states.select;
    if (legacy) delete state.optionIcons; else state.optionIcons.items.find((i:any)=>i.optionId==='green').icon=null;
    const bundle = await applyAppearanceBinding(f.target,f.imported,binding);
    await page.goto('/workbench.html'); await page.waitForFunction(()=>!!window.uiHarness);
    await page.evaluate(b=>window.uiHarness.importBundle(b),bundle);
    const canvas=page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded(); const b=await canvas.boundingBox(); if(!b)throw Error('canvas');
    await page.mouse.click(b.x+160*b.width/500,b.y+84*b.height/400);
    let n=(await page.evaluate(()=>window.uiHarness.inspect())).nodes.find(n=>n.id==='region')!;
    expect(n.popupItems?.map(i=>i.text)).toEqual(['RED CIRCLE','GREEN TRIANGLE','BLUE DIAMOND']);
    expect(n.popupItems?.map(i=>!!i.iconBounds)).toEqual(legacy?[false,false,false]:[true,false,true]);
    await page.mouse.click(b.x+92*b.width/500,b.y+196*b.height/400);
    n=(await page.evaluate(()=>window.uiHarness.inspect())).nodes.find(n=>n.id==='region')!;
    expect(n.value).toBe('green');expect(n.popupItems).toEqual([]);
  }
});
