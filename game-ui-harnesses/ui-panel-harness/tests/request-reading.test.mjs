import test from 'node:test';
import assert from 'node:assert/strict';
import { requestReading } from '../src/request-reading.mjs';
test('request reading remains lossless and literal across multilingual punctuation and surrogate pairs', () => {
  const text = '🎵语言下拉（中文、English，默认中文）；主音量0～100，步长1，默认 70。字幕默认开启；\n静音初值为false。';
  const reading = requestReading(text); assert.equal(reading.clauses.join(''), text);
  assert.deepEqual(reading.literalDefaultMentions, ['默认中文', '默认 70', '默认开启', '初值为false']);
  for (const value of [...reading.clauses, ...reading.literalDefaultMentions]) assert(text.includes(value));
});
test('reading aid does not invent missing defaults, interpret values or truncate the exact request', () => {
  assert.deepEqual(requestReading('音量默认值未确定。').literalDefaultMentions, ['默认值未确定']);
  assert.deepEqual(requestReading('增加一个滑条').literalDefaultMentions, []);
  const text = '默认1；'.repeat(300), reading = requestReading(text);
  assert.equal(reading.clauses.join(''), text); assert.deepEqual(reading.literalDefaultMentions, []);
});
