import { readFile, writeFile, mkdir, stat, lstat, link, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { decodePng } from '../../../src/skins/png.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
export function validateRenderOptions(options) {
  if (!options || Object.keys(options).some(k => !['width', 'height', 'resolution'].includes(k)))
    fail('slice.options', 'Size configuration accepts only width, height and resolution.');
  const { width, height, resolution = 1 } = options;
  if (![width, height].every(n => Number.isInteger(n) && n >= 24 && n <= 4096)
    || ![1, 2, 4].includes(resolution) || Math.max(width, height) * resolution > 4096)
    fail('slice.options', 'Width/height must be integers 24–4096; resolution is 1, 2 or 4; output sides must not exceed 4096.');
  return { width, height, resolution };
}

export async function renderPanelPng({ input, output, width, height, resolution = 1, browser: channel = 'chrome' }) {
  const size = validateRenderOptions({ width, height, resolution });
  if (typeof input !== 'string' || !input || typeof output !== 'string' || !output)
    fail('slice.paths', 'Input PNG and output PNG paths are required.');
  if (!['chrome', 'chromium'].includes(channel)) fail('slice.browser', 'Browser must be chrome or chromium.');
  const source = resolve(input), destination = resolve(output);
  if (source.toLowerCase() === destination.toLowerCase()) fail('slice.output-exists', 'Output must not replace the input PNG.');
  try { await lstat(destination); fail('slice.output-exists', 'Output already exists; choose a new path.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const info = await stat(source);
  if (!info.isFile() || info.size > 32 * 1024 * 1024) fail('slice.input-size', 'Input must be a PNG file no larger than 32 MiB.');
  const bytes = await readFile(source);
  const bundle = await build({ absWorkingDir: root, entryPoints: ['tools/panel-slicer/src/headless-entry.mjs'], bundle: true,
    write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true, logLevel: 'silent' });
  const html = `<meta charset="utf-8"><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`;
  let browser, timer;
  let result;
  try {
    browser = await chromium.launch({ ...(channel === 'chrome' ? { channel } : {}), headless: true,
      timeout: 30000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ serviceWorkers: 'block' });
    // Fulfilled in memory: no listening server and no outgoing requests.
    await page.route('**/*', route => route.request().isNavigationRequest() && route.request().url() === 'http://127.0.0.1/panel-render'
      ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    await page.goto('http://127.0.0.1/panel-render', { timeout: 30000 });
    result = await Promise.race([
      page.evaluate(args => window.renderPanelPng(args), { pngBase64: bytes.toString('base64'), ...size }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('Panel render timed out.'), { code: 'slice.timeout' })), 60000); }),
    ]);
    if (!result.ok) fail(result.code, result.message);
  } finally { clearTimeout(timer); await browser?.close(); }
  const png = Buffer.from(result.pngBase64, 'base64'), decoded = decodePng(png);
  if (decoded.width !== width * resolution || decoded.height !== height * resolution)
    fail('slice.output-invalid', 'Rendered PNG dimensions do not match the request.');
  await mkdir(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.panel-render-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, png, { flag: 'wx' });
    // Atomic, no-clobber publication. A concurrent caller cannot be overwritten.
    await link(temporary, destination);
  } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  return { kind: 'ui_panel_png_result', version: '1.0', status: 'succeeded', output,
    width: decoded.width, height: decoded.height, bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'), document: result.document };
}
