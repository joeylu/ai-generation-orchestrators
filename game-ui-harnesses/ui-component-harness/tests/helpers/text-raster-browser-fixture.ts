import { CanvasTextGenerator, CanvasTextMetrics, TextStyle } from 'pixi.js';
import { createTreePreview } from '../../src/tree-runtime.ts';

export async function textRasterFixture() {
  const style = {
    backgroundColor: '#FFFFFF', borderColor: '#FFFFFF', borderWidth: 0,
    cornerRadius: 0, textColor: '#000000', fontFamily: 'sans-serif',
    fontSize: 44, fontWeight: 'bold' as const, opacity: 1,
  };
  const samples = ['30', '50', '20', '250'].map(text => ({
    text, fontSize: text === '250' ? 38 : 44,
  }));
  const host = document.getElementById('check-canvas')!;
  const preview = await createTreePreview(host, () => {});
  try {
    await preview.load({
      schemaVersion: '0.2', id: 'generic-digit-raster',
      canvas: { width: 240, height: 340 },
      root: {
        id: 'root', type: 'Container',
        layout: { x: 0, y: 0, width: 240, height: 340 }, props: { style },
        children: samples.map(({ text, fontSize }, i) => ({
          id: 'digits-' + i, type: 'Text',
          layout: { x: 20, y: 20 + i * 80, width: 150, height: 65 },
          props: {
            text, wrap: 'none', overflow: 'error', drawBackground: false,
            lineHeight: 55, style: { ...style, fontSize },
          },
        })),
      },
    }, new AbortController().signal);
    const rows = samples.map(({ text, fontSize }) => {
      const textStyle = new TextStyle({
        fontFamily: style.fontFamily, fontSize, fontWeight: 'bold',
        fill: '#000000', lineHeight: 55,
      });
      const generated = CanvasTextGenerator.getCanvasAndContext({ text, style: textStyle, resolution: 1 });
      try {
        const { canvas, context } = generated.canvasAndContext;
        const actual = context.measureText(text);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let outside = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (data[(y * canvas.width + x) * 4 + 3]
              && (x >= generated.frame.width || y >= generated.frame.height)) outside++;
          }
        }
        return {
          text, fontSize, measuredWidth: CanvasTextMetrics.measureText(text, textStyle).width,
          drawWidth: actual.width, inkRight: actual.actualBoundingBoxRight,
          frameWidth: generated.frame.width, outsidePixels: outside,
        };
      } finally {
        CanvasTextGenerator.returnCanvasAndContext(generated.canvasAndContext);
      }
    });
    return { rows, png: preview.capturePng(), inspection: preview.inspect() };
  } finally {
    preview.destroy();
  }
}
