#!/usr/bin/env node
import { importAssetBatch, verifyAssetLibrary, searchAssets, resolveAsset } from '../src/asset-library.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';

const usage = `Generic UI assets — PNG/SVG plus authored metadata, local only
  node scripts/assets.mjs import --manifest <assets.json> --output <fresh-directory> [--base <curated-or-asset-library>] [--id <library-id>]
  node scripts/assets.mjs verify --library <asset-library-directory>
  node scripts/assets.mjs search --library <directory> --query <text> [--role icon|shape|effect|layout-primitive|animation-part] [--style <style>] [--all-versions]
  node scripts/assets.mjs resolve --library <directory> --key <namespace/id@1.0.0>
All commands accept --sharp-module <installed-module-directory>.
Import writes a new package inside this Harness. Inputs and existing versions are never overwritten.
Search defaults to icons and the latest exact version of each asset. Resolve always requires an exact version.
No installation, network, model calls, or engine export.
`;
function parse(args, allowed) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.includes(key) || Object.hasOwn(options, key)) throw new Error('ASSET_ARGUMENTS');
    if (key === '--all-versions') options[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('ASSET_ARGUMENTS');
      options[key] = value;
    }
  }
  return options;
}
async function main(args) {
  const command = args.shift();
  if (!command || command === '--help' || command === 'help') { process.stdout.write(usage); return; }
  const allowed = { import: ['--manifest', '--output', '--base', '--id'], verify: ['--library'],
    search: ['--library', '--query', '--role', '--style', '--all-versions'], resolve: ['--library', '--key'] }[command];
  if (!allowed) throw new Error('ASSET_COMMAND');
  const options = parse(args, [...allowed, '--sharp-module']);
  if (command === 'import' ? !options['--manifest'] || !options['--output'] : !options['--library']) throw new Error('ASSET_INPUT_REQUIRED');
  if (command === 'search' && !options['--query'] || command === 'resolve' && !options['--key']) throw new Error('ASSET_INPUT_REQUIRED');
  const adapter = await loadTextureImageAdapter(options['--sharp-module']);
  if (command === 'import') {
    const index = await importAssetBatch(options['--manifest'], options['--output'], adapter, {
      ...(options['--base'] ? { base: options['--base'] } : {}), ...(options['--id'] ? { id: options['--id'] } : {}),
    });
    return { status: 'IMPORTED', sha256: index.sha256, summary: index.summary,
      changes: { added: index.changes.added, reused: index.changes.reused, retainedCount: index.changes.retained.length }, nativeEngines: 'NOT_RUN' };
  }
  const { index } = await verifyAssetLibrary(options['--library'], adapter);
  if (command === 'verify') return { status: 'VERIFIED', sha256: index.sha256, summary: index.summary, verification: index.verification };
  if (command === 'resolve') return resolveAsset(index, options['--key']);
  return searchAssets(index, options['--query'], { role: options['--role'], style: options['--style'], allVersions: options['--all-versions'] ?? false });
}
try { const result = await main(process.argv.slice(2)); if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: error.code ?? String(error.message).split(':')[0] })}\n`); process.exitCode = 1; }
