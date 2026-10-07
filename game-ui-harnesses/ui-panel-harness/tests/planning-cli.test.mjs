import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { digestJson } from '../src/canonical.mjs';
import { catalog } from './helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runScript = (script, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
const run = (...args) => runScript('scripts/cli.mjs', ...args);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'planning-cli-'));
const fixtureDir = join(work, 'fixtures');
const made = runScript('scripts/write-planning-fixtures.mjs', '--output', fixtureDir);
assert.equal(made.status, 0, made.stderr);
const fixture = name => join(fixtureDir, name);
const put = async (name, value) => { const path = join(work, name); await writeFile(path, JSON.stringify(value)); return path; };

test('intake preserves complete source text and only emits program-generated context', async () => {
  const output = join(work, 'intake');
  const result = run('intake', 'examples/audio-request.txt', '--id', 'audio-settings-request', '--output', output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'CONTEXT_READY');
  const context = await json(join(output, 'planning-context.json'));
  assert.equal(context.request.text, await readFile(join(root, 'examples/audio-request.txt'), 'utf8'));
  assert.equal(context.requestSha256, await digestJson(context.request));
  assert.equal(context.catalogSha256, await digestJson(catalog));
  assert.equal(context.capabilities.naturalLanguageInterpreter, 'external-agent');
  assert(context.candidates.some(item => item.id === 'settings.slider'));
  await assert.rejects(stat(join(output, 'panel.bundle.json')), { code: 'ENOENT' });
});

test('check-plan exposes unanswered questions and build-plan refuses before publication', async () => {
  const args = [fixture('ambiguous-context.json'), '--proposal', fixture('ambiguous-proposal.json')];
  const checked = run('check-plan', ...args);
  assert.equal(checked.status, 0, checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.status, 'NEEDS_INPUT'); assert.equal(report.specSha256, null);
  assert(report.unresolved.length > 0); assert.equal(report.semanticReview, 'NOT_RUN');
  const output = join(work, 'ambiguous-build');
  const built = run('build-plan', ...args, '--output', output);
  assert.notEqual(built.status, 0); assert.equal(JSON.parse(built.stderr).code, 'PLAN_NEEDS_INPUT');
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('build-plan publishes the exact proposal, context and generated report with actual file hashes', async () => {
  const output = join(work, 'planned');
  const built = run('build-plan', fixture('context.json'), '--proposal', fixture('proposal.json'), '--output', output);
  assert.equal(built.status, 0, built.stderr);
  const delivery = await json(join(output, 'delivery.json'));
  assert.equal(delivery.files.length, 6);
  for (const file of delivery.files) {
    assert.equal(createHash('sha256').update(await readFile(join(output, file.path))).digest('hex'), file.sha256);
  }
  const proposal = await json(fixture('proposal.json')), report = await json(join(output, 'planning-report.json'));
  assert.deepEqual(await json(join(output, 'proposal.json')), proposal);
  assert.deepEqual(await json(join(output, 'panel.spec.json')), proposal.spec);
  const validated = run('validate', join(output, 'panel.spec.json'));
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).specSha256, await digestJson(proposal.spec));
  assert.equal(report.proposalSha256, await digestJson(proposal));
  assert.equal(report.status, 'READY_TO_COMPILE');
  assert.equal(report.semanticReview, 'NOT_RUN'); assert.equal(report.humanVisualReview, 'NOT_RUN');
  assert.equal(run('inspect', join(output, 'panel.bundle.json')).status, 0);
});

test('patch preserves stable existing bindings and emits a reproducible receipt and separate delivery', async () => {
  const output = join(work, 'patched');
  const patched = run('patch', fixture('base.panel.json'), '--patch', fixture('patch.json'), '--output', output);
  assert.equal(patched.status, 0, patched.stderr);
  const original = await json(fixture('base.panel.json')), spec = await json(join(output, 'panel.spec.json'));
  const receipt = await json(join(output, 'patch-receipt.json'));
  assert.equal(receipt.baseSpecSha256, await digestJson(original));
  assert.equal(receipt.resultSpecSha256, await digestJson(spec));
  assert.equal(receipt.patchSha256, await digestJson(await json(fixture('patch.json'))));
  assert.deepEqual(receipt.changedRowIds, ['music-volume-row', 'volume-row']);
  assert.equal(spec.sections[0].rows[0].label, '主音量');
  assert.deepEqual(spec.sections[0].rows[2], original.sections[0].rows[1]);
  assert.deepEqual(spec.state.slice(0, 2), original.state);
  const bundle = await json(join(output, 'panel.bundle.json'));
  assert.equal(bundle.bindings[0].nodeId, `${original.id}.row.volume-row.control`);
  assert.equal(bundle.state.musicVolume, 50);
  assert.equal(run('inspect', join(output, 'panel.bundle.json')).status, 0);
  assert.deepEqual(await json(fixture('base.panel.json')), original);
});

test('stale, unresolvable and overflowing patches never publish a partial directory', async () => {
  const base = await json(fixture('base.panel.json')), baseHash = await digestJson(base);
  const cases = [
    { baseSpecSha256: '0'.repeat(64), operations: [{ op: 'set-panel-title', title: 'Stale' }] },
    { baseSpecSha256: baseHash, operations: [{ op: 'set-theme', theme: { id: 'missing', version: '0.1.0' } }] },
    { baseSpecSha256: baseHash, operations: [{ op: 'set-layout', layout: { ...base.layout, rowHeight: 500 } }] },
  ];
  for (const [index, value] of cases.entries()) {
    const patch = await put(`invalid-patch-${index}.json`, { patchVersion: '0.1', reason: 'Negative fixture', ...value });
    const output = join(work, `invalid-patch-${index}`);
    const result = run('patch', fixture('base.panel.json'), '--patch', patch, '--output', output);
    assert.notEqual(result.status, 0); await assert.rejects(stat(output), { code: 'ENOENT' });
    assert.equal(result.stderr.includes(root), false);
  }
});

test('proposal readiness is structural only; invalid geometry fails the build before any output', async () => {
  const proposal = await json(fixture('proposal.json'));
  proposal.spec.layout.rowHeight = 500;
  const path = await put('overflow-proposal.json', proposal), output = join(work, 'overflow-plan');
  const checked = run('check-plan', fixture('context.json'), '--proposal', path);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).status, 'READY_TO_COMPILE');
  const built = run('build-plan', fixture('context.json'), '--proposal', path, '--output', output);
  assert.notEqual(built.status, 0); assert.equal(JSON.parse(built.stderr).code, 'LAYOUT_OVERFLOW');
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('intake rejects malformed UTF-8 and oversized requests without output', async () => {
  const cases = [Buffer.from([0xc3, 0x28]), Buffer.from('音'.repeat(8001))];
  for (const [index, bytes] of cases.entries()) {
    const path = join(work, `bad-text-${index}.txt`), output = join(work, `bad-text-${index}`);
    await writeFile(path, bytes);
    const result = run('intake', path, '--id', 'bad-request', '--output', output);
    assert.notEqual(result.status, 0); await assert.rejects(stat(output), { code: 'ENOENT' });
  }
});
