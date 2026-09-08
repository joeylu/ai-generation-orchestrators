import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateButton, HarnessError } from '../src/contract.ts';
const fixture = () => JSON.parse(readFileSync(new URL('../examples/button.json', import.meta.url), 'utf8'));
test('valid contract is cloned without injecting defaults', () => {
  const source = fixture(); const result = validateButton(source);
  assert.deepEqual(result, source); assert.notEqual(result, source);
});
const cases: [string, (x: any) => void, string][] = [
  ['version', x => x.schemaVersion = '0.2', '$.schemaVersion'],
  ['unknown Button type', x => x.type = 'Slider', '$.type'],
  ['missing id', x => delete x.id, '$.id'],
  ['empty id', x => x.id = '', '$.id'],
  ['duplicate id', x => x.slots.visual.id = x.id, '$.slots.visual.id'],
  ['missing layout', x => delete x.layout, '$.layout'],
  ['NaN coordinate', x => x.layout.x = NaN, '$.layout.x'],
  ['infinite coordinate', x => x.layout.y = Infinity, '$.layout.y'],
  ['zero width', x => x.layout.width = 0, '$.layout.width'],
  ['negative height', x => x.layout.height = -1, '$.layout.height'],
  ['string size', x => x.layout.width = '240', '$.layout.width'],
  ['enabled string', x => x.props.enabled = 'true', '$.props.enabled'],
  ['missing enabled', x => delete x.props.enabled, '$.props.enabled'],
  ['missing visual', x => delete x.slots.visual, '$.slots.visual'],
  ['unknown visual type', x => x.slots.visual.type = 'Text', '$.slots.visual.type'],
  ['missing source', x => delete x.slots.visual.props.source, '$.slots.visual.props.source'],
  ['empty source', x => x.slots.visual.props.source = ' ', '$.slots.visual.props.source'],
  ['unsupported source scheme', x => x.slots.visual.props.source = 'javascript:alert(1)', '$.slots.visual.props.source'],
  ['unsupported label', x => x.slots.label = {}, '$.slots.label'],
  ['unsupported icon', x => x.slots.icon = {}, '$.slots.icon'],
  ['unsupported animation', x => x.animation = {}, '$.animation'],
  ['unknown props', x => x.props.selected = true, '$.props.selected'],
];
for (const [name, mutate, path] of cases) test(`reject ${name} with field path`, () => {
  const source = fixture(); mutate(source);
  assert.throws(() => validateButton(source), (error: unknown) => error instanceof HarnessError && error.stage === 'contract' && error.issues.some(i => i.path === path));
});
test('reject non-object inputs', () => { for (const x of [null, [], 'button', 42]) assert.throws(() => validateButton(x), HarnessError); });
test('allow negative position and non-empty HTTP reference; resource loading is separate', () => {
  const source = fixture(); source.layout.x = -20; source.slots.visual.props.source = 'https://example.com/a.png';
  assert.equal(validateButton(source).layout.x, -20);
});
