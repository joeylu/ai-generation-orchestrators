import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { channel } from 'node:diagnostics_channel';
import { deflateSync } from 'node:zlib';
import * as api from '../src/index.mjs';
import { verifyResult } from '../src/generation.mjs';
import { jsonBytes, local, readJson, seal, sha256, validationMemo, validationScope } from '../src/common.mjs';
import { crc32, decodePng, encodePng } from '../src/png.mjs';
import { setup, syntheticImage } from './helpers.mjs';

export function largeImage(width = 3072, height = 2048, seed = 7103) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let q = 0; q < rgba.length; q += 4) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    rgba[q] = seed & 255; rgba[q + 1] = seed >>> 8 & 255; rgba[q + 2] = seed >>> 16 & 255; rgba[q + 3] = 255;
  }
  return { width, height, rgba };
}
function counts(operation) {
  const events = [], diagnostic = channel('ui-reference.validation'), listener = event => events.push(event);
  diagnostic.subscribe(listener);
  try { return { value: operation(), events }; } finally { diagnostic.unsubscribe(listener); }
}
const count = (events, type) => events.filter(event => event.type === type).length;
function storeTechnical(root, run, changes) {
  const file = local(root, `${run}/technical.json`), { sha256: ignored, ...record } = readJson(file);
  fs.writeFileSync(file, jsonBytes(seal({ ...record, ...changes })));
}

test('large native PNG reuses verified evidence through status/DAG queries; later edits cannot hide in the scope', async t => {
  const { root } = await setup(t);
  const pixels = largeImage(), bytes = encodePng(pixels), plan = api.createPlan(root, { panelId: 'audio-settings', resolution: 'native' });
  assert.ok(bytes.length > 8 * 1024 * 1024);
  api.authorize(root, plan.run, plan.planSha256, 'Offline synthetic fixture only.');
  const request = api.reserve(root, plan.run), result = api.receive(root, plan.run, request.requestSha256, bytes);
  api.reviewRun(root, plan.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass', decision: 'accept', note: 'Synthetic fixture, no human art evidence.' });
  const dag = api.createProjectDag(root);
  const snapshot = counts(() => validationScope(() => {
    api.projectStatus(root); api.inspectRun(root, plan.run); api.inspectProjectDag(root, dag.dag);
    const first = verifyResult(root, plan.run); first.reference[0] ^= 1; first.plan.panelId = 'mutated';
    assert.equal(verifyResult(root, plan.run).plan.panelId, 'audio-settings');
    assert.equal(verifyResult(root, plan.run).reference[0], 137);
  }));
  assert.equal(count(snapshot.events, 'result-check'), 1);
  assert.equal(snapshot.events.filter(event => event.type === 'png-decode' && event.width === pixels.width).length, 1);
  assert.equal(snapshot.events.filter(event => event.type === 'png-encode' && event.width === pixels.width).length, 1);
  assert.equal(count(snapshot.events, 'alpha-scan'), 1);
  // A new top-level traversal recomputes; no process-wide approval cache.
  assert.equal(count(counts(() => verifyResult(root, plan.run)).events, 'result-check'), 1);
  const rawFile = local(root, `${plan.run}/raw.png`), original = fs.readFileSync(rawFile), stat = fs.statSync(rawFile);
  validationScope(() => {
    verifyResult(root, plan.run);
    const changed = Buffer.from(original); changed[changed.length - 5] ^= 1;
    fs.writeFileSync(rawFile, changed); fs.utimesSync(rawFile, stat.atime, stat.mtime);
    assert.throws(() => verifyResult(root, plan.run), /RESULT_INTEGRITY/);
  });
  fs.writeFileSync(rawFile, original);
  const reference = local(root, `${plan.run}/reference.png`), technicalFile = local(root, `${plan.run}/technical.json`);
  const originalTechnical = fs.readFileSync(technicalFile);
  validationScope(() => {
    verifyResult(root, plan.run);
    const replacement = syntheticImage(3072, 2048);
    fs.writeFileSync(reference, replacement); storeTechnical(root, plan.run, { imageSha256: sha256(replacement) });
    assert.throws(() => verifyResult(root, plan.run), /RESULT_INTEGRITY/);
  });
  fs.writeFileSync(reference, original); fs.writeFileSync(technicalFile, originalTechnical);
  validationScope(() => {
    verifyResult(root, plan.run);
    const terminal = local(root, `${plan.run}/terminal.json`); fs.writeFileSync(terminal, '{}');
    assert.throws(() => verifyResult(root, plan.run), /ATTEMPT_TERMINAL/);
    fs.unlinkSync(terminal);
  });
  // Self-consistent fingerprints do not excuse even a single alpha=254 pixel.
  pixels.rgba[pixels.rgba.length - 1] = 254;
  const transparent = encodePng(pixels);
  fs.writeFileSync(rawFile, transparent); fs.writeFileSync(reference, transparent);
  const receiptFile = local(root, `${plan.run}/receipt.json`), { sha256: ignored, ...receipt } = readJson(receiptFile);
  fs.writeFileSync(receiptFile, jsonBytes(seal({ ...receipt, rawSha256: sha256(transparent) })));
  storeTechnical(root, plan.run, { rawSha256: sha256(transparent), imageSha256: sha256(transparent) });
  assert.throws(() => api.projectStatus(root), /GENERATED_NOT_OPAQUE/);
  assert.throws(() => api.inspectProjectDag(root, dag.dag), /GENERATED_NOT_OPAQUE/);
  assert.throws(() => verifyResult(root, plan.run), /GENERATED_NOT_OPAQUE/);
});

test('different raw PNG encoding still requires exact normalized bytes and identical decoded pixels', async t => {
  const { root } = await setup(t), normalized = syntheticImage();
  const raw = Buffer.concat([normalized.subarray(0, -12), chunk('tEXt', Buffer.from('fixture\0metadata is stripped')), normalized.subarray(-12)]);
  const plan = api.createPlan(root, { panelId: 'audio-settings' });
  api.authorize(root, plan.run, plan.planSha256, 'Offline fixture.');
  const request = api.reserve(root, plan.run); api.receive(root, plan.run, request.requestSha256, raw);
  const checked = counts(() => verifyResult(root, plan.run));
  assert.ok(checked.value.reference.equals(normalized));
  // Prototype validation may also decode a 960px layout. The distinct raw and
  // normalized encodings must both be decoded, in addition to those inputs.
  assert.ok(checked.events.filter(event => event.type === 'png-decode' && event.width === 960).length >= 2);
  const pixels = decodePng(normalized), rows = Buffer.alloc((960 * 4 + 1) * 640);
  for (let y = 0; y < 640; y++) pixels.rgba.copy(rows, y * (960 * 4 + 1) + 1, y * 960 * 4, (y + 1) * 960 * 4);
  const alternate = Buffer.concat([normalized.subarray(0, 33), chunk('IDAT', deflateSync(rows, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
  assert.ok(decodePng(alternate).rgba.equals(pixels.rgba));
  assert.ok(!alternate.equals(normalized));
  validationScope(() => {
    verifyResult(root, plan.run);
    fs.writeFileSync(local(root, `${plan.run}/reference.png`), alternate);
    storeTechnical(root, plan.run, { imageSha256: sha256(alternate) });
    assert.throws(() => verifyResult(root, plan.run), /RESULT_INTEGRITY/);
  });
});

function chunk(type, data) {
  const name = Buffer.from(type), value = Buffer.alloc(data.length + 12);
  value.writeUInt32BE(data.length); name.copy(value, 4); data.copy(value, 8);
  value.writeUInt32BE(crc32(Buffer.concat([name, data])), value.length - 4); return value;
}
test('decoder preserves every PNG filter, supported color model, transparency, CRC and canonical level-9 bytes', () => {
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (const color of [0, 2, 3, 4, 6]) {
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color], width = 7, height = 5, stride = width * channels;
    const pixels = Buffer.from(Array.from({ length: stride * height }, (_, i) => color === 3 ? i % 3 : i * 17 % 256));
    const rows = Buffer.alloc((stride + 1) * height), header = Buffer.alloc(13);
    header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = color;
    for (let y = 0; y < height; y++) {
      rows[y * (stride + 1)] = y;
      for (let x = 0; x < stride; x++) {
        const i = y * stride + x, a = x >= channels ? pixels[i - channels] : 0, b = y ? pixels[i - stride] : 0, c = y && x >= channels ? pixels[i - stride - channels] : 0;
        rows[y * (stride + 1) + 1 + x] = pixels[i] - [0, a, b, (a + b) >>> 1, paeth(a, b, c)][y] & 255;
      }
    }
    const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...(color === 3 ? [chunk('PLTE', palette), chunk('tRNS', Buffer.from([0, 128, 255]))] : []), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
    const decoded = decodePng(bytes), expected = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const p = i * channels, q = i * 4;
      let r = pixels[p], g = channels > 1 ? pixels[p + 1] : r, b = channels > 2 ? pixels[p + 2] : r, alpha = color === 4 ? pixels[p + 1] : color === 6 ? pixels[p + 3] : 255;
      if (color === 4) g = b = r;
      if (color === 3) { const index = pixels[p]; r = palette[index * 3]; g = palette[index * 3 + 1]; b = palette[index * 3 + 2]; alpha = [0, 128, 255][index]; }
      expected.set([alpha ? r : 0, alpha ? g : 0, alpha ? b : 0, alpha], q);
    }
    assert.ok(decoded.rgba.equals(expected));
    assert.ok(decodePng(encodePng(decoded)).rgba.equals(expected));
    const bad = Buffer.from(bytes); bad[bad.length - 1] ^= 1; assert.throws(() => decodePng(bad), /PNG_CRC/);
  }
});

test('nested validation scopes reject asynchronous memo operations and discard failures', () => {
  assert.throws(() => validationScope(() => validationScope(() => Promise.resolve())), /SYNC_REQUIRED/);
  assert.throws(() => validationScope(() => validationMemo('async', () => Promise.resolve())), /SYNC_REQUIRED/);
  let attempts = 0;
  validationScope(() => {
    assert.throws(() => validationMemo('failure', () => { attempts++; throw Error('fixture'); }), /fixture/);
    assert.equal(validationMemo('failure', () => { attempts++; return 7; }), 7);
  });
  assert.equal(attempts, 2);
});
