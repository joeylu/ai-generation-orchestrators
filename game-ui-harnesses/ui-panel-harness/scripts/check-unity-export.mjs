#!/usr/bin/env node
/** Isolated, local Unity acceptance. No model calls, registry packages, or source-project edits. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOutputDirectory, harnessRoot, writeNewJson } from '../src/io.mjs';
import { canonicalJson } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createUnityDocument, UNITY_ADAPTER_VERSION } from '../src/unity-export.mjs';
import { createUnityRuntimeIdentity, UNITY_SOURCE_PATHS } from '../src/unity-kit.mjs';
import { validatePublicationReports } from './publish-unity-export.mjs';
import { parseNativeJson, readManagedUnityPackage, readNativeFile } from './unity-package-evidence.mjs';

const ownPath = fileURLToPath(import.meta.url);
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = path => path.split(sep).join('/');
const requireThat = (condition, code) => { if (!condition) throw new Error(code); };

async function fileBytes(path, maximum = MAX_FILE_BYTES) {
  const info = await lstat(path);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.size <= maximum, 'INPUT_FILE_INVALID');
  return readFile(path);
}

async function jsonAt(path, maximum = 2 * 1024 * 1024) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(path, maximum)));
}

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: 'wx' });
}

/** Diagnostics deliberately exclude machine paths, licensing payloads and transport details. */
export function sanitizeUnityDiagnostic(message) {
  return String(message)
    .replace(/LicenseClient-[^\s"'<>),:\[\]]+/gi, '[license channel]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"'<>]*/g, '[local path]')
    .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[network address]')
    .replace(/\[[A-Fa-f0-9:.%]+\](?::\d+)?/g, value => isIP(value.slice(1, value.indexOf(']')).split('%')[0]) ? '[IP address]' : value)
    .replace(/(?<![A-Za-z0-9])(?:[A-Fa-f0-9]{0,4}:){2,}[A-Fa-f0-9:.]*(?:%[A-Za-z0-9_-]+)?/g,
      value => isIP(value.split('%')[0]) ? '[IP address]' : value)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g,
      value => isIP(value.split(':')[0]) ? '[IP address]' : value)
    .replace(/\b(?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '[email]');
}

function safeDiagnostics(raw) {
  return raw.split(/\r?\n/)
    .filter(line => /error CS\d+|error:|\bException\b|Aborting|exiting with code|Compilation failed|executeMethod|license.*(?:invalid|failed|error)|licensing.*(?:invalid|failed|error)/i.test(line))
    .filter(line => !/token|password|serial number|machine id|entitlement.*(?:id|details)/i.test(line))
    .slice(0, 100).map(sanitizeUnityDiagnostic);
}

const stableCode = (value, fallback) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,160}$/.test(value) ? value : fallback;

/** Pure outcome aggregation also preserves partial smoke evidence after a nonzero exit. */
export function summarizeUnityRun({ exitCode, timedOut = false, launchError }, smoke, smokeReadError) {
  const summary = { status: 'FAIL', exitCode, checks: [] };
  let smokeValid = false;
  if (smoke && typeof smoke === 'object') {
    const checks = Array.isArray(smoke.checks) ? smoke.checks.filter(check => check &&
      stableCode(check.name, null) && ['PASS', 'FAIL'].includes(check.status)).map(check => ({ name: check.name, status: check.status })) : [];
    const error = stableCode(smoke.error, 'UNITY_SMOKE_FAILURE');
    const failedStage = stableCode(smoke.failedStage, null) ?? checks.find(check => check.status === 'FAIL')?.name ??
      (smoke.status === 'FAIL' && error.startsWith('PANEL_SMOKE_') ? error.slice('PANEL_SMOKE_'.length) : undefined);
    summary.smoke = { status: ['PASS', 'FAIL'].includes(smoke.status) ? smoke.status : 'INVALID', checks };
    if (smoke.status === 'FAIL') summary.smoke.error = error;
    if (failedStage) { summary.smoke.failedStage = failedStage; summary.failedStage = failedStage; }
    if (typeof smoke.playMode === 'boolean') summary.smoke.playMode = smoke.playMode;
    if (typeof smoke.rendered === 'boolean') summary.smoke.rendered = smoke.rendered;
    if (smoke.coverage && typeof smoke.coverage === 'object') summary.smoke.coverage = Object.fromEntries(Object.entries(smoke.coverage)
      .filter(([name, value]) => stableCode(name, null) && Number.isSafeInteger(value) && value >= 0));
    summary.checks = checks;
    smokeValid = ['PASS', 'FAIL'].includes(smoke.status) && Array.isArray(smoke.checks) && checks.length === smoke.checks.length &&
      !/[A-Za-z]:[\\/]|\\\\|https?:\/\//i.test(JSON.stringify(smoke));
  }
  let error;
  if (timedOut) { summary.status = 'TIMEOUT'; error = 'UNITY_TIMEOUT'; }
  else if (launchError) error = stableCode(launchError.code, 'UNITY_LAUNCH_FAILED');
  else if (smokeValid && smoke.status === 'FAIL') error = summary.smoke.error;
  else if (exitCode !== 0) error = 'UNITY_EXIT_FAILURE';
  else if (smokeReadError) error = smokeReadError.code === 'ENOENT' ? 'UNITY_SMOKE_REPORT_MISSING' : 'UNITY_SMOKE_REPORT_UNREADABLE';
  else if (!smokeValid) error = 'UNITY_SMOKE_REPORT_INVALID';
  else if (!summary.checks.length || summary.checks.some(check => check.status !== 'PASS')) error = 'UNITY_SMOKE_FAILURE';
  else summary.status = 'PASS';
  if (error) { summary.error = error; summary.primaryError = error; }
  return summary;
}

/** Retry only a transient file deletion; never the editor invocation or smoke checks. */
export async function cleanupUnityPrivateLog(path, operations = {}) {
  const remove = operations.remove ?? unlink;
  const sleep = operations.sleep ?? (milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds)));
  const delays = [100, 250, 500, 1000, 2000];
  for (let attempt = 0; ; attempt += 1) {
    try { await remove(path); return { status: 'REMOVED', attempts: attempt + 1 }; }
    catch (error) {
      if (error.code === 'ENOENT') return { status: 'ABSENT', attempts: attempt + 1 };
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt === delays.length)
        return { status: 'RETAINED', attempts: attempt + 1, warning: 'RAW_LOG_CLEANUP_FAILED', code: stableCode(error.code, 'FILE_CLEANUP_ERROR') };
      await sleep(delays[attempt]);
    }
  }
}

async function verifiedKit(directory) {
  requireThat(!(await lstat(directory)).isSymbolicLink(), 'KIT_LINK_FORBIDDEN');
  const manifestBytes = await fileBytes(join(directory, 'export-manifest.json'), 2 * 1024 * 1024);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  requireThat(manifest.unityExportVersion === '0.1' && manifest.adapterVersion === UNITY_ADAPTER_VERSION && manifest.status === 'COMPLETE' &&
    manifest.target === 'unity-ugui' && /^[a-f0-9]{64}$/.test(manifest.panelSha256) && manifest.verification?.sourceBundle === 'PASS', 'KIT_MANIFEST_INVALID');
  requireThat(Array.isArray(manifest.files) && manifest.files.length >= 3 && manifest.files.length <= 2048, 'KIT_MANIFEST_INVALID');
  const files = new Map();
  for (const file of manifest.files) {
    requireThat(typeof file.path === 'string' && /^[A-Za-z0-9._/-]+$/.test(file.path) && !file.path.startsWith('/') &&
      file.path.split('/').every(part => part && part !== '.' && part !== '..') && !files.has(file.path), 'KIT_MANIFEST_PATH');
    requireThat(/^[a-f0-9]{64}$/.test(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes >= 0, 'KIT_MANIFEST_FILE');
    let checked = directory;
    for (const part of file.path.split('/')) {
      checked = join(checked, part);
      requireThat(!(await lstat(checked)).isSymbolicLink(), 'KIT_LINK_FORBIDDEN');
    }
    const bytes = await fileBytes(checked);
    requireThat(bytes.length === file.bytes && hash(bytes) === file.sha256, 'KIT_MANIFEST_INTEGRITY');
    files.set(file.path, { path: file.path, bytes });
  }
  requireThat(files.has('panel.unity.json') && files.has('panel.bundle.json'), 'KIT_DOCUMENT_MISSING');
  return { manifest, manifestSha256: hash(manifestBytes), files };
}

async function builtinPackages(editorDirectory, includeAudio = false) {
  const directory = join(editorDirectory, 'Data', 'Resources', 'PackageManager', 'BuiltInPackages');
  const dependencies = {};
  const visit = async name => {
    if (dependencies[name]) return;
    requireThat(/^com\.unity\.(?:ugui|modules\.[a-z0-9]+)$/.test(name), 'NON_BUILTIN_DEPENDENCY');
    const manifest = await jsonAt(join(directory, name, 'package.json'));
    requireThat(manifest.name === name && /^\d+\.\d+\.\d+$/.test(manifest.version), 'BUILTIN_PACKAGE_INVALID');
    dependencies[name] = manifest.version;
    for (const child of Object.keys(manifest.dependencies ?? {}).sort()) await visit(child);
  };
  for (const name of ['com.unity.ugui', 'com.unity.modules.ui', 'com.unity.modules.imgui', 'com.unity.modules.uielements',
    'com.unity.modules.physics', 'com.unity.modules.jsonserialize', 'com.unity.modules.imageconversion', 'com.unity.modules.animation']) await visit(name);
  if (includeAudio) await visit('com.unity.modules.audio');
  requireThat(dependencies['com.unity.ugui'] === '2.0.0', 'UGUI_VERSION_UNSUPPORTED');
  return Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

async function editorVersion(executable) {
  requireThat(basename(executable).toLowerCase() === 'unity.exe', 'WINDOWS_UNITY_EXECUTABLE_REQUIRED');
  const bytes = await fileBytes(executable);
  requireThat(bytes.toString('ascii', 0, 2) === 'MZ', 'UNITY_EXECUTABLE_INVALID');
  // Read the PE ProductVersion resource without starting the editor or querying the host registry.
  const key = Buffer.from('ProductVersion\0', 'utf16le'), offset = bytes.indexOf(key);
  requireThat(offset >= 0, 'UNITY_VERSION_MISSING');
  const match = bytes.subarray(offset + key.length, offset + key.length + 128).toString('utf16le')
    .match(/\b(6000\.\d+\.\d+[abfp]\d+)(?:_([a-f0-9]+))?\b/);
  requireThat(match, 'UNITY_VERSION_UNSUPPORTED');
  return { version: match[1], revision: match[2] ?? '', executableSha256: hash(bytes) };
}

/** This prepares files only. Calling it never launches Unity. */
export async function prepareUnityValidation(options) {
  const executable = resolve(options.unity), fontSource = resolve(options.font), kitSource = resolve(options.kit);
  requireThat(['.ttf', '.otf'].includes(extname(fontSource).toLowerCase()), 'FONT_EXTENSION');
  const version = await editorVersion(executable);
  const dependencies = await builtinPackages(dirname(executable), options.audio === true);
  const { manifest, manifestSha256, files } = await verifiedKit(kitSource);
  const font = await fileBytes(fontSource), documentBytes = files.get('panel.unity.json').bytes;
  requireThat(documentBytes.length <= 2 * 1024 * 1024, 'KIT_DOCUMENT_LIMIT');
  const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(documentBytes));
  requireThat(document.formatVersion === '0.1' && /^[a-f0-9]{64}$/.test(document.panelSha256) && Array.isArray(document.assets), 'KIT_DOCUMENT_INVALID');
  requireThat(document.panelSha256 === manifest.panelSha256 && document.adapterVersion === manifest.adapterVersion, 'KIT_SOURCE_IDENTITY');
  requireThat(typeof document.panelId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$(?![\s\S])/.test(document.panelId)
    && !document.panelId.endsWith('.') && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(document.panelId), 'KIT_PANEL_FOLDER');
  requireThat(document.assets.length <= 1024, 'KIT_ASSET_LIMIT');
  let expectedDocument;
  try {
    const sourceBundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get('panel.bundle.json').bytes));
    expectedDocument = await createUnityDocument(sourceBundle, await loadWorkspaceCore());
  } catch { throw new Error('UNITY_SOURCE_BUNDLE_INVALID'); }
  // File hashes alone do not prove the native document was lowered from its declared source.
  requireThat(canonicalJson(expectedDocument) === canonicalJson(document), 'UNITY_DOCUMENT_REPLAY');
  const runtimeSources = {};
  for (const name of UNITY_SOURCE_PATHS.filter(name => name.startsWith('Runtime/'))) {
    requireThat(files.has(`Assets/PanelHarness/${name}`), 'KIT_RUNTIME_SOURCE_REQUIRED');
    runtimeSources[name] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(files.get(`Assets/PanelHarness/${name}`).bytes);
  }
  const runtimeIdentity = await createUnityRuntimeIdentity(runtimeSources);
  requireThat(files.has('unity-runtime.json') && canonicalJson(parseNativeJson(files.get('unity-runtime.json').bytes)) === canonicalJson(runtimeIdentity), 'KIT_RUNTIME_IDENTITY');
  let baseline;
  if (options.baseline) {
    const previousDirectory = resolve(options.baseline), rel = relative(harnessRoot, previousDirectory);
    requireThat(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel), 'UNITY_BASELINE_OUTSIDE_HARNESS');
    const validation = parseNativeJson(await readNativeFile(join(previousDirectory, 'unity-validation.json'), 2 * 1024 * 1024));
    const smoke = parseNativeJson(await readNativeFile(join(previousDirectory, 'unity-smoke.json'), 2 * 1024 * 1024));
    const checked = validatePublicationReports(validation, smoke);
    let packageBytes;
    for (const artifact of checked.smoke.artifacts) {
      const bytes = await readNativeFile(join(previousDirectory, artifact.path));
      requireThat(bytes.length === artifact.bytes && hash(bytes) === artifact.sha256, 'UNITY_BASELINE_ARTIFACT_INTEGRITY');
      if (artifact.path === 'panel.unitypackage') packageBytes = bytes;
    }
    baseline = await readManagedUnityPackage(packageBytes, checked.smoke.prefab);
    requireThat(baseline.identity.panelId === document.panelId && baseline.identity.panelSha256 === checked.smoke.panelSha256, 'UNITY_BASELINE_PANEL_ID');
    requireThat(baseline.identity.runtimeSha256 === runtimeIdentity.runtimeSha256, 'UNITY_BASELINE_RUNTIME_VERSION');
    const prefabEvidence = checked.smoke.artifacts.find(artifact => artifact.path === `project/${checked.smoke.prefab}`);
    requireThat(hash(baseline.files.get(checked.smoke.prefab).bytes) === prefabEvidence.sha256, 'UNITY_BASELINE_PREFAB_INTEGRITY');
    baseline.packageSha256 = hash(packageBytes);
  }
  const copiedAssets = [], paths = new Set();
  for (const asset of document.assets) {
    requireThat(/^textures\/[a-f0-9]{64}\.png$/.test(asset.path) && !paths.has(asset.path), 'KIT_ASSET_PATH');
    paths.add(asset.path);
    requireThat(files.has(asset.path), 'KIT_ASSET_NOT_LISTED');
    const bytes = files.get(asset.path).bytes;
    requireThat(bytes.length === asset.bytes && hash(bytes) === asset.sha256 && asset.path === `textures/${asset.sha256}.png`, 'KIT_ASSET_INTEGRITY');
    copiedAssets.push({ path: asset.path, bytes });
  }
  const sources = [...files.values()].filter(file => /^Assets\/PanelHarness\/(?:Runtime|Editor)\/[A-Za-z0-9._/-]+\.(?:cs|asmdef)(?:\.meta)?$/.test(file.path));
  requireThat(sources.some(file => /^Assets\/PanelHarness\/Runtime\/.+\.cs$/.test(file.path)) &&
    sources.some(file => /^Assets\/PanelHarness\/Editor\/.+\.cs$/.test(file.path)), 'ADAPTER_SOURCES_MISSING');
  const smokeSource = await fileBytes(resolve(harnessRoot, 'adapters', 'unity', 'Tests', 'Editor', 'PanelExportSmoke.cs'), 1024 * 1024);
  const output = await createOutputDirectory(options.output), project = join(output, 'project');
  await mkdir(project);
  const projectAsset = path => join(project, 'Assets', 'PanelHarness', path);
  const panelOutput = `Assets/PanelHarness/Panels/${document.panelId}`;
  await mkdir(projectAsset('Panels'), { recursive: true });
  for (const file of sources) await writeBytes(join(project, file.path), file.bytes);
  await writeBytes(join(project, 'Assets', 'Tests', 'Editor', 'PanelExportSmoke.cs'), smokeSource);
  await writeBytes(projectAsset('Kit/panel.unity.json'), documentBytes);
  await writeBytes(projectAsset('Kit/panel.bundle.json'), files.get('panel.bundle.json').bytes);
  await writeBytes(projectAsset('Kit/unity-runtime.json'), files.get('unity-runtime.json').bytes);
  for (const asset of copiedAssets) await writeBytes(projectAsset(`Kit/${asset.path}`), asset.bytes);
  const fontPath = `Assets/PanelHarness/TestFont${extname(fontSource).toLowerCase()}`;
  await writeBytes(join(project, fontPath), font);
  if (baseline) for (const [path, file] of baseline.files) {
    if (!path.startsWith(`${baseline.layout.panelFolder}/`)) continue;
    await writeBytes(join(project, path), file.bytes);
    await writeBytes(join(project, `${path}.meta`), file.meta);
  }
  await writeBytes(join(project, 'Packages', 'manifest.json'), `${JSON.stringify({ dependencies, scopedRegistries: [] }, null, 2)}\n`);
  await writeBytes(join(project, 'ProjectSettings', 'ProjectVersion.txt'),
    `m_EditorVersion: ${version.version}\nm_EditorVersionWithRevision: ${version.version}${version.revision ? ` (${version.revision})` : ''}\n`);
  const report = {
    version: '0.1', status: 'PREPARED', editor: version, mode: options.render ? 'batchmode-render' : 'batchmode-nographics',
    providerCalls: 0, declaredPackages: dependencies, packageSource: 'installed-editor-builtins',
    sourceReplay: 'PASS',
    panelSha256: document.panelSha256, documentSha256: hash(documentBytes), exportManifestSha256: manifestSha256,
    font: { bytes: font.length, sha256: hash(font), use: 'isolated-test-only' }, smokeSourceSha256: hash(smokeSource),
    sources: sources.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: hash(file.bytes) })),
    assets: copiedAssets.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: hash(file.bytes) })),
    project: 'project', visualReview: 'NOT_RUN', smokeReport: 'unity-smoke.json', checks: [], diagnostics: [],
    runtimeIdentity, baseline: baseline ? { status: 'VERIFIED', panelSha256: baseline.identity.panelSha256, revision: baseline.identity.revision,
      prefabGuid: baseline.identity.prefabGuid, packageSha256: baseline.packageSha256 } : null,
  };
  return { executable, output, project, fontPath, panelOutput, baselineSha256: baseline?.identity.panelSha256, render: Boolean(options.render), report };
}

/** The runner never retries. Its child may only open the new isolated project. */
export async function runUnityValidation(prepared, timeoutMs = 15 * 60 * 1000) {
  const { executable, output, project, fontPath, panelOutput, baselineSha256, render, report } = prepared;
  const privateLog = join(output, 'unity-editor.private.log');
  // The smoke runner enters real Play Mode and exits explicitly after its lifecycle checks.
  const args = ['-batchmode', ...(render ? [] : ['-nographics']), '-upmNoDefaultPackages', '-projectPath', project,
    '-logFile', privateLog, '-executeMethod', 'GameUi.PanelHarness.Editor.PanelExportSmoke.Run',
    '--panel-kit', 'Assets/PanelHarness/Kit', '--panel-font', fontPath,
    '--panel-report', '../unity-smoke.json', '--panel-output', panelOutput,
    ...(baselineSha256 ? ['--panel-base-sha', baselineSha256] : []), ...(render ? ['--panel-render'] : [])];
  let timedOut = false;
  let result = { code: null }, launchError;
  try {
    report.status = 'RUNNING';
    result = await new Promise((resolveRun, rejectRun) => {
      const child = spawn(executable, args, { cwd: project, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      child.once('error', error => { clearTimeout(timer); rejectRun(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolveRun({ code, signal }); });
    });
  } catch (error) {
    launchError = error;
  } finally {
    let smoke, smokeReadError;
    try { smoke = await jsonAt(join(output, 'unity-smoke.json')); }
    catch (error) { smokeReadError = error; }
    // A smoke report is machine-generated evidence; preserve partial failure checks as written.
    Object.assign(report, summarizeUnityRun({ exitCode: result.code, timedOut, launchError }, smoke, smokeReadError));
    try { report.diagnostics = safeDiagnostics(await readFile(privateLog, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') report.diagnostics.push('EDITOR_LOG_UNREADABLE'); }
    // Keep only filtered, path-redacted diagnostics; raw host and licensing logs are not artifacts.
    report.cleanup = await cleanupUnityPrivateLog(privateLog);
    report.warnings = report.cleanup.warning ? [report.cleanup.warning] : [];
    await writeNewJson(output, 'unity-validation.json', report);
    await writeBytes(join(output, 'unity-editor.log'), `${report.diagnostics.join('\n')}\n`);
  }
  return report;
}

async function main() {
  const options = {}, args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === '--render') { assert(!options.render, 'DUPLICATE_RENDER'); options.render = true; index -= 1; continue; }
    assert(['--unity', '--font', '--kit', '--output', '--baseline'].includes(args[index]) && args[index + 1] && !options[args[index].slice(2)], 'EXPECTED_UNITY_FONT_KIT_OUTPUT');
    options[args[index].slice(2)] = args[index + 1];
  }
  assert(['unity', 'font', 'kit', 'output'].every(key => options[key]), 'EXPECTED_UNITY_FONT_KIT_OUTPUT');
  const report = await runUnityValidation(await prepareUnityValidation(options));
  process.stdout.write(`${JSON.stringify({ status: report.status, editorVersion: report.editor.version,
    checks: report.checks.length, error: report.error, output: slash(relative(harnessRoot, resolve(options.output))) })}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(ownPath).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', error: /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : (error.code ?? 'UNITY_PREPARATION_FAILED') })}\n`);
    process.exitCode = 1;
  });
}
