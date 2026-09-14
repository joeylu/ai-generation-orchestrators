import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { referenceV2Fixture } from './helpers/reference-v2-fixture.ts';
import { componentHandoffFixture } from './helpers/component-handoff-fixture.ts';

const cli = fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url));
function run(cwd: string, ...args: string[]) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 90000 }); }
test('formal unattended command: portable roundtrip, isolated ZIP, references and overwrite refusal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ui-ref-success-'));
  await writeFile(join(dir, 'input.zip'), (await referenceV2Fixture()).zip);
  const first = run(dir, 'reference-accept', 'input.zip', '--output', 'first'); assert.equal(first.status, 0, first.stderr + first.stdout);
  const report = JSON.parse(await readFile(join(dir, 'first/report.json'), 'utf8')); assert.equal(report.status, 'technical_passed'); assert.equal(report.human_visual_acceptance, false);
  assert.deepEqual(new Uint8Array(await readFile(join(dir, 'first/reference/original.png'))), new Uint8Array((await referenceV2Fixture()).original));
  assert.equal(report.comparison.scopes.reduce((n: number, r: any) => n + r.differentPixels, 0), 0);
  const isolated = await mkdtemp(join(tmpdir(), 'ui-ref-isolated-'));
  await cp(join(dir, 'first/roundtrip.ui.component-handoff.draft.zip'), join(isolated, 'only.zip'));
  const second = run(isolated, 'reference-accept', 'only.zip', '--output', 'second'); assert.equal(second.status, 0, second.stdout + second.stderr);
  const imported = run(isolated, 'component-handoff', 'only.zip', '--output', 'official.json', '--reference-output', 'evidence.json'); assert.equal(imported.status, 0, imported.stderr);
  const exported = run(isolated, 'reference-export', 'official.json', '--output', 'exported.zip'); assert.equal(exported.status, 0, exported.stderr);
  const before = await readFile(join(isolated, 'second/report.json'));
  assert.notEqual(run(isolated, 'reference-accept', 'only.zip', '--output', 'second').status, 0);
  assert.deepEqual(await readFile(join(isolated, 'second/report.json')), before);
  assert.notEqual(run(isolated, 'reference-export', 'official.json', '--output', 'exported.zip').status, 0);
  const evidence = JSON.parse(await readFile(join(isolated, 'evidence.json'), 'utf8'));
  const firstEvidence = JSON.parse(await readFile(join(dir, 'first/reference-evidence.json'), 'utf8')); assert.deepEqual(evidence, firstEvidence);
});
for (const [name, options, status] of [
  ['unknown', { unknown: true }, 'blocked'], ['empty-scope', { excludeAll: true }, 'blocked'],
  ['different-pixels', { badOriginal: true }, 'visual_failed'], ['decoder-failure', { invalidImage: true }, 'failed'],
] as const) test(`unattended ${name} never leaves a passed report and exits with cleanup`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ui-ref-failure-')); await writeFile(join(dir, 'input.zip'), (await referenceV2Fixture(options)).zip);
  const result = run(dir, 'reference-accept', 'input.zip', '--output', 'out'); assert.equal(result.status, 2, result.stderr + result.stdout);
  const report = JSON.parse(await readFile(join(dir, 'out/report.json'), 'utf8')); assert.equal(report.status, status); assert.equal(report.cleanup, 'completed'); assert.equal(report.human_visual_acceptance, false);
  if (name === 'unknown') {
    assert.deepEqual(report.unknownFields, ['apply-switch.checked']);
    const state = JSON.parse(await readFile(join(dir, 'out/runtime-state.json'), 'utf8'));
    assert.equal(state.inspection.nodes.find((n: any) => n.id === 'apply-switch').value, false);
    assert.equal(state.events.some((e: any) => e.id === 'apply-switch' && e.value === true), false);
  }
});
test('legacy ZIP still captures but reports missing evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ui-ref-legacy-')); await writeFile(join(dir, 'input.zip'), await componentHandoffFixture());
  assert.equal(run(dir, 'reference-accept', 'input.zip', '--output', 'out').status, 2);
  const report = JSON.parse(await readFile(join(dir, 'out/report.json'), 'utf8')); assert.equal(report.status, 'blocked'); assert.equal(report.comparison.reason, 'MISSING_REFERENCE_EVIDENCE');
});
