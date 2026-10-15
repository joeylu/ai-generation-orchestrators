import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { root, fail } from './contract.mjs';

export async function renderSheets({ spec, directory, channel = 'chromium' }) {
  if (!['chromium','chrome','msedge'].includes(channel)) fail('/browser', 'browser.channel', '支持 chromium、chrome 或 msedge。');
  const browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  try {
    const { width, height } = spec.coordinates;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const errors = [];
    await page.route('**/*', route => route.abort());
    page.on('pageerror', () => errors.push('pageerror'));
    await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0"></body>');
    await page.addScriptTag({ path: fileURLToPath(new URL('node_modules/pixi.js/dist/pixi.min.js', root)) });
    const version = await page.evaluate(() => PIXI.VERSION);
    const files = [];
    for (const sheet of spec.sheets) for (const mode of ['clean','review']) {
      const result = await page.evaluate(async ({ spec, sheet, mode }) => {
        const { Application, Graphics, Text } = PIXI;
        const { width, height, outputScale } = spec.coordinates;
        const app = new Application();
        await app.init({ width, height, resolution: outputScale, backgroundAlpha: 0, antialias: true,
          preference: 'webgl', autoStart: false, preserveDrawingBuffer: true });
        document.body.appendChild(app.canvas);
        try {
          const palette = spec.palette, size = spec.reviewFont.size;
          let textNodes = 0;
          function label(value, x, y, maxWidth, color = palette.reviewText) {
            const text = new Text({ text: value, style: { fontFamily: spec.reviewFont.family, fontSize: size, fill: color } });
            if (text.width > maxWidth) text.scale.set(maxWidth/text.width);
            text.position.set(x,y);
            app.stage.addChild(text); textNodes++;
          }
          if (mode === 'review') {
            app.stage.addChild(new Graphics().rect(0,0,width,height).fill(palette.reviewBackground));
            const margin = spec.constraints.minimumOuterMargin;
            label(`${sheet.id}  ${sheet.title}  |  1:1  ${width} × ${height}  |  PNG ${width*outputScale} × ${height*outputScale}`, margin, (margin-size)/2, width-2*margin);
          }
          for (const part of sheet.parts) {
            const [x,y,w,h] = part.bodyRect, [sx,sy,sw,sh] = part.slotRect;
            const graphics = new Graphics(), color = palette[part.paint];
            if (part.primitive.type === 'roundRect') graphics.roundRect(x,y,w,h,part.primitive.radius).fill(color);
            else if (part.primitive.type === 'circle') graphics.circle(x+w/2,y+h/2,w/2).fill(color);
            else if (part.primitive.type === 'ring') graphics.circle(x+w/2,y+h/2,w/2);
            else if (part.primitive.type === 'polygon') graphics.poly(part.primitive.points.flatMap(([px,py]) => [x+px,y+py]),true).fill(color);
            if (part.strokeWidth) graphics.stroke({ color: part.primitive.type === 'ring' ? color : palette.stroke, width: part.strokeWidth, alignment: 1 });
            app.stage.addChild(graphics);
            if (mode === 'review') {
              app.stage.addChild(new Graphics().rect(sx,sy,sw,sh).stroke({ color: palette.reviewSlot, width: 1, alignment: 1 }));
              const pending = part.productionPolicy === 'raster-or-procedural-undecided';
              label(`${part.code}  ${part.label}${pending ? '（生产待定）' : ''}`, sx+4, sy+2, sw-8, pending ? palette.reviewPending : palette.reviewText);
              label(`${w} × ${h}`, sx+4, sy+sh-size-4, sw-8, palette.reviewMuted);
            }
          }
          app.render();
          const canvas = document.createElement('canvas');
          canvas.width = app.canvas.width; canvas.height = app.canvas.height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(app.canvas,0,0);
          const pixels = context.getImageData(0,0,canvas.width,canvas.height).data;
          let opaque = 0, transparent = 0, stray = 0;
          const counts = sheet.parts.map(() => 0);
          const boxes = sheet.parts.map(p => p.bodyRect.map(v => v*outputScale));
          for (let y=0; y<canvas.height; y++) for (let x=0; x<canvas.width; x++) {
            const alpha = pixels[(y*canvas.width+x)*4+3];
            if (!alpha) { transparent++; continue; }
            opaque++;
            if (mode === 'clean') {
              const index = boxes.findIndex(([bx,by,bw,bh]) => x>=bx && y>=by && x<bx+bw && y<by+bh);
              if (index < 0) stray++; else counts[index]++;
            }
          }
          const ringCentersClear = sheet.parts.every(part => {
            if (part.primitive.type !== 'ring') return true;
            const [x,y,w,h] = part.bodyRect;
            return pixels[(Math.floor((y+h/2)*outputScale)*canvas.width+Math.floor((x+w/2)*outputScale))*4+3] === 0;
          });
          return { png: app.canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, textNodes,
            checks: { paintedPixels: opaque, transparentPixels: transparent, strayPixels: stray, partPaintedPixels: counts, ringCentersClear: mode === 'clean' ? ringCentersClear : null } };
        } finally {
          app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true, texture: true, textureSource: true });
        }
      }, { spec, sheet, mode });
      const expected = spec.coordinates.width*spec.coordinates.outputScale;
      if (result.width !== expected || result.height !== expected || !result.checks.paintedPixels) fail('/render', 'render.dimensions', 'PNG 尺寸或可见内容不正确。');
      if (mode === 'clean' && (result.textNodes !== 0 || !result.checks.transparentPixels || result.checks.strayPixels || !result.checks.ringCentersClear || result.checks.partPaintedPixels.some(n => n === 0))) fail('/render', 'render.pixels', '无标注模板的透明、主体范围、部件存在或空心圆检查失败。');
      const file = `${sheet.filePrefix}.${mode}.png`;
      await writeFile(join(directory,file), Buffer.from(result.png.split(',')[1], 'base64'), { flag: 'wx' });
      const { png, ...evidence } = result;
      files.push({ file, sheetId: sheet.id, role: mode, partCount: sheet.parts.length, ...evidence });
    }
    if (errors.length) fail('/render', 'render.browser', '浏览器脚本报错；本次构建未发布。');
    return { renderer: `pixi.js@${version}`, browser: browser.version(), channel,
      backend: 'headless-webgl-swiftshader', networkRequests: 'blocked', files };
  } finally { await browser.close(); }
}
