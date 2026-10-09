import { test, expect } from '@playwright/test';

// Built standalone SDK, real WebGL pixels and native input; art is a local fixture.
test('standalone SDK: background opt-out retains raster, layout, input and export/reopen', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/layer-plan-check.html');
  await page.waitForFunction(() => Boolean(window.layerPlanCheck));
  await page.evaluate(async () => {
    window.layerPlanCheck.destroy();
    document.body.innerHTML = '<div id="background-probe"></div>';
    const api = await import('/dist-browser/index.js');
    const preview = await api.createTreePreview(document.querySelector('#background-probe'), error => { throw error; });
    const style = {
      backgroundColor: '#2589E3', borderColor: '#FF0000', borderWidth: 6, cornerRadius: 30,
      textColor: '#FFFFFF', fontFamily: 'Arial', fontSize: 16, fontWeight: 'normal', opacity: 1,
    };
    const events = [];
    preview.subscribe(event => events.push(event));
    const art = document.createElement('canvas');
    art.width = 200; art.height = 180;
    const ctx = art.getContext('2d');
    ctx.fillStyle = '#47B875'; ctx.beginPath(); ctx.roundRect(0, 0, 200, 180, 36); ctx.fill();
    const bytes = new Uint8Array(await (await fetch(art.toDataURL())).arrayBuffer());
    const image = new Image(); image.src = art.toDataURL(); await image.decode();
    const documentFor = (type, flag, raster = '', modal = false) => {
      const part = {
        image: 'fixture/surface.png', canvas: { width: 200, height: 180 },
        layout: { x: 0, y: 0, width: 200, height: 180 },
      };
      const appearance = type === 'Container' ? { sourceCanvas: part.canvas, background: part } : {
        sourceCanvas: part.canvas, background: part, ...(type === 'Dialog' ? { header: part } : {}),
        titleLayout: { x: 14, y: 5, width: 160, height: 30 },
      };
      const surface = {
        id: 'surface', type, layout: { x: 40, y: 40, width: 200, height: 180 },
        props: {
          style, ...(flag === undefined ? {} : { drawBackground: flag }),
          ...(raster === 'native' ? { appearance } : {}),
          ...(type === 'Container' ? {} : { title: 'Surface' }),
          ...(type === 'Dialog' ? { open: true, modal,
            ...(modal ? { backdrop: { color: '#000000', opacity: 0.5 } } : {}) } : {}),
        },
        children: [
          ...(raster === 'child' ? [{ id: 'art', type: 'Image', layout: part.layout,
            props: { source: part.image, fit: 'stretch', drawBackground: false, style } }] : []),
          {
            id: 'action', type: 'Button', layout: { x: 30, y: 100, width: 130, height: 38 },
            props: {
              label: type === 'Dialog' ? 'Close' : 'Action', enabled: true,
              style: { ...style, backgroundColor: '#B04678', cornerRadius: 4 },
              interaction: type === 'Dialog' ? { version: '1.0', mode: 'internal',
                effects: [{ kind: 'dialog-open', targetId: 'surface', open: false }] } :
                { version: '1.0', mode: 'external', reason: 'Explicit fixture activation.' },
            }, children: [],
          },
        ],
      };
      return { schemaVersion: '0.2', id: 'background-probe', canvas: { width: 320, height: 260 }, root: {
        id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 320, height: 260 },
        props: { drawBackground: false, style }, children: [surface],
      } };
    };
    const load = async doc => {
      await preview.load(doc, new AbortController().signal, async () => image); preview.setZoom(1);
    };
    const pixels = async () => {
      const im = new Image(); im.src = preview.capturePng(); await im.decode();
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 260;
      const context = canvas.getContext('2d'); context.drawImage(im, 0, 0);
      return Array.from(context.getImageData(0, 0, 320, 260).data);
    };
    (window as any).backgroundProbe = { api, preview, events, documentFor, load, pixels, bytes };
  });

  for (const type of ['Container', 'Panel', 'Dialog']) {
    const result = await page.evaluate(async type => {
      const p = (window as any).backgroundProbe, samples = [];
      const pixel = (bytes, x, y) => bytes.slice((y * 320 + x) * 4, (y * 320 + x) * 4 + 4);
      for (const flag of [undefined, true, false]) {
        await p.load(p.documentFor(type, flag)); const bytes = await p.pixels();
        samples.push({ center: pixel(bytes, 60, 100), border: pixel(bytes, 41, 120),
          title: p.preview.inspect().nodes.find(n => n.id === 'surface').renderedTextBounds,
          childBounds: p.preview.inspect().nodes.find(n => n.id === 'action').bounds });
      }
      await p.load(p.documentFor(type, false, 'native')); const native = await p.pixels();
      await p.load(p.documentFor(type, true, 'child')); const childBefore = await p.pixels();
      await p.load(p.documentFor(type, false, 'child')); const childAfter = await p.pixels();
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', p.bytes)))
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      const saved = await p.api.validateBundle({ bundleVersion: '0.1', document: p.preview.getDocument(),
        resources: [{ id: 'fixture/surface.png', path: 'fixture/surface.png', mime: 'image/png', sha256,
          base64: btoa(String.fromCharCode(...p.bytes)) }],
        provenance: { kind: 'programmatic-fixture', description: 'Background opt-out regression fixture.' } });
      const reopened = await p.api.validateBundle(JSON.parse(JSON.stringify(saved)));
      await p.load(reopened.document); const reopenedPixels = await p.pixels();
      const faded = p.documentFor(type, false, 'child'); faded.root.children[0].props.style = {
        ...faded.root.children[0].props.style, opacity: 0.5,
      };
      await p.load(faded); const opacity = pixel(await p.pixels(), 60, 100)[3];
      await p.load(reopened.document);
      return { samples, nativeCenter: pixel(native, 60, 100), nativeCorner: pixel(native, 41, 41),
        leakBefore: pixel(childBefore, 47, 52), leakAfter: pixel(childAfter, 47, 52),
        childCenter: pixel(childAfter, 60, 100), opacity,
        reopenedExact: JSON.stringify(childAfter) === JSON.stringify(reopenedPixels),
        reopenedFlag: reopened.document.root.children[0].props.drawBackground,
        resourceExact: reopened.resources[0].base64 === saved.resources[0].base64 };
    }, type);
    expect(result.samples[0].center).toEqual([37, 137, 227, 255]);
    expect(result.samples[1].center).toEqual(result.samples[0].center);
    expect(result.samples[0].border[3]).toBe(255);
    expect(result.samples[2].center[3]).toBe(0); expect(result.samples[2].border[3]).toBe(0);
    expect(result.samples[2].childBounds).toEqual(result.samples[0].childBounds);
    if (type !== 'Container') expect(result.samples[2].title.length).toBeGreaterThan(0);
    expect(result.nativeCenter).toEqual([71, 184, 117, 255]); expect(result.nativeCorner[3]).toBe(0);
    expect(result.leakBefore[3]).toBeGreaterThan(200); expect(result.leakAfter[3]).toBe(0);
    expect(result.childCenter).toEqual([71, 184, 117, 255]);
    expect(result.opacity).toBeGreaterThanOrEqual(126); expect(result.opacity).toBeLessThanOrEqual(129);
    expect(result.reopenedExact).toBe(true); expect(result.reopenedFlag).toBe(false); expect(result.resourceExact).toBe(true);
    await page.locator('canvas').screenshot({ path: info.outputPath(`${type}-reopened.png`) });
  }

  await page.evaluate(async () => {
    const p = (window as any).backgroundProbe; await p.load(p.documentFor('Dialog', false, '', true));
  });
  const modal = await page.evaluate(async () => {
    const p = (window as any).backgroundProbe, bytes = await p.pixels();
    return { outside: bytes.slice(0, 4), inside: bytes.slice((100 * 320 + 60) * 4, (100 * 320 + 60) * 4 + 4) };
  });
  expect(modal.outside[3]).toBeGreaterThanOrEqual(126); expect(modal.outside[3]).toBeLessThanOrEqual(129);
  expect(modal.inside).toEqual(modal.outside);
  const canvas = page.locator('canvas'), box = await canvas.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.click(box!.x + 135, box!.y + 159);
  expect(await page.evaluate(() => (window as any).backgroundProbe.preview.inspect().nodes.find(n => n.id === 'surface').value)).toBe(false);
  const closed = await page.evaluate(async () => {
    const bytes = await (window as any).backgroundProbe.pixels(); return bytes.filter((_, i) => i % 4 === 3).every(alpha => alpha === 0);
  });
  expect(closed).toBe(true);
  await page.evaluate(async () => {
    const p = (window as any).backgroundProbe; await p.load(p.documentFor('Panel', false)); p.events.length = 0;
  });
  await page.mouse.click(box!.x + 135, box!.y + 159);
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  const sources = await page.evaluate(() => (window as any).backgroundProbe.events
    .filter(e => e.type === 'activate' && e.id === 'action').map(e => e.source));
  expect(sources).toEqual(['mouse', 'keyboard']);
  await page.evaluate(() => (window as any).backgroundProbe.preview.destroy());
  expect(await canvas.count()).toBe(0); expect(errors).toEqual([]);
});
