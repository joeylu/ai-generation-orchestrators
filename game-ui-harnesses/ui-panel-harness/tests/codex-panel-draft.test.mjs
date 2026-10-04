import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { materializeCodexPanelDraft } from '../src/codex-panel-draft.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { checkPanelProposal, proposalTargets } from '../src/proposal.mjs';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const catalog = await read('../examples/modern-mint-layout.catalog.json');
const spec = await read('../examples/layout-v1/settings.panel.json');
spec.id = 'sound-draft-fixture'; spec.title = '声音设置';
spec.provenance = { kind: 'agent-authored', description: 'Transport regression fixture; no model invocation or semantic approval.', assumptions: [] };
spec.assets = null;
spec.state = [{ id: 'volume', type: 'number', initial: 70, min: 0, max: 100, step: 1 }, { id: 'muted', type: 'boolean', initial: false }];
spec.sections = [{ id: 'audio', title: '声音', rows: [
  { id: 'volume-row', kind: 'slider', recipe: { id: 'settings.slider', version: '0.1.0' }, label: '主音量', bind: 'volume',
    enabled: true, event: 'audio.volumeChanged', format: { fractionDigits: 0, prefix: '', suffix: '%' } },
  { id: 'mute-row', kind: 'switch', recipe: { id: 'settings.switch', version: '0.1.0' }, label: '静音', bind: 'muted', enabled: true, event: 'audio.muteChanged' },
  { id: 'reset-row', kind: 'button', recipe: { id: 'settings.button', version: '0.1.0' }, label: '', buttonLabel: '恢复默认', enabled: true, event: 'audio.resetRequested',
    action: { kind: 'reset-initial', fields: ['volume', 'muted'] } }
] }];
spec.layout.body = { id: 'body', kind: 'column', width: 'fill', gap: 16, align: 'start',
  children: [{ kind: 'section', sectionId: 'audio', width: 'fill' }] };
const text = '生成声音设置面板：主音量范围 0～100，步长 1，默认 70；静音开关默认关闭，开启表示静音；增加恢复默认按钮，恢复这两项初值。';
const context = await createPlanningContext({ requestVersion: '0.1', id: 'sound-draft', text, target: 'pixi' }, catalog);
const basis = () => ({ kind: 'request-interpretation', start: 0, end: text.length, quote: text });
function draftFor(source = spec) {
  return { codexPanelDraftVersion: '0.1', contextSha256: context.sha256, spec: structuredClone(source), unresolved: [],
    bases: { panel: basis(), theme: basis(), canvas: basis(), layout: basis(), assets: source.assets ? {
      overall: basis(), surface: source.assets.panelSurface ? basis() : null, rowIcons: source.assets.rowIcons.map(basis) } : null,
    sections: source.sections.map(section => ({ section: basis(), rows: section.rows.map(basis) })), state: source.state.map(basis) } };
}

test('sound request draft derives exactly ten public targets, with reset behavior attached to its row', async () => {
  const draft = draftFor(), before = structuredClone(draft), proposal = await materializeCodexPanelDraft(context, draft);
  assert.deepEqual(proposal.decisions.map(item => item.target), [
    'panel', 'theme', 'canvas', 'layout', 'section:audio', 'row:volume-row', 'row:mute-row', 'row:reset-row', 'state:volume', 'state:muted']);
  assert.deepEqual(proposal.spec, spec); assert.deepEqual(draft, before);
  assert.equal((await checkPanelProposal(context, proposal)).status, 'READY_TO_COMPILE');
  assert.equal(proposal.decisions.length, new Set(proposal.decisions.map(item => item.target)).size);
});

test('each source remains associated with its Spec collection position and exact quote', async () => {
  const draft = draftFor(), start = text.indexOf('静音开关'), end = text.indexOf('；增加');
  const source = { kind: 'request-interpretation', start, end, quote: text.slice(start, end) };
  draft.bases.sections[0].rows[1] = source; draft.bases.state[1] = source;
  const proposal = await materializeCodexPanelDraft(context, draft);
  for (const target of ['row:mute-row', 'state:muted']) assert.deepEqual(proposal.decisions.find(item => item.target === target).basis, source);
});

test('missing and extra evidence are rejected without truncating, filling or deduplicating', async () => {
  for (const mutate of [value => value.bases.sections.pop(), value => value.bases.sections.push(structuredClone(value.bases.sections[0])),
    value => value.bases.sections[0].rows.pop(), value => value.bases.sections[0].rows.push(basis()),
    value => value.bases.state.pop(), value => value.bases.state.push(basis())]) {
    const draft = draftFor(); mutate(draft); const before = structuredClone(draft);
    await assert.rejects(materializeCodexPanelDraft(context, draft), { code: 'DRAFT_COUNT' }); assert.deepEqual(draft, before);
  }
});

test('extra targets, IDs and object fields cannot enter the draft transport', async () => {
  for (const mutate of [value => { value.decisions = []; }, value => { value.bases.action = basis(); },
    value => { value.bases.sections[0].id = 'audio'; }, value => { value.bases.assets = { overall: basis(), surface: null, rowIcons: [] }; }]) {
    const draft = draftFor(); mutate(draft);
    await assert.rejects(materializeCodexPanelDraft(context, draft), { code: 'DRAFT_FIELDS' });
  }
});

test('draft mapping preserves public span, business origin, context and unique-ID gates', async () => {
  const cases = [
    ['PLAN_QUOTE', value => { value.bases.sections[0].rows[2].quote = 'invented'; }],
    ['PLAN_BUSINESS_ORIGIN', value => { value.bases.state[0] = { kind: 'design-choice', reason: 'Assume defaults' }; }],
    ['PLAN_FIELDS', value => { value.bases.state[0].target = 'state:volume'; }],
    ['PLAN_CONTEXT_MISMATCH', value => { value.contextSha256 = '0'.repeat(64); }],
    ['duplicate', value => { value.spec.sections[0].rows[1].id = value.spec.sections[0].rows[0].id; }],
    ['DRAFT_VERSION', value => { value.codexPanelDraftVersion = '0.2'; }]
  ];
  for (const [code, mutate] of cases) { const draft = draftFor(); mutate(draft); await assert.rejects(materializeCodexPanelDraft(context, draft), { code }); }
});

test('questions remain blocking and a null spec cannot claim sources', async () => {
  const empty = { codexPanelDraftVersion: '0.1', contextSha256: context.sha256, spec: null, bases: null,
    unresolved: [{ id: 'scope', question: '恢复默认应包含哪些设置？' }] };
  const proposal = await materializeCodexPanelDraft(context, empty);
  assert.equal((await checkPanelProposal(context, proposal)).status, 'NEEDS_INPUT'); assert.deepEqual(proposal.decisions, []);
  await assert.rejects(materializeCodexPanelDraft(context, { ...empty, bases: draftFor().bases }), { code: 'DRAFT_FIELDS' });
  await assert.rejects(materializeCodexPanelDraft(context, { ...empty, unresolved: [] }), { code: 'PLAN_EMPTY_SPEC' });
});

test('selected asset evidence produces only selected slots and requires exact per-slot coverage', async () => {
  const source = await read('../examples/audio-settings-assets.panel.json'), draft = draftFor(source);
  const proposal = await materializeCodexPanelDraft(context, draft);
  assert.deepEqual(proposal.decisions.map(item => item.target), proposalTargets(source, '0.4'));
  assert.equal(proposal.decisions.filter(item => item.target === 'assets').length, 1);
  for (const mutate of [value => value.bases.assets.rowIcons.pop(), value => value.bases.assets.rowIcons.push(basis())]) {
    const changed = structuredClone(draft); mutate(changed);
    await assert.rejects(materializeCodexPanelDraft(context, changed), { code: 'DRAFT_COUNT' });
  }
  source.assets.panelSurface = null;
  const withoutSurface = draftFor(source), translated = await materializeCodexPanelDraft(context, withoutSurface);
  assert.equal(translated.decisions.some(item => item.target === 'asset:surface'), false);
  withoutSurface.bases.assets.surface = basis();
  await assert.rejects(materializeCodexPanelDraft(context, withoutSurface), { code: 'DRAFT_FIELDS' });
});

test('draft snapshot rejects getters before reading their contents', async () => {
  const draft = draftFor(); let reads = 0;
  Object.defineProperty(draft.bases, 'panel', { enumerable: true, get() { reads++; return basis(); } });
  await assert.rejects(materializeCodexPanelDraft(context, draft), { code: 'accessor' }); assert.equal(reads, 0);
});

test('legacy context derives only whole-assets evidence and still supports an asset-free spec', async () => {
  const legacyCatalog = await read('../examples/modern-mint-light.catalog.json');
  const legacyContext = await createPlanningContext({ ...context.request }, legacyCatalog);
  assert.equal(legacyContext.planningContextVersion, '0.1');
  for (const filename of ['audio-settings.panel.json', 'audio-settings-assets.panel.json']) {
    const source = await read(`../examples/${filename}`);
    source.theme = { id: legacyCatalog.themes[0].id, version: legacyCatalog.themes[0].version };
    const draft = draftFor(source); draft.contextSha256 = legacyContext.sha256;
    if (draft.bases.assets) { draft.bases.assets.surface = null; draft.bases.assets.rowIcons = []; }
    const proposal = await materializeCodexPanelDraft(legacyContext, draft);
    assert.deepEqual(proposal.decisions.map(item => item.target), proposalTargets(source, '0.1'));
    if (draft.bases.assets) {
      draft.bases.assets.rowIcons.push(basis());
      await assert.rejects(materializeCodexPanelDraft(legacyContext, draft), { code: 'DRAFT_COUNT' });
    }
  }
});

test('a complete draft with questions remains blocked and transport schema states its separate scope', async () => {
  const draft = draftFor(); draft.unresolved = [{ id: 'meaning', question: '请确认开关真值含义。' }];
  const proposal = await materializeCodexPanelDraft(context, draft);
  assert.equal((await checkPanelProposal(context, proposal)).status, 'NEEDS_INPUT');
  const schema = await read('../schemas/codex-panel-draft.schema.json');
  assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.codexPanelDraftVersion.const, '0.1');
  assert.deepEqual(schema.required.sort(), Object.keys(draft).sort());
  assert.match(schema.$comment, /exact array lengths/u); assert.match(schema.$comment, /not a new public engine format/u);
});
