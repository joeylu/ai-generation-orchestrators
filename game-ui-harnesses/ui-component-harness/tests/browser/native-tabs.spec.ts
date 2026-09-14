import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { nativeTabsHandoff, nativeTabCells } from '../helpers/native-tabs-fixture.ts';

test('official CLI imports unequal native Tabs; all bases, icons, cell edges and gaps work on PixiJS', async ({ page }, info) => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'native-tabs-'));
  let bundle;
  try {
    const input = resolve(temporary, 'handoff.zip'), output = resolve(temporary, 'bundle.json');
    await writeFile(input, await nativeTabsHandoff());
    execFileSync(process.execPath, ['scripts/cli.mjs', 'component-handoff', input, '--output', output]);
    bundle = JSON.parse(await readFile(output, 'utf8'));
  } finally { await rm(temporary, { recursive: true, force: true }); }
  await page.goto('/workbench.html'); await page.waitForFunction(() => Boolean(window.uiHarness));
  await page.evaluate(b => window.uiHarness.importBundle(b), bundle);
  const canvas = page.locator('#canvas-host canvas');
  const click = async (x: number, y = 60) => { const box = await canvas.boundingBox(); if (!box) throw Error('CANVAS_MISSING'); await page.mouse.click(box.x + x * box.width / 1000, box.y + y * box.height / 240); };
  const value = () => page.evaluate(() => window.uiHarness.inspect().nodes.find(n => n.id === 'native-tabs')?.value);
  const sample = async (name: string) => {
    const bytes = await canvas.screenshot({ path: info.outputPath(name + '.png') });
    return page.evaluate(async ({ data, cells }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
      const c = document.createElement('canvas'); c.width = 1000; c.height = 240; const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const rgb = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
      return cells.map(q => ({ base: rgb(20 + q.x + q.width - 8, 30), icon: rgb(20 + q.x + 25, 60) }));
    }, { data: bytes.toString('base64'), cells: nativeTabCells });
  };
  for (const [index, cell] of nativeTabCells.entries()) {
    // This left edge is not the old equal-cell center; the first cell exceeds 1/3.
    await click(20 + cell.x + 5);
    expect(await value()).toBe(cell.id);
    const pixels = await sample(cell.id);
    for (let i = 0; i < 3; i++) {
      expect(pixels[i].base).toEqual(i === index ? [20, 150 + i * 30, 210] : [30 + i * 30, 50, 70]);
      expect(pixels[i].icon).toEqual(i === index ? [250, 240, 210] : [180, 90, 60]);
    }
  }
  await click(20 + 370); expect(await value()).toBe('accessibility');
  await click(20 + 656); expect(await value()).toBe('accessibility');
  await click(20 + 367); expect(await value()).toBe('combat');
});
