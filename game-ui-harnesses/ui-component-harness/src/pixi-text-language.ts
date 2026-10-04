import { CanvasPool, CanvasTextMetrics, DOMAdapter } from 'pixi.js';

let installedAdapter: ReturnType<typeof DOMAdapter.get> | undefined;
let baseAdapter: ReturnType<typeof DOMAdapter.get> | undefined;
let installedLanguage: string | undefined;

/** Detached raster canvases must use the same language as OffscreenCanvas metrics. */
export function preparePixiTextLanguage(): void {
  const language = document.documentElement.lang || navigator.language;
  const current = DOMAdapter.get();
  if (current === installedAdapter && language === installedLanguage) return;
  if (current !== installedAdapter) baseAdapter = current;
  const adapter = baseAdapter!;
  installedAdapter = {
    ...adapter,
    createCanvas(width, height) {
      const canvas = adapter.createCanvas(width, height);
      // Do not request a 2D context here: this factory also creates WebGL canvases.
      if ('lang' in canvas) (canvas as typeof canvas & { lang: string }).lang = language;
      return canvas;
    },
  };
  DOMAdapter.set(installedAdapter);
  // Discard only unused pooled canvases, whose inherited language may be stale.
  CanvasPool.clear();
  const context = CanvasTextMetrics._context;
  if ('lang' in context) (context as typeof context & { lang: string }).lang = language;
  CanvasTextMetrics.clearMetrics();
  installedLanguage = language;
}
