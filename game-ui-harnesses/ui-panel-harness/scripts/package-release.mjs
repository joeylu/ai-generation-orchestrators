#!/usr/bin/env node
/** Build a portable, allowlisted SDK from local pinned inputs. No install, publish or model call. */
import { readFile, writeFile, mkdir, readdir, lstat, mkdtemp } from 'node:fs/promises';
import { resolve, dirname, relative, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { canonicalJson, digestBytes } from '../src/canonical.mjs';
import { harnessRoot, createOutputDirectory } from '../src/io.mjs';
import { createStoredZip } from '../src/zip-store.mjs';
import { UNITY_SOURCE_PATHS } from '../src/unity-kit.mjs';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';

const utf8 = text => new TextEncoder().encode(text);
const json = value => utf8(canonicalJson(value) + '\n');
const fail = code => { throw new Error(code); };
const safePath = value => typeof value === 'string' && /^[A-Za-z0-9_.@/-]+$/.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');

/** The digest is checked before parsing. Never extract links, traversal paths or executable hooks. */
export function readPinnedTar(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }), files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const text = (start, size) => header.subarray(start, start + size).toString('utf8').replace(/\0.*$/s, '');
    const octal = (start, size) => {
      const value = text(start, size).trim();
      if (!/^[0-7]+$/.test(value)) fail('RELEASE_TAR_HEADER');
      return parseInt(value, 8);
    };
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (checksum !== octal(148, 8)) fail('RELEASE_TAR_HEADER');
    const prefix = text(345, 155), name = (prefix ? prefix + '/' : '') + text(0, 100);
    const size = octal(124, 12), type = text(156, 1);
    offset += 512;
    if (size > 16 * 1024 * 1024 || offset + size > tar.length) fail('RELEASE_TAR_LIMIT');
    if (type === '' || type === '0') {
      if (!safePath(name) || !name.startsWith('package/') || files.has(name)) fail('RELEASE_TAR_PATH');
      files.set(name, new Uint8Array(tar.subarray(offset, offset + size)));
    } else if (!['5', 'x', 'g'].includes(type)) fail('RELEASE_TAR_TYPE');
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

let parser;
async function imports(code) {
  parser ??= import(pathToFileURL(createRequire(new URL('../../ui-component-harness/package.json', import.meta.url)).resolve('rolldown/parseAst')).href);
  const { parseAst } = await parser, result = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(value.type) && value.source) {
      if (typeof value.source.value !== 'string') fail('RELEASE_DYNAMIC_DEPENDENCY');
      result.push(value.source.value);
    }
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
  }
  visit(parseAst(code));
  return result;
}
async function closure(entries, read, external) {
  const files = new Map(), queue = [...entries];
  while (queue.length) {
    const name = queue.shift();
    if (!safePath(name) || files.has(name)) continue;
    const bytes = await read(name);
    if (!bytes) fail('RELEASE_DEPENDENCY_MISSING');
    files.set(name, bytes);
    for (const dependency of await imports(new TextDecoder().decode(bytes))) {
      if (dependency.startsWith('node:') || external?.(dependency)) continue;
      if (!dependency.startsWith('.')) fail('RELEASE_EXTERNAL_DEPENDENCY');
      const target = posix.normalize(posix.join(posix.dirname(name), dependency));
      if (!safePath(target)) fail('RELEASE_DEPENDENCY_PATH');
      queue.push(target);
    }
  }
  return files;
}
async function sourceFile(name) {
  const url = new URL(name, pathToFileURL(harnessRoot));
  if (!(await lstat(url)).isFile() || (await lstat(url)).isSymbolicLink()) fail('RELEASE_SOURCE_LINK');
  return new Uint8Array(await readFile(url));
}
async function addTree(files, name, suffixes) {
  for (const entry of await readdir(resolve(harnessRoot, name), { withFileTypes: true })) {
    const child = name + '/' + entry.name;
    if (entry.isSymbolicLink()) fail('RELEASE_SOURCE_LINK');
    if (entry.isDirectory()) await addTree(files, child, suffixes);
    else if (suffixes.some(suffix => child.endsWith(suffix))) files.set(child, await sourceFile(child));
  }
}
async function writeTree(root, files) {
  for (const [name, bytes] of files) {
    await mkdir(dirname(resolve(root, name)), { recursive: true });
    await writeFile(resolve(root, name), bytes, { flag: 'wx' });
  }
}
async function noticesFor(ids, componentLicense, licenseSources) {
  const packages = new Map(), visited = new Set();
  for (const id of ids) {
    if (id.includes('\0') || !id.includes('node_modules')) continue;
    for (let directory = dirname(id.split('?')[0]); !visited.has(directory); directory = dirname(directory)) {
      visited.add(directory);
      let metadata;
      try { metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')); } catch {}
      if (metadata?.name && metadata.version) {
        const licenseNames = (await readdir(directory)).filter(name => /^(?:license|copying|notice)(?:\.|$)/i.test(name)).sort();
        let texts = await Promise.all(licenseNames.map(name => readFile(resolve(directory, name), 'utf8')));
        if (!texts.length) {
          const source = licenseSources.find(row => row.package === metadata.name && row.version === metadata.version);
          if (!source) throw new Error('RELEASE_LICENSE_MISSING', { cause: { package: metadata.name, version: metadata.version } });
          const bytes = await sourceFile(source.file);
          if (await digestBytes(bytes) !== source.sha256) fail('RELEASE_LICENSE_DIGEST');
          texts = ['Source: ' + source.url + '\n\n' + new TextDecoder().decode(bytes)];
        }
        packages.set(metadata.name + '@' + metadata.version, texts);
        break;
      }
      if (dirname(directory) === directory) break;
    }
  }
  if (!packages.has('pixi.js@8.20.1')) fail('RELEASE_PIXI_VERSION');
  return 'ai-ui-component-harness 0.2.0-rc.3\n\n' + componentLicense + '\n\n'
    + [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, texts]) => name + '\n\n' + texts.join('\n\n')).join('\n\n');
}
async function browserRuntime(componentFiles, scratch, componentLicense, licenseSources) {
  await writeTree(scratch, componentFiles);
  const { build } = await loadWorkspaceTool('vite');
  const componentPackage = new URL('../../ui-component-harness/package.json', import.meta.url);
  const pixiMetadataPath = fileURLToPath(new URL('node_modules/pixi.js/package.json', componentPackage));
  const pixiMetadata = JSON.parse(await readFile(pixiMetadataPath, 'utf8'));
  if (pixiMetadata.version !== '8.20.1') fail('RELEASE_PIXI_VERSION');
  const pixiEntry = resolve(dirname(pixiMetadataPath), pixiMetadata.module);
  const target = fileURLToPath(new URL('../src/workspace/component-browser.mjs', import.meta.url));
  const component = name => JSON.stringify(resolve(scratch, 'lib', name));
  const bridge = `import * as compiler from ${component('tree-compiler.js')};
import * as contract from ${component('tree-contract.js')};
import * as bundle from ${component('bundle.js')};
import {createComponentCore} from ${JSON.stringify(fileURLToPath(new URL('../src/workspace/component-contract.mjs', import.meta.url)))};
export {createTreePreview} from ${component('tree-runtime.js')};
export {MotionAnimator,getMotionStyle} from ${component('motion-system.js')};
export const componentCore=createComponentCore(compiler,contract,bundle);`;
  const result = await build({ configFile: false, root: harnessRoot, publicDir: false, logLevel: 'silent',
    resolve: { alias: [{ find: 'pixi.js', replacement: pixiEntry }] },
    plugins: [{ name: 'panel-pinned-component', resolveId(id) { if (id === target || id.endsWith('/workspace/component-browser.mjs')) return '\0panel-pinned-component'; },
      load(id) { if (id === '\0panel-pinned-component') return bridge; } }],
    build: { write: false, target: 'es2022', minify: true, sourcemap: false,
      rolldownOptions: { output: { codeSplitting: false } },
      lib: { entry: fileURLToPath(new URL('../src/delivery-runtime.mjs', import.meta.url)), name: 'PanelDelivery',
        formats: ['es', 'iife'], fileName: format => format === 'es' ? 'index.js' : 'panel-runtime.js' } } });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(value => value.output);
  if (chunks.length !== 2 || chunks.some(chunk => chunk.type !== 'chunk' || chunk.imports.length
    || chunk.dynamicImports.some(name => name !== chunk.fileName))) throw new Error('RELEASE_BROWSER_SHAPE', {
      cause: chunks.map(chunk => ({ name: chunk.fileName, type: chunk.type, imports: chunk.imports, dynamicImports: chunk.dynamicImports })) });
  return { code: new Map(chunks.map(chunk => [chunk.fileName, utf8(chunk.code)])),
    notices: await noticesFor(chunks.flatMap(chunk => Object.keys(chunk.modules)), componentLicense, licenseSources) };
}

export async function packagePanelRelease({ componentPackage, output }) {
  const contract = JSON.parse(await readFile(new URL('../release/contract.json', import.meta.url), 'utf8'));
  const upstreamBytes = await readFile(componentPackage);
  if (await digestBytes(upstreamBytes) !== contract.component.sha256) fail('RELEASE_COMPONENT_DIGEST');
  const upstream = readPinnedTar(upstreamBytes);
  const metadata = JSON.parse(new TextDecoder().decode(upstream.get('package/package.json')));
  if (metadata.name !== contract.component.name || metadata.version !== contract.component.version) fail('RELEASE_COMPONENT_IDENTITY');
  const readComponent = name => upstream.get('package/' + name);
  const componentNode = await closure(['lib/tree-compiler.js', 'lib/tree-contract.js', 'lib/bundle.js'], readComponent);
  const componentBrowser = await closure(['lib/tree-runtime.js', 'lib/motion-system.js', ...componentNode.keys()], readComponent, name => name === 'pixi.js');
  const files = await closure(['src/sdk.mjs'], sourceFile, name => name.startsWith('../vendor/component/'));
  for (const name of files.keys()) if (!name.startsWith('src/')) fail('RELEASE_SOURCE_SCOPE');
  await addTree(files, 'prompts', ['.md']);
  await addTree(files, 'schemas', ['.json']);
  await addTree(files, 'assets/core-v1', ['.json', '.md', '.png', '.svg']);
  await addTree(files, 'release/licenses', ['.txt']);
  for (const name of ['catalog/modern-core.json', 'examples/modern-menu.catalog.json', 'examples/audio-settings.panel.json',
    'examples/layout-v1/settings.panel.json', 'examples/controls-planning/proposal.json', 'examples/asset-planning/proposal.json',
    'docs/sdk-release.md', 'release/contract.json']) files.set(name, await sourceFile(name));
  for (const name of UNITY_SOURCE_PATHS) files.set('adapters/unity/' + name, await sourceFile('adapters/unity/' + name));
  const sourceFiles = [...files.keys()];
  let commit, dirty;
  try {
    const git = args => execFileSync('git', ['-c', `safe.directory=${resolve(harnessRoot, '../..').replaceAll('\\', '/')}`, ...args],
      { cwd: harnessRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    commit = git(['rev-parse', 'HEAD']);
    dirty = Boolean(git(['status', '--porcelain', '--', '.', '../../LICENSE']));
  } catch { fail('RELEASE_SOURCE_GIT_REQUIRED'); }
  const scratchParent = resolve(harnessRoot, '.tmp');
  await mkdir(scratchParent, { recursive: true });
  const scratch = await mkdtemp(resolve(scratchParent, 'panel-release-'));
  const componentLicense = new TextDecoder().decode(upstream.get('package/LICENSE'));
  const browser = await browserRuntime(componentBrowser, scratch, componentLicense, contract.licenseSources);
  for (const [name, bytes] of componentNode) files.set('vendor/component/' + name, bytes);
  files.set('vendor/component/LICENSE', utf8(componentLicense));
  files.set('vendor/component/package.json', json({ name: metadata.name, version: metadata.version, type: 'module', private: true }));
  files.set('runtime/panel-runtime.js', browser.code.get('panel-runtime.js'));
  files.set('dist-browser/index.js', browser.code.get('index.js'));
  files.set('THIRD_PARTY_NOTICES.txt', utf8(browser.notices));
  files.set('LICENSE', new Uint8Array(await readFile(new URL('../../../LICENSE', import.meta.url))));
  files.set('README.md', files.get('docs/sdk-release.md'));
  files.set('package.json', json({ name: contract.name, version: contract.version, type: 'module', private: true, license: 'MIT',
    engines: { node: contract.runtime.node }, exports: { '.': './src/index.mjs', './sdk': './src/sdk.mjs', './browser/standalone': './dist-browser/index.js' } }));
  const manifest = { releaseManifestVersion: '0.1', package: { name: contract.name, version: contract.version, tag: contract.tag },
    source: { repository: contract.repository, commit, dirty, baselineCommit: contract.baselineCommit },
    dependencies: [contract.component], runtime: contract.runtime, modelCalls: 0,
    verification: { browser: 'NOT_RUN', unityNative: 'NOT_RUN', model: 'NOT_RUN' },
    files: await Promise.all([...files].sort(([a], [b]) => a < b ? -1 : 1).map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await digestBytes(bytes) }))) };
  files.set('release-manifest.json', json(manifest));
  files.set('SHA256SUMS', utf8((await Promise.all([...files].sort(([a], [b]) => a < b ? -1 : 1)
    .map(async ([name, bytes]) => `${await digestBytes(bytes)}  ${name}\n`))).join('')));
  const directory = await createOutputDirectory(output);
  const name = `${contract.name}-${contract.version}.zip`;
  const archive = createStoredZip(new Map([...files].map(([name, bytes]) => ['package/' + name, bytes])));
  await writeFile(resolve(directory, name), archive, { flag: 'wx' });
  const report = { status: 'SDK_CANDIDATE_BUILT', file: name, bytes: archive.length, sha256: await digestBytes(archive),
    tag: contract.tag, source: manifest.source, publicationEligible: !dirty, files: files.size,
    dependency: contract.component, modelCalls: 0, sourceFiles, verification: manifest.verification };
  await writeFile(resolve(directory, 'package-report.json'), json(report), { flag: 'wx' });
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--component-package', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) fail('RELEASE_ARGUMENTS');
      options[args[i]] = args[i + 1];
    }
    if (!options['--component-package'] || !options['--output']) fail('RELEASE_ARGUMENTS');
    const report = await packagePanelRelease({ componentPackage: options['--component-package'], output: options['--output'] });
    process.stdout.write(JSON.stringify({ status: report.status, file: report.file, bytes: report.bytes, sha256: report.sha256,
      publicationEligible: report.publicationEligible, modelCalls: 0 }) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ status: 'FAILED', code: /^RELEASE_[A-Z_]+$/.test(error.message) ? error.message : 'RELEASE_BUILD_FAILED' }) + '\n');
    process.exitCode = 1;
  }
}
