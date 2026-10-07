#!/usr/bin/env node
/** Export accepted real panels and replayed compositions. Does not launch Unity or models. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelComposition } from '../src/panel-composition.mjs';
import { exportUnityKit } from '../src/unity-export-io.mjs';
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes, digestJson, canonicalJson } from '../src/canonical.mjs';
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) { assert(['--run', '--compositions', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[i + 1]; }
  assert.equal(Object.keys(options).length, 3);
  const core = await loadWorkspaceCore(), run = await readPanelEvaluationRun(options['--run'], core);
  assert.equal(run.report.status, 'PASS_BEFORE_BROWSER'); assert.equal(run.cases.length, 16);
  const manifest = await readJson(resolve(options['--compositions'], 'composition-preview-build.json'));
  assert.equal(manifest.status, 'COMPLETE'); assert.equal(manifest.sourceReportSha256, await digestJson(run.report));
  const bundles = [...run.bundles.values()];
  for (const item of manifest.cases) {
    assert.equal(item.compositionFile, `${item.id}.composition.json`); assert(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.id));
    const result = await validatePanelComposition(await readJson(resolve(options['--compositions'], item.compositionFile)), item.sourceCaseIds.map(id => run.bundles.get(id)), core);
    assert.equal(result.bundle.sha256, item.bundleSha256); bundles.push(result.bundle);
  }
  const output = await createOutputDirectory(options['--output']), cases = []; let sharedRuntime = null;
  for (const bundle of bundles) {
    const directory = resolve(output, bundle.spec.id), exported = await exportUnityKit(bundle, core, directory);
    const kitManifest = await readJson(resolve(directory, 'export-manifest.json'));
    for (const file of kitManifest.files) {
      assert(!file.path.startsWith('/') && !file.path.includes('..') && !file.path.includes('\\') && !file.path.includes(':'));
      const bytes = await readFile(resolve(directory, file.path)); assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256);
    }
    const runtime = await readJson(resolve(directory, 'unity-runtime.json'));
    if (sharedRuntime === null) sharedRuntime = runtime; else assert.equal(canonicalJson(runtime), canonicalJson(sharedRuntime));
    const document = await readJson(resolve(directory, 'panel.unity.json'));
    assert.equal(document.fields.length, bundle.spec.state.length);
    assert.equal(document.controls.length, bundle.spec.sections.flatMap(section => section.rows).filter(row => row.kind !== 'text').length);
    for (const field of document.fields) {
      const source = bundle.spec.state.find(item => item.id === field.id); assert(source); assert.equal(field.type, source.type);
      if (field.type === 'number') {
        for (const key of ['min', 'max', 'step']) assert.equal(field[key], source[key]);
        assert.equal(field.initialNumber, source.initial); assert.equal(field.numberValue, bundle.state[source.id]);
      } else if (field.type === 'boolean') {
        assert.equal(field.initialBoolean, source.initial); assert.equal(field.booleanValue, bundle.state[source.id]);
      } else {
        assert.deepEqual(field.options, source.options); assert.equal(field.initialString, source.initial); assert.equal(field.stringValue, bundle.state[source.id]);
      }
    }
    for (const control of document.controls) {
      const row = bundle.spec.sections.flatMap(section => section.rows).find(row => row.id === control.rowId);
      assert(row); assert.equal(control.kind, row.kind); assert.equal(control.enabled, row.enabled);
      assert.equal(control.fieldId, row.bind ?? ''); assert.equal(control.eventName, row.event); assert.deepEqual(control.resetFields, row.action?.fields ?? []);
    }
    cases.push({ id: bundle.spec.id, sourceBundleSha256: bundle.sha256, status: exported.status,
      manifestSha256: await digestJson(kitManifest), files: kitManifest.files.length, fields: document.fields.length,
      controls: document.controls.length, nativeImport: 'NOT_RUN' });
  }
  await writeNewJson(output, 'unity-evaluation-export-report.json', { status: 'PASS', cases, sharedRuntime,
    sourceReportSha256: await digestJson(run.report), modelCalls: 0, nativeEngines: 'NOT_RUN',
    scope: 'Import-kit lowering, file checksums, exact control/event/reset mapping and identical shared runtime; no native Editor execution.' });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', kits: cases.length, distinctSharedRuntimes: 1, modelCalls: 0, nativeEngines: 'NOT_RUN' })}\n`);
} catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code ?? 'UNITY_EVALUATION_EXPORT_FAILED' })}\n`); process.exitCode = 1; }
