import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { fixtureInputs } from '../../src/fixtures.ts';
import { fixtureDocument } from '../../src/fixtures.ts';

const cli = fileURLToPath(new URL('../../scripts/cli.mjs', import.meta.url));
function run(request: string, output: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'run', request, '--preview-url', 'http://127.0.0.1:4173/', '--output', output,
      '--browser', process.env.UI_HARNESS_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, output: log }));
  });
}
async function request(root: string, checks?: unknown[]) {
  const sample = fixtureInputs('composite');
  const value = { runVersion: '0.1',
    workflow: { workflowVersion: '0.1', id: 'workflow-fixture',
      input: { kind: 'intent', intent: sample.intent, policy: sample.policy,
        facts: JSON.parse(await readFile(new URL('../../examples/programmatic-composite.facts.json', import.meta.url), 'utf8')) },
      motion: { id: 'workflow-premium', style: 'premium', targets: 'all' }, timeline: sample.motion },
    resources: ['plate', 'gem'].map(name => ({ path: `fixtures/${name}.svg`, file: `${name}.svg`, mime: 'image/svg+xml' })),
    provenance: { kind: 'programmatic-fixture', description: 'Procedural workflow browser fixture; no vision or generated media.' },
    checks: checks ?? [
      { kind: 'motion', targetId: 'confirm', action: 'press', verifyPixels: true },
      { kind: 'click', targetId: 'confirm', expectActivations: 1 },
      { kind: 'timeline', time: 120, verifyPixels: true },
    ] };
  for (const name of ['plate', 'gem']) await writeFile(join(root, `${name}.svg`), await readFile(new URL(`../../public/fixtures/${name}.svg`, import.meta.url)));
  const filename = join(root, 'run.json');
  await writeFile(filename, JSON.stringify(value)); return filename;
}
test('unified run compiles intent and both motions, checks pixels and real click, restores and delivers', async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), 'ui-workflow-browser-'));
  const output = join(root, 'delivery'), filename = await request(root);
  const result = await run(filename, output);
  expect(result.code, result.output).toBe(0);
  const report = JSON.parse(await readFile(join(output, 'run-report.json'), 'utf8'));
  const bundle = JSON.parse(await readFile(join(output, 'component.bundle.json'), 'utf8'));
  expect(report.status).toBe('PASS'); expect(report.checks).toHaveLength(3);
  expect(report.checks[0].observations.changed).toBe(true);
  expect(report.checks[0].pixelsChanged).toBe(true);
  expect(report.checks[1].observations.activations).toBe(1);
  expect(report.humanVisualReview).toBe('NOT_RUN'); expect(report.providerCalls).toBe(0);
  expect(report.stages.find((stage: any) => stage.name === 'fresh-page-bundle-restoration').status).toBe('PASS');
  expect(report.stages.find((stage: any) => stage.name === 'runtime-teardown').status).toBe('PASS');
  expect(bundle.motionSystem.bindings).toHaveLength(9); expect(bundle.motion).toBeTruthy();
  expect(bundle.bundleVersion).toBe('0.2'); expect(bundle.resources).toHaveLength(2);
  expect(JSON.stringify(report)).not.toContain(root);
  const original = await readFile(join(output, 'component.bundle.json'), 'utf8');
  expect((await run(filename, output)).code).not.toBe(0);
  expect(await readFile(join(output, 'component.bundle.json'), 'utf8')).toBe(original);
});
test('failed real interaction leaves failure evidence and no successful bundle', async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), 'ui-workflow-failure-'));
  const output = join(root, 'delivery');
  const filename = await request(root, [{ kind: 'click', targetId: 'confirm', expectActivations: 2 }]);
  const result = await run(filename, output);
  expect(result.code).not.toBe(0);
  const report = JSON.parse(await readFile(join(output, 'run-report.json'), 'utf8'));
  expect(report.status).toBe('FAIL'); expect(report.checks[0].status).toBe('FAIL');
  expect(report.error).toContain('Activation count mismatch');
  expect(await readdir(output)).not.toContain('component.bundle.json');
});
test('corrupt image that passes resource hashing fails actual browser decode before delivery', async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), 'ui-workflow-decode-'));
  const filename = await request(root), output = join(root, 'delivery');
  await writeFile(join(root, 'gem.svg'), 'deliberately invalid SVG bytes');
  const result = await run(filename, output);
  expect(result.code).not.toBe(0);
  const report = JSON.parse(await readFile(join(output, 'run-report.json'), 'utf8'));
  expect(report.status).toBe('FAIL');
  expect(report.stages.find((stage: any) => stage.name === 'resource-and-bundle-validation').status).toBe('PASS');
  expect(report.stages.find((stage: any) => stage.name === 'browser-adapter-ready').status).toBe('PASS');
  expect(report.error).toMatch(/decode|image/i);
  expect(report.stages.at(-1).name).toBe('pixijs-browser-acceptance');
  expect(await readdir(output)).not.toContain('component.bundle.json');
});
test('clicking an overlapping different Button cannot satisfy the named target activation check', async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), 'ui-workflow-target-'));
  const filename = await request(root, [{ kind: 'click', targetId: 'confirm', expectActivations: 1 }]);
  const value = JSON.parse(await readFile(filename, 'utf8'));
  const document: any = fixtureDocument('composite');
  const confirm = document.root.children.find((node: any) => node.id === 'confirm');
  document.root.children.push({ ...structuredClone(confirm), id: 'overlapping-button', children: [] });
  value.workflow.input = { kind: 'document', document };
  await writeFile(filename, JSON.stringify(value));
  const output = join(root, 'delivery');
  const result = await run(filename, output);
  expect(result.code).not.toBe(0);
  const report = JSON.parse(await readFile(join(output, 'run-report.json'), 'utf8'));
  expect(report.checks[0].status).toBe('FAIL');
  expect(report.error).toContain('Target activation count mismatch');
  expect(await readdir(output)).not.toContain('component.bundle.json');
});
