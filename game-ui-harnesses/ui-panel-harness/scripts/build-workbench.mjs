#!/usr/bin/env node
/** Build an offline static workbench. No server, model call, installation or sibling writes. */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { build } = await loadWorkspaceTool('vite');
import { validateCatalog } from '../src/catalog.mjs';
import { validatePlanningContext } from '../src/planning-context.mjs';
import { checkPanelProposal, validatePanelProposal } from '../src/proposal.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { verifyAssetLibrary } from '../src/asset-library.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { canonicalJson, digestBytes, digestJson } from '../src/canonical.mjs';
import { createStudioBuildInfo } from '../src/studio-build-info.mjs';
import { readJson, createOutputDirectory, writeNewJson, harnessRoot } from '../src/io.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';

const allowed = ['--catalog', '--output', '--assets', '--sharp-module', '--example-context', '--example-proposal'];
const fail = code => { throw new Error(code); };
function argumentsFor(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, args[i])) fail('WORKBENCH_ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  if (!options['--catalog'] || !options['--output']) fail('WORKBENCH_ARGUMENTS');
  if (Boolean(options['--example-context']) !== Boolean(options['--example-proposal'])) fail('WORKBENCH_EXAMPLE_PAIR_REQUIRED');
  if (options['--sharp-module'] && !options['--assets']) fail('WORKBENCH_ASSETS_REQUIRED');
  return options;
}
function safeCode(error, fallback) {
  // Arbitrary module/filesystem messages can contain absolute host paths. Never print them.
  for (const value of [error?.code, error?.issues?.[0]?.code, error?.message]) {
    if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value)) return value;
  }
  return fallback;
}

let phase = 'WORKBENCH_ARGUMENTS';
try {
  const options = argumentsFor(process.argv.slice(2));
  phase = 'WORKBENCH_CATALOG_INVALID';
  const catalog = validateCatalog(await readJson(options['--catalog']));
  let pool = null, poolTools;
  if (options['--assets']) {
    phase = 'WORKBENCH_POOL_INVALID';
    const verified = await verifyAssetLibrary(options['--assets'], await loadTextureImageAdapter(options['--sharp-module']));
    poolTools = await import('../src/workbench-assets.mjs');
    const resources = [...new Map(verified.index.records.map(record => [record.file.path, {
      path: record.file.path, mime: 'image/png', bytes: verified.blobs.get(record.file.path),
    }])).values()];
    pool = await poolTools.createWorkbenchAssetPool(verified.index, resources);
  }
  let example = null, exampleEvidence = null;
  if (options['--example-context']) {
    phase = 'WORKBENCH_EXAMPLE_INVALID';
    const context = await validatePlanningContext(await readJson(options['--example-context']));
    if (canonicalJson(context.catalog) !== canonicalJson(catalog)) fail('WORKBENCH_EXAMPLE_CATALOG_MISMATCH');
    const proposal = await validatePanelProposal(context, await readJson(options['--example-proposal']));
    const report = await checkPanelProposal(context, proposal);
    if (report.status !== 'READY_TO_COMPILE') fail('PLAN_NEEDS_INPUT');
    if (!pool && (context.assetRetrieval || proposal.spec.assets)) fail('WORKBENCH_EXAMPLE_POOL_REQUIRED');
    if (proposal.spec.assets && !context.assetRetrieval) fail('WORKBENCH_EXAMPLE_RETRIEVAL_REQUIRED');
    // An asset-free example may accompany a pool intended for later requests.
    if (context.assetRetrieval) await poolTools.verifyWorkbenchContextPool(context, pool);
    const assets = pool ? await poolTools.workbenchAssetInputs(proposal.spec, pool) : undefined;
    const core = await loadWorkspaceCore();
    const compiled = await createPanelBundle(proposal.spec, catalog, core, undefined, assets);
    const checked = await validatePanelBundle(compiled, core);
    example = { context, proposal };
    exampleEvidence = { contextSha256: context.sha256, proposalSha256: report.proposalSha256, panelSha256: checked.sha256 };
  }
  const seed = { workbenchSeedVersion: '0.1', catalog, pool, example };
  phase = 'WORKBENCH_BUILD_FAILED';
  const { renderWorkbenchHtml } = await import('../src/workbench-shell.mjs');
  const deliveryRuntime = await buildDeliveryRuntime();
  const result = await build({ configFile: false, root: harnessRoot, publicDir: false, logLevel: 'silent',
    plugins: [{name:'panel-delivery-runtime',resolveId(id){if(id==='virtual:panel-delivery-runtime')return '\0'+id;},load(id){if(id==='\0virtual:panel-delivery-runtime')return 'export default '+JSON.stringify(deliveryRuntime)+';';}}],
    build: { write: false, target: 'es2022', minify: true, sourcemap: false,
      lib: { entry: fileURLToPath(new URL('../src/workbench.mjs', import.meta.url)), name: 'PanelWorkbench',
        formats: ['iife'], fileName: () => 'workbench.js' },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  if (chunks.length !== 1 || chunks[0].type !== 'chunk' || chunks[0].fileName !== 'workbench.js'
    || chunks[0].imports.length || chunks[0].dynamicImports.some(path => path !== 'workbench.js')) fail('WORKBENCH_BUILD_SHAPE');
  const script = new TextEncoder().encode(chunks[0].code);
  const metadata = await readJson(new URL('../package.json', import.meta.url));
  const studio = await createStudioBuildInfo(metadata.version, {
    shellSha256: await digestBytes(new TextEncoder().encode(renderWorkbenchHtml(seed))), scriptSha256: await digestBytes(script) });
  const html = renderWorkbenchHtml(seed, studio);
  if (typeof html !== 'string' || !html.length) fail('WORKBENCH_HTML_REQUIRED');
  const contents = [{ path: 'index.html', bytes: new TextEncoder().encode(html) },
    { path: 'workbench.js', bytes: script }];
  const manifest = {
    studio,
    workbenchBuildVersion: '0.1', status: 'COMPLETE', catalogSha256: await digestJson(catalog),
    poolSha256: pool?.sha256 ?? null,
    library: pool ? { id: pool.index.id, sha256: pool.index.sha256 } : null,
    recordCount: pool?.index.records.length ?? 0, imageCount: pool?.resources.length ?? 0,
    deliveryRuntime: {version:deliveryRuntime.version,sha256:deliveryRuntime.sha256},
    sourceReplay: pool ? 'VERIFIED_AT_BUILD' : 'NOT_APPLICABLE', example: exampleEvidence,
    files: await Promise.all(contents.map(async file => ({ path: file.path, bytes: file.bytes.length, sha256: await digestBytes(file.bytes) }))),
    browser: 'NOT_RUN', humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN',
  };
  phase = 'WORKBENCH_OUTPUT_FAILED';
  // No output is created until every source/example check and bundling step succeeds.
  const directory = await createOutputDirectory(options['--output']);
  for (const file of contents) await writeFile(resolve(directory, file.path), file.bytes, { flag: 'wx' });
  await writeNewJson(directory, 'workbench-build.json', manifest);
  process.stdout.write(`${JSON.stringify({ status: 'STATIC_WORKBENCH_BUILT', files: ['index.html', 'workbench.js', 'workbench-build.json'],
    catalogSha256: manifest.catalogSha256, poolSha256: manifest.poolSha256, recordCount: manifest.recordCount, imageCount: manifest.imageCount })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: safeCode(error, phase) })}\n`);
  process.exitCode = 1;
}
