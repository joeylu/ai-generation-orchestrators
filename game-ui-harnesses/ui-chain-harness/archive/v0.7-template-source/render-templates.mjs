/** Documentation-only PNG renderer. No model calls, server, or Harness execution.
 * Run from any directory with the existing ui-component-harness dependencies installed:
 * node game-ui-harnesses/ui-chain-harness/scripts/render-templates.mjs [chromium|chrome|msedge]
 * Source: ../configs/skin-template-set.draft.json. See ../docs/execution-plan.md.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = new URL('./', import.meta.url);
const outputBase = new URL('../previews/skin-templates/', base);
const require = createRequire(new URL('../../ui-component-harness/package.json', base));
const { chromium } = require('playwright');
const pixiFile = fileURLToPath(new URL('../../ui-component-harness/node_modules/pixi.js/dist/pixi.min.js', base));
const sourceBytes = await readFile(new URL('../configs/skin-template-set.draft.json', base));
const spec = JSON.parse(sourceBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(spec.kind, 'ui_skin_template_set_draft');
assert.equal(spec.version, '0.1');
assert.equal(spec.coordinates.width, spec.coordinates.height);
assert.equal(spec.coordinates.outputScale, 1);
const codes = new Set(), ids = new Set(), prefixes = new Set();
for (const sheet of spec.sheets) {
  assert.match(sheet.filePrefix, /^s\d{2}-[a-z-]+$/);
  assert(!prefixes.has(sheet.filePrefix)); prefixes.add(sheet.filePrefix);
  for (const [index, part] of sheet.parts.entries()) {
    assert(!codes.has(part.code) && !ids.has(part.assetId));
    codes.add(part.code); ids.add(part.assetId);
    assert(part.slotRect.length === 4 && part.bodyRect.length === 4);
    assert([...part.slotRect, ...part.bodyRect].every(Number.isFinite));
    const [x,y,w,h] = part.slotRect, [bx,by,bw,bh] = part.bodyRect;
    assert(w > 0 && h > 0 && bw > 0 && bh > 0);
    const { width, height } = spec.coordinates;
    const { minimumOuterMargin: margin, minimumBodyPadding: padding, minimumSlotGap: gap } = spec.constraints;
    assert(x >= margin && y >= margin && x+w <= width-margin && y+h <= height-margin);
    assert(Math.min(bx-x, by-y, x+w-bx-bw, y+h-by-bh) >= padding);
    assert(['roundRect','circle','ring','polygon'].includes(part.primitive.type));
    assert(Object.hasOwn(spec.palette, part.paint));
    for (const other of sheet.parts.slice(0,index)) {
      const [ox,oy,ow,oh] = other.slotRect;
      assert(Math.max(ox-x-w, x-ox-ow, oy-y-h, y-oy-oh) >= gap);
    }
  }
}

const channel = process.argv[2] ?? 'chromium';
assert(['chromium','chrome','msedge'].includes(channel));
await mkdir(outputBase, { recursive: true });
const browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const files = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.route('**/*', route => route.abort());
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>');
  await page.addScriptTag({ path: pixiFile });
  const runtimeVersion = await page.evaluate(() => PIXI.VERSION);
  for (const sheet of spec.sheets) {
    for (const mode of ['clean','review']) {
      const result = await page.evaluate(async ({ spec, sheet, mode }) => {
        const { Application, Graphics, Text } = PIXI;
        const app = new Application();
        await app.init({ width: spec.coordinates.width, height: spec.coordinates.height,
          resolution: 1, backgroundAlpha: 0, antialias: true, preference: 'webgl', autoStart: false,
          preserveDrawingBuffer: true });
        document.body.appendChild(app.canvas);
        const palette = spec.palette;
        let texts = 0;
        function text(value, x, y, size = 14, color = palette.reviewText, center = false) {
          const t = new Text({ text: value, style: { fontFamily: spec.reviewFont.family, fontSize: size, fill: color } });
          t.x=x; t.y=y; if (center) t.anchor.set(0.5,0);
          app.stage.addChild(t); texts++;
        }
        if (mode === 'review') {
          app.stage.addChild(new Graphics().rect(0,0,1024,1024).fill(palette.reviewBackground));
          text(`${sheet.id}  ${sheet.title}`,32,7,14);
          text('1:1  /  1024 x 1024  /  JSON → PixiJS',700,7,12,palette.reviewMuted);
        }
        for (const part of sheet.parts) {
          const [x,y,w,h] = part.bodyRect, [sx,sy,sw,sh] = part.slotRect;
          const g = new Graphics(), color = palette[part.paint];
          if (part.primitive.type === 'roundRect') {
            g.roundRect(x,y,w,h,part.primitive.radius).fill(color);
            if (part.strokeWidth) g.stroke({ color: palette.stroke, width: part.strokeWidth, alignment: 1 });
          } else if (part.primitive.type === 'circle') {
            g.ellipse(x+w/2,y+h/2,w/2,h/2).fill(color);
            if (part.strokeWidth) g.stroke({ color: palette.stroke, width: part.strokeWidth, alignment: 1 });
          } else if (part.primitive.type === 'ring') {
            g.ellipse(x+w/2,y+h/2,w/2,h/2).stroke({ color, width: part.strokeWidth, alignment: 1 });
          } else {
            g.poly(part.primitive.points.flatMap(([px,py])=>[x+px,y+py]),true).fill(color);
          }
          app.stage.addChild(g);
          if (mode === 'review') {
            app.stage.addChild(new Graphics().rect(sx,sy,sw,sh).stroke({color:palette.reviewSlot,width:1,alignment:1}));
            const pending=part.productionPolicy === 'raster-or-procedural-undecided';
            text(`${part.code}  ${part.label}`,sx+10,sy+7,13,pending ? palette.reviewPending : palette.reviewText);
            text(`${w} × ${h}`,sx+sw-76,sy+sh-22,12,palette.reviewMuted);
            if (pending) text('结构标记：生产方式待定',sx+10,sy+sh-43,12,palette.reviewPending);
          }
        }
        app.render();
        const png = app.canvas.toDataURL('image/png');
        const result = { png, textNodes: texts, width: app.canvas.width, height: app.canvas.height };
        app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true, texture: true, textureSource: true });
        return result;
      }, { spec, sheet, mode });
      assert.equal(result.width, spec.coordinates.width);
      assert.equal(result.height, spec.coordinates.height);
      if (mode === 'clean') assert.equal(result.textNodes, 0);
      const bytes = Buffer.from(result.png.split(',')[1], 'base64');
      const file = `${sheet.filePrefix}.${mode}.png`;
      await writeFile(new URL(file, outputBase), bytes);
      files.push({ sheet: sheet.id, role: mode, file, width: result.width, height: result.height,
        partCount: sheet.parts.length, textNodes: result.textNodes, sha256: hash(bytes) });
      console.log(`${file}: ${result.width}x${result.height}, ${sheet.parts.length} parts, ${result.textNodes} text nodes`);
    }
  }
  assert.deepEqual(errors, []);
  const record = { kind: 'ui_skin_template_documentation_render', source: '../../configs/skin-template-set.draft.json',
    rendererSource: '../../scripts/render-templates.mjs',
    sourceSha256: hash(sourceBytes), rendererSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    renderer: `pixi.js@${runtimeVersion}`, browser: browser.version(), channel, backend: 'headless-webgl-swiftshader',
    scope: 'documentation template rendering only; no model generation or component runtime acceptance',
    networkRequests: 'blocked', files };
  await writeFile(new URL('template-render-record.json',outputBase),JSON.stringify(record,null,2)+'\n');
} finally {
  await browser.close();
}
