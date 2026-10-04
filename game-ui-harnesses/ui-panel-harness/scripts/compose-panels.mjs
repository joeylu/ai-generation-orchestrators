#!/usr/bin/env node
/** Compose portable bundles only; source files are immutable and no model is invoked. */
import { resolve, dirname } from 'node:path';
import { composePanelBundles } from '../src/panel-composition.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { readJson, createOutputDirectory, writeNewJson } from '../src/io.mjs';
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--input', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('COMPOSITION_ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  if (Object.keys(options).length !== 2) throw new Error('COMPOSITION_ARGUMENTS');
  const path = resolve(options['--input']), input = await readJson(path);
  if (Object.keys(input).sort().join('|') !== 'request|sourceFiles' || !Array.isArray(input.sourceFiles)) throw new Error('COMPOSITION_ARGUMENTS');
  const sources = await Promise.all(input.sourceFiles.map(file => readJson(resolve(dirname(path), file))));
  const composed = await composePanelBundles(input.request, sources, await loadWorkspaceCore());
  const output = await createOutputDirectory(options['--output']);
  await writeNewJson(output, 'composition.json', composed);
  await writeNewJson(output, 'panel.bundle.json', composed.bundle);
  process.stdout.write(`${JSON.stringify({ status: 'COMPOSED', sources: sources.length, modelCalls: 0, bundleSha256: composed.bundle.sha256 })}\n`);
} catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: error.code ?? error.message })}\n`); process.exitCode = 1; }
