#!/usr/bin/env node
import { importTextureLibrary, verifyTexturePackage, searchTextures } from '../src/texture-library.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';

const usage = `Texture library and modern UI vector redesign — local only
  node scripts/textures.mjs intake --source <textures-directory> --output <fresh-directory> [--id <library-id>]
  node scripts/textures.mjs redraw --library <source-package-directory> --output <fresh-directory> [--id <library-id>]
  node scripts/textures.mjs curate --library <full-redesign-package> --output <fresh-directory> [--id <library-id>]
  node scripts/textures.mjs verify --library <package-directory>
  node scripts/textures.mjs search --library <package-directory> --query <text> [--category icon|border|shadow|demo|other] [--role icon|shape|effect|layout-primitive|animation-part]
Curated libraries search icons by default; select a role explicitly to query shapes, effects, layout primitives, or animation parts.
Full libraries retain their previous search behavior when --role is omitted.
All commands accept --sharp-module <installed-sharp-module-directory> when Sharp is not locally resolvable.
No installation, model calls, new services, original writes, or sibling writes. Outputs stay in this Harness.
`;
function parse(args, allowed) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || options[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('TEXTURE_ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  return options;
}
async function main(args) {
  const command = args.shift();
  if (!command || ['--help', 'help'].includes(command)) { process.stdout.write(usage); return; }
  const allowed = { intake: ['--source', '--output', '--id'], redraw: ['--library', '--output', '--id'],
    curate: ['--library', '--output', '--id'], verify: ['--library'], search: ['--library', '--query', '--category', '--role'] }[command];
  if (!allowed) throw new Error('TEXTURE_COMMAND');
  const options = parse(args, [...allowed, '--sharp-module']);
  if (command === 'intake' ? !options['--source'] || !options['--output'] : !options['--library']) throw new Error('TEXTURE_INPUT_REQUIRED');
  if (['redraw', 'curate'].includes(command) && !options['--output']) throw new Error('TEXTURE_OUTPUT_REQUIRED');
  const adapter = await loadTextureImageAdapter(options['--sharp-module']);
  if (command === 'intake') {
    const index = await importTextureLibrary(options['--source'], options['--output'], adapter, options['--id'] ? { id: options['--id'] } : {});
    return { status: 'IMPORTED', sha256: index.sha256, summary: index.summary };
  }
  if (command === 'redraw') {
    const { redesignTextures } = await import('../src/texture-redesign.mjs');
    const index = await redesignTextures(options['--library'], options['--output'], adapter, {
      ...(options['--id'] ? { id: options['--id'] } : {}), onProgress: progress => process.stderr.write(`${JSON.stringify({ status: 'RENDERING', ...progress })}\n`),
    });
    return { status: 'REDRAWN', sha256: index.sha256, summary: index.summary, previews: index.previews, nativeEngines: 'NOT_RUN' };
  }
  if (command === 'curate') {
    const { curateTextureLibrary } = await import('../src/texture-curation.mjs');
    const index = await curateTextureLibrary(options['--library'], options['--output'], adapter, options['--id'] ? { id: options['--id'] } : {});
    return { status: 'CURATED', sha256: index.sha256, summary: index.summary, usageSummary: index.usageSummary,
      excluded: index.exclusions.length, previews: index.previews, nativeEngines: 'NOT_RUN' };
  }
  const result = await verifyTexturePackage(options['--library'], adapter);
  if (command === 'verify') return { status: 'VERIFIED', kind: result.manifest.kind, sha256: result.index.sha256, summary: result.index.summary,
    scope: 'Artifact hashes and decoded-image consistency; not human visual or native-engine acceptance' };
  return searchTextures(result.index, options['--query'], { category: options['--category'], role: options['--role'] });
}
try { const result = await main(process.argv.slice(2)); if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: error.code ?? String(error.message).split(':')[0] })}\n`); process.exitCode = 1; }
