import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { renderPanelPng, validateRenderOptions } from '../src/node.mjs';

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, output: { type: 'string' }, config: { type: 'string' },
    width: { type: 'string' }, height: { type: 'string' }, resolution: { type: 'string' },
    browser: { type: 'string', default: 'chrome' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Panel Slicer — 面板自适应工具\nnode tools/panel-slicer/cli/render.mjs --input panel.png --width 640 --height 220 --output result.png\nOr: --input panel.png --config size.json --output result.png\nsize.json: {"width":640,"height":220,"resolution":1}\nOffline headless Pixi; Chrome must be installed. Existing outputs are never overwritten.');
  } else {
    let size;
    if (values.config) {
      if (['width', 'height', 'resolution'].some(k => values[k] !== undefined)) throw Object.assign(Error('Use either --config or size flags.'), { code: 'slice.options' });
      if ((await stat(values.config)).size > 16384) throw Object.assign(Error('Size config is too large.'), { code: 'slice.options' });
      size = validateRenderOptions(JSON.parse(await readFile(values.config, 'utf8')));
    } else size = validateRenderOptions({ width: Number(values.width), height: Number(values.height), resolution: values.resolution === undefined ? 1 : Number(values.resolution) });
    console.log(JSON.stringify(await renderPanelPng({ input: values.input, output: values.output, browser: values.browser, ...size })));
  }
} catch (e) {
  console.log(JSON.stringify({ kind: 'ui_panel_png_result', version: '1.0', status: 'failed', error: { code: e.code ?? 'slice.render', message: e.message } }));
  process.exitCode = 1;
}
