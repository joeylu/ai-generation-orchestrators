#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { validatePanelSpec } from '../src/spec.mjs';
import { validateCatalog, searchCatalog } from '../src/catalog.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle, panelBundleAssetInputs } from '../src/panel-bundle.mjs';
import { loadPanelAssets, createAssetPlanningContext, loadPanelPlanAssets } from '../src/panel-assets-io.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { readJson, readText, createOutputDirectory, writeNewJson, jsonFileBytes } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { createPlanningContext, validatePlanningContext } from '../src/planning-context.mjs';
import { checkPanelProposal, requireReadyProposal } from '../src/proposal.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { exportUnityKit } from '../src/unity-export-io.mjs';

const usage = `UI Panel Harness 0.1.0 — offline workspace prototype
  node scripts/cli.mjs validate <panel-spec.json>
  node scripts/cli.mjs catalog --query <text> [--kind slider-row|switch-row|select-row|button-row|panel|section]
  node scripts/cli.mjs compile <panel-spec.json> --output <new-directory> [--state <state.json>]
  node scripts/cli.mjs inspect <panel.bundle.json>
  node scripts/cli.mjs export-unity <panel.bundle.json> --output <new-directory>
  node scripts/cli.mjs restore <panel.bundle.json> --state <state.json> --output <new-directory>
  node scripts/cli.mjs intake <request.txt> --id <request-id> --output <new-directory> [--catalog <catalog.json>]
  node scripts/cli.mjs check-plan <planning-context.json> --proposal <proposal.json>
  node scripts/cli.mjs build-plan <planning-context.json> --proposal <proposal.json> --output <new-directory>
  node scripts/cli.mjs patch <panel-spec.json> --patch <patch.json> --output <new-directory> [--catalog <catalog.json>]
Options: --catalog <catalog.json> for catalog/compile/intake/patch.
Asset PanelSpec 0.2/0.3/0.4 compile/build-plan/patch: --assets <verified-library-directory> [--sharp-module <installed-module>].
Asset-aware intake: --assets <verified-library-directory> [--asset-style <style>] [--sharp-module <installed-module>].
Restore uses embedded PNGs and requires no external asset library or Sharp.
All writes stay inside ui-panel-harness. No server, provider or dependency installation.
`;
const catalogDefault = new URL('../catalog/modern-core.json', import.meta.url);

function parse(args, allowed) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!allowed.includes(key) || Object.hasOwn(values, key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('CLI_ARGUMENTS');
    values[key] = args[index + 1];
  }
  return values;
}
async function loadCatalog(options) {
  return validateCatalog(await readJson(options['--catalog'] ?? fileURLToPath(catalogDefault)));
}
async function loadAssets(specInput, options) {
  const spec = validatePanelSpec(specInput);
  if (!spec.assets) {
    if (options['--assets'] || options['--sharp-module']) throw new Error('PANEL_ASSETS_UNEXPECTED');
    return undefined;
  }
  if (!options['--assets']) throw new Error('PANEL_ASSETS_REQUIRED');
  return loadPanelAssets(spec, options['--assets'], await loadTextureImageAdapter(options['--sharp-module']));
}
async function publish(bundle, output, attachments = []) {
  if (!output) throw new Error('OUTPUT_REQUIRED');
  const directory = await createOutputDirectory(output);
  await writeNewJson(directory, 'component.bundle.json', bundle.componentBundle);
  await writeNewJson(directory, 'panel.bundle.json', bundle);
  for (const file of attachments) await writeNewJson(directory, file.path, file.value);
  await writeNewJson(directory, 'delivery.json', {
    status: 'COMPLETE', panelSha256: bundle.sha256,
    files: [{ path: 'component.bundle.json', sha256: await digestBytes(jsonFileBytes(bundle.componentBundle)) },
      { path: 'panel.bundle.json', sha256: await digestBytes(jsonFileBytes(bundle)) },
      ...await Promise.all(attachments.map(async file => ({ path: file.path, sha256: await digestBytes(jsonFileBytes(file.value)) })))],
    browser: 'NOT_RUN', humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN',
  });
  return { status: 'COMPILED', panelId: bundle.spec.id, panelSha256: bundle.sha256,
    files: ['panel.bundle.json', 'component.bundle.json', ...attachments.map(file => file.path), 'delivery.json'], browser: 'NOT_RUN' };
}

async function main(args) {
  const command = args.shift();
  if (!command || command === '--help' || command === 'help') { process.stdout.write(usage); return; }
  if (command === 'intake') {
    const file = args.shift(); if (!file || file.startsWith('--')) throw new Error('INPUT_REQUIRED');
    const options = parse(args, ['--id', '--output', '--catalog', '--assets', '--asset-style', '--sharp-module']);
    if (!options['--id'] || !options['--output']) throw new Error('ID_AND_OUTPUT_REQUIRED');
    if (!options['--assets'] && (options['--asset-style'] || options['--sharp-module'])) throw new Error('PANEL_ASSETS_REQUIRED');
    const request = { requestVersion: '0.1', id: options['--id'], text: await readText(file), target: 'pixi' }, catalog = await loadCatalog(options);
    const context = options['--assets']
      ? await createAssetPlanningContext(request, catalog, options['--assets'], await loadTextureImageAdapter(options['--sharp-module']), { style: options['--asset-style'] ?? null })
      : await createPlanningContext(request, catalog);
    const directory = await createOutputDirectory(options['--output']);
    await writeNewJson(directory, 'planning-context.json', context);
    return { status: 'CONTEXT_READY', contextSha256: context.sha256, candidates: context.candidates,
      ...(context.assetRetrieval ? { assetSummary: { library: context.assetRetrieval.library,
        rowIcons: context.assetRetrieval.candidates.filter(c => c.slot === 'row-icon').length,
        panelSurfaces: context.assetRetrieval.candidates.filter(c => c.slot === 'panel-surface').length,
        candidateFile: 'planning-context.json' } } : {}),
      next: 'Agent interprets this exact request and authors a proposal; no model was called by the CLI.' };
  }
  if (command === 'check-plan' || command === 'build-plan') {
    const file = args.shift(); if (!file || file.startsWith('--')) throw new Error('INPUT_REQUIRED');
    const options = parse(args, command === 'check-plan' ? ['--proposal'] : ['--proposal', '--output', '--assets', '--sharp-module']);
    if (!options['--proposal']) throw new Error('PROPOSAL_REQUIRED');
    const context = await validatePlanningContext(await readJson(file)), input = await readJson(options['--proposal']);
    if (command === 'check-plan') return checkPanelProposal(context, input);
    const { proposal, report } = await requireReadyProposal(context, input), core = await loadWorkspaceCore();
    let assets, assetReceipt;
    if (context.assetRetrieval) {
      if (!options['--assets']) throw new Error('PANEL_ASSETS_REQUIRED');
      const checked = await loadPanelPlanAssets(context, proposal.spec, options['--assets'], await loadTextureImageAdapter(options['--sharp-module']));
      assets = checked.assets; assetReceipt = checked.receipt;
    } else assets = await loadAssets(proposal.spec, options);
    const bundle = await createPanelBundle(proposal.spec, context.catalog, core, undefined, assets); await validatePanelBundle(bundle, core);
    return publish(bundle, options['--output'], [
      { path: 'planning-context.json', value: context }, { path: 'proposal.json', value: proposal },
      { path: 'planning-report.json', value: report }, { path: 'panel.spec.json', value: proposal.spec },
      ...(assetReceipt ? [{ path: 'asset-build-verification.json', value: assetReceipt }] : []),
    ]);
  }
  if (command === 'patch') {
    const file = args.shift(); if (!file || file.startsWith('--')) throw new Error('INPUT_REQUIRED');
    const options = parse(args, ['--patch', '--output', '--catalog', '--assets', '--sharp-module']);
    if (!options['--patch']) throw new Error('PATCH_REQUIRED');
    const input = await readJson(options['--patch']);
    const result = await applyPanelPatch(await readJson(file), input), core = await loadWorkspaceCore();
    // Entire patch and compiled geometry/catalog must pass before creating an output directory.
    const bundle = await createPanelBundle(result.spec, await loadCatalog(options), core, undefined, await loadAssets(result.spec, options)); await validatePanelBundle(bundle, core);
    return publish(bundle, options['--output'], [
      { path: 'panel.spec.json', value: result.spec }, { path: 'patch.json', value: input }, { path: 'patch-receipt.json', value: result.receipt },
    ]);
  }
  if (command === 'catalog') {
    const options = parse(args, ['--query', '--kind', '--catalog']);
    if (!options['--query']) throw new Error('QUERY_REQUIRED');
    return searchCatalog(await loadCatalog(options), { query: options['--query'],
      ...(options['--kind'] ? { kind: options['--kind'] } : {}), target: 'pixi' });
  }
  if (!['validate', 'compile', 'inspect', 'restore', 'export-unity'].includes(command)) throw new Error('CLI_COMMAND');
  const file = args.shift(); if (!file || file.startsWith('--')) throw new Error('INPUT_REQUIRED');
  const allowed = command === 'compile' ? ['--output', '--catalog', '--state', '--assets', '--sharp-module'] : command === 'restore' ? ['--output', '--state'] : command === 'export-unity' ? ['--output'] : [];
  const options = parse(args, allowed), input = await readJson(file);
  if (command === 'validate') {
    const spec = validatePanelSpec(input);
    return { status: 'SPEC_VALID', panelId: spec.id, specSha256: await digestJson(spec), rows: spec.sections.reduce((n, section) => n + section.rows.length, 0), catalogResolution: 'NOT_RUN' };
  }
  const core = await loadWorkspaceCore();
  if (command === 'compile') {
    const bundle = await createPanelBundle(input, await loadCatalog(options), core,
      options['--state'] ? await readJson(options['--state']) : undefined, await loadAssets(input, options));
    await validatePanelBundle(bundle, core);
    return publish(bundle, options['--output']);
  }
  const checked = await validatePanelBundle(input, core);
  if (command === 'export-unity') {
    if (!options['--output']) throw new Error('OUTPUT_REQUIRED');
    return exportUnityKit(checked, core, options['--output']);
  }
  if (command === 'inspect') return { status: 'BUNDLE_VALID', panelId: checked.spec.id,
    specSha256: await digestJson(checked.spec), state: checked.state, selection: checked.selection, capabilities: checked.capabilities, verification: checked.verification, sha256: checked.sha256 };
  if (!options['--state']) throw new Error('STATE_REQUIRED');
  const restored = await createPanelBundle(checked.spec, checked.catalog, core, await readJson(options['--state']), panelBundleAssetInputs(checked, core));
  await validatePanelBundle(restored, core);
  return publish(restored, options['--output']);
}

try { const result = await main(process.argv.slice(2)); if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); }
catch (error) {
  // Filesystem diagnostics can contain host paths; report only their stable code.
  const code = typeof error.code === 'string' ? error.code : error.issues?.[0]?.code ?? String(error.message).split(':')[0];
  const path = error.path ?? error.issues?.[0]?.path;
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', code, ...(path?.startsWith('$') ? { path } : {}) })}\n`);
  process.exitCode = 1;
}
