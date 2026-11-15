import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { buildStudio, packageRoot } from './studio-build.mjs';
import { startStudio } from '../src/studio/host.mjs';
import { parseJson, readSelectedFile } from '../src/files.mjs';

function verifyReleaseCommit(expected) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expected)) throw new Error('Use the full Git commit for --release-commit');
  const git = (...args) => execFileSync('git', args, {
    cwd: packageRoot, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }).trim();
  if (git('rev-parse', '--verify', 'HEAD') !== expected) throw new Error('Studio checkout differs from the pinned commit');
  if (git('status', '--porcelain=v1', '--untracked-files=all', '--', '.',
    '../../game-ui-harnesses/ui-reference-harness/web/adapters')) throw new Error('A pinned Studio requires clean runtime sources');
}

try {
  const args = process.argv.slice(2), command = args.shift();
  if (!['build', 'serve'].includes(command)) throw new Error('Use studio.mjs build|serve [--port PORT] [--kit DIRECTORY] [--map JSON] [--projects DIRECTORY] [--project-name NAME] [--terrain-config JSON] [--environment-exchange DIRECTORY --environment-style JSON] [--animation-exchange DIRECTORY] [--dependencies PACKAGE_ROOT] [--release-commit FULL_SHA]');
  const roots = []; let port = 4176, root = join(packageRoot, 'tests/fixtures/synthetic'), terrainConfig, mapFile, workspaceRoot, projectName, environmentRoot, environmentStyle, animationExchangeRoot, releaseCommit;
  while (args.length) {
    const key = args.shift(), value = args.shift();
    if (!value) throw new Error('Every option requires a value');
    if (key === '--dependencies') roots.push(resolve(value));
    else if (key === '--kit') root = resolve(value);
    else if (key === '--terrain-config' && command === 'serve' && !terrainConfig) terrainConfig = resolve(value);
    else if (key === '--map' && command === 'serve' && !mapFile) mapFile = resolve(value);
    else if (key === '--projects' && command === 'serve' && !workspaceRoot) workspaceRoot=resolve(value);
    else if (key === '--project-name' && command === 'serve' && !projectName) projectName=value;
    else if (key === '--environment-exchange' && command === 'serve' && !environmentRoot) environmentRoot=resolve(value);
    else if (key === '--environment-style' && command === 'serve' && !environmentStyle) environmentStyle=resolve(value);
    else if (key === '--animation-exchange' && command === 'serve' && !animationExchangeRoot) animationExchangeRoot=resolve(value);
    else if (key === '--release-commit' && !releaseCommit) releaseCommit = value;
    else if (key === '--port' && /^\d+$/.test(value) && Number(value) <= 65535) port = Number(value);
    else throw new Error('Unsupported option');
  }
  if (releaseCommit) verifyReleaseCommit(releaseCommit);
  const terrainPreview = terrainConfig
    ? (await import('../src/studio/terrain-config.mjs')).loadTerrainPreviewConfig(terrainConfig) : null;
  const initialDocument = mapFile ? parseJson(readSelectedFile(mapFile), 'scene.document.json') : undefined;
  if (Boolean(environmentRoot)!==Boolean(environmentStyle)) throw new Error('Environment generation requires both exchange directory and project style file');
  const environmentLibrary=environmentRoot?{root:environmentRoot,style:parseJson(readSelectedFile(environmentStyle),'environment-style.json')}:undefined;
  const staticRoot = await buildStudio({ roots });
  if (command === 'build') console.log(JSON.stringify({ status: 'built', artifact: 'dist/studio', generationCalls: 0 }));
  else {
    const host = await startStudio({ root, staticRoot, port, terrainPreview, initialDocument, workspaceRoot, projectName, environmentLibrary, animationExchangeRoot, releaseCommit });
    console.log(JSON.stringify({ status: 'local-studio', url: host.url, generationCalls: 0 }));
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await host.close(); process.exit(0); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', message: error.errors ? 'Configured kit rejected' : error.message, ...(error.errors ? { errors: error.errors } : {}) }));
  process.exitCode = 1;
}
