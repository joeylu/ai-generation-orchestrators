import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { channel } from 'node:diagnostics_channel';
import assert from 'node:assert/strict';

const mode = process.argv[2];
assert.ok(['baseline', 'optimized'].includes(mode));
const source = path.resolve(process.argv[3] ?? path.resolve(import.meta.dirname, '../../..'));
const output = process.argv[4];
assert.ok(output, 'Use: node tests/benchmark-validation.mjs baseline|optimized SOURCE_ROOT REPORT_JSON');
const reference = path.join(source, 'game-ui-harnesses/ui-reference-harness');
// Baseline counters are injected only into loaded code. Source files and their
// runtime fingerprints remain unchanged; no algorithm or compression changes.
if (mode === 'baseline') {
  const prefix = pathToFileURL(path.join(reference, 'src')).href + '/';
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.startsWith(prefix)) return loaded;
    let code = String(loaded.source);
    if (url.endsWith('/png.mjs')) {
      code = "import { channel as benchChannel } from 'node:diagnostics_channel';\n" + code;
      code = code.replace('export function encodePng({ width, height, rgba }) {', "export function encodePng({ width, height, rgba }) { benchChannel('ui-reference.validation').publish({type:'png-encode',width,height});");
      code = code.replace('const width = header.readUInt32BE(0), height = header.readUInt32BE(4), color = header[9];', "const width = header.readUInt32BE(0), height = header.readUInt32BE(4), color = header[9]; benchChannel('ui-reference.validation').publish({type:'png-decode',width,height});");
    }
    if (url.endsWith('/generation.mjs')) {
      code = "import { channel as benchChannel } from 'node:diagnostics_channel';\n" + code;
      code = code.replace('function verifyResultEvidence(root, run) {', "function verifyResultEvidence(root, run) { benchChannel('ui-reference.validation').publish({type:'result-check'});");
      code = code.replace('let first = null, varied = false;', "let first = null, varied = false; benchChannel('ui-reference.validation').publish({type:'alpha-scan',width:image.width,height:image.height});");
    }
    return { ...loaded, source: code };
  } });
}
const load = relative => import(pathToFileURL(path.join(reference, relative)).href);
const api = await load('src/index.mjs'), { verifyResult } = await load('src/generation.mjs');
const { setup } = await load('tests/helpers.mjs');
const { encodePng, crc32 } = await load('src/png.mjs');
const { sha256, validationScope } = await load('src/common.mjs');
assert.equal(api.VERSION, mode === 'baseline' ? '0.8.2' : '0.8.3');
const cleanup = [], { root } = await setup({ after: fn => cleanup.push(fn) });
const width = 3072, height = 2048, rgba = Buffer.alloc(width * height * 4);
let seed = 7103;
for (let q = 0; q < rgba.length; q += 4) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  rgba[q] = seed & 255; rgba[q + 1] = seed >>> 8 & 255; rgba[q + 2] = seed >>> 16 & 255; rgba[q + 3] = 255;
}
function annotated(bytes) {
  const data = Buffer.from('fixture\0offline synthetic large UI-size raster'), name = Buffer.from('tEXt'), chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); name.copy(chunk, 4); data.copy(chunk, 8); chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), chunk.length - 4);
  return Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)]);
}
try {
  const image = annotated(encodePng({ width, height, rgba })), imageSha256 = sha256(image);
  async function complete(plan, bytes) {
    api.authorize(root, plan.run, plan.planSha256, 'Offline benchmark fixture, no provider.');
    const request = api.reserve(root, plan.run), result = api.receive(root, plan.run, request.requestSha256, bytes);
    api.reviewRun(root, plan.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass', decision: 'accept', note: 'Synthetic benchmark acceptance only.' });
    return result;
  }
  const first = api.createPlan(root, { panelId: 'audio-settings', resolution: 'native' });
  await complete(first, image);
  rgba[0] ^= 31;
  const revisedImage = annotated(encodePng({ width, height, rgba }));
  const revision = api.createRevisionPlan(root, { sourceRun: first.run, note: 'Synthetic contrast revision.' });
  const revised = await complete(revision, revisedImage);
  const dag = api.createProjectDag(root);
  const operations = {
    verifyResult: () => verifyResult(root, revision.run),
    projectStatus: () => api.projectStatus(root),
    inspectRun: () => api.inspectRun(root, revision.run),
    inspectProjectDag: () => api.inspectProjectDag(root, dag.dag),
    combinedQuery: () => validationScope(() => { api.projectStatus(root); api.inspectRun(root, revision.run); api.inspectProjectDag(root, dag.dag); }),
  };
  const measurements = {};
  for (const [name, operation] of Object.entries(operations)) {
    operation(); // separate warm-up; no cache survives it
    const trials = [];
    for (let trial = 0; trial < 3; trial++) {
      const events = [], diagnostic = channel('ui-reference.validation'), listener = event => events.push(event);
      diagnostic.subscribe(listener);
      const start = performance.now();
      try { operation(); } finally { diagnostic.unsubscribe(listener); }
      const types = ['result-check', 'alpha-scan', 'png-decode', 'png-encode'];
      trials.push({ elapsedMs: +(performance.now() - start).toFixed(3), counts: Object.fromEntries(types.map(type => [type, events.filter(event => event.type === type && (!type.startsWith('png-') || event.width === width)).length])) });
    }
    measurements[name] = { medianMs: [...trials].map(value => value.elapsedMs).sort((a,b)=>a-b)[1], trials };
    console.log(JSON.stringify({ mode, name, ...measurements[name] }));
  }
  const report = { mode, baselineCommit: '41ac69a2d512a7f9cf41a0c423797c75b09dffc8', width, height, imageBytes: image.length, imageSha256, revisedImageSha256: sha256(revisedImage), normalizedSha256: revised.imageSha256, trials: 3, warmups: 1, node: process.version, modelCalls: 0, measurements };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
} finally { for (const fn of cleanup.reverse()) await fn(); }
