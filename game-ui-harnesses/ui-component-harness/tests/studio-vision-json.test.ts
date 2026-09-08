import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVisionJson } from '../scripts/studio-vision-json.mjs';

const prefix = { version: '0.1', sourceSha256: 'a'.repeat(64), status: 'Ready', summary: 'Quoted } braces ","policy": stay text.', intent: { intentVersion: '0.2', id: 'example', root: { id: 'root', componentType: 'Container', props: {}, children: [] } } };
const policy = { canvas: { width: 20, height: 20 }, layout: {}, layoutSource: { kind: 'explicit', description: 'Procedural syntax regression fixture.' } };

test('one premature envelope close is removed with hashes and every field preserved', () => {
  const raw = JSON.stringify(prefix) + ',"policy":' + JSON.stringify(policy) + '}';
  const result = parseVisionJson(raw);
  assert.deepEqual(result.value, { ...prefix, policy });
  assert.equal(result.normalization?.kind, 'remove-premature-envelope-close');
  assert.match(result.normalization?.rawSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.notEqual(result.normalization?.rawSha256, result.normalization?.normalizedSha256);
  assert.equal(raw[result.normalization!.offset], '}');
});

test('valid JSON is untouched and other malformed or incomplete responses still fail', () => {
  const complete = { ...prefix, policy };
  assert.deepEqual(parseVisionJson(JSON.stringify(complete)), { value: complete, normalization: null });
  for (const raw of [
    JSON.stringify(prefix) + ',"unknown":{}}',
    JSON.stringify(prefix) + ',"policy":{},"extra":true}',
    JSON.stringify(prefix) + ',"policy":{},"summary":"replacement"}',
    JSON.stringify(prefix) + ',"policy":{},"intent":{"root":"invented"}}',
    JSON.stringify(prefix) + ',"policy":{}, trailing',
    JSON.stringify({ status: 'Ready', intent: {} }) + ',"policy":{}}',
  ]) assert.throws(() => parseVisionJson(raw));
});
