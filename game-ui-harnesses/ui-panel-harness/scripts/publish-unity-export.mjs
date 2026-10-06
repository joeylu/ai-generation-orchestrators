#!/usr/bin/env node
/** Publish verified native artifacts only. Never launches Unity or changes prior evidence. */
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { canonicalJson } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createOutputDirectory, harnessRoot, jsonFileBytes, writeNewJson } from '../src/io.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const CODE = /^[A-Za-z][A-Za-z0-9._-]{0,160}$(?![\s\S])/;
const PREFAB = /^project\/Assets\/PanelHarness\/Panels\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,239}\.prefab$(?![\s\S])/;
const RUNTIME_NAMES = ['PanelControlView.cs', 'PanelController.cs', 'PanelDocument.cs', 'PanelRoundedGraphic.cs', 'PanelScrollReveal.cs'];
const COVERAGE = new Set(['sourceNodes', 'textNodes', 'readOnlyControls', 'scrollViews', 'images', 'spriteRegions',
  'currentValuesDifferentFromInitial', 'sliders', 'switches', 'selects', 'buttons', 'disabledControls', 'resetFields', 'preservedResetFields',
  'visibleTextMeshes', 'sliderThumbs', 'tabNavigations', 'tabPages', 'inputFields', 'submitButtons']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (value, code) => { if (!value) throw new Error(code); };
const isSha = value => typeof value === 'string' && SHA.test(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;

/** Inspect the native archive without extracting it or trusting its declared reports. */
export function inspectUnityPackage(bytes, prefabAssetPath, { includeAssets = false } = {}) {
  nativeArtifactKind(`project/${prefabAssetPath}`);
  let tar;
  try { tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }); }
  catch { throw new Error('UNITY_PUBLISH_PACKAGE_FORMAT'); }
  const groups = new Map(), entries = new Set();
  let offset = 0, ended = false;
  const utf8 = body => { try { return new TextDecoder('utf-8', { fatal: true }).decode(body); }
    catch { throw new Error('UNITY_PUBLISH_PACKAGE_TEXT'); } };
  const field = body => utf8(body).split('\0')[0];
  const octal = body => { const value = field(body).trim(); requireThat(/^[0-7]+$/.test(value), 'UNITY_PUBLISH_TAR_NUMBER'); return parseInt(value, 8); };
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      requireThat(tar.length - offset >= 1024 && tar.subarray(offset).every(byte => byte === 0), 'UNITY_PUBLISH_TAR_END');
      ended = true; break;
    }
    requireThat(entries.size < 10000, 'UNITY_PUBLISH_PACKAGE_LIMIT');
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    requireThat(checksum === octal(header.subarray(148, 156)), 'UNITY_PUBLISH_TAR_CHECKSUM');
    const name = field(header.subarray(0, 100)), size = octal(header.subarray(124, 136)), type = header[156];
    requireThat(field(header.subarray(157, 257)) === '' && field(header.subarray(345, 500)) === '', 'UNITY_PUBLISH_TAR_LINK_OR_PREFIX');
    const match = /^([a-f0-9]{32})\/(asset|asset\.meta|pathname|preview\.png)?$(?![\s\S])/.exec(name);
    requireThat(match && !entries.has(name) && (match[2] ? type === 48 || type === 0 : type === 53 && size === 0), 'UNITY_PUBLISH_TAR_ENTRY');
    entries.add(name);
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    requireThat(Number.isSafeInteger(next) && next <= tar.length, 'UNITY_PUBLISH_TAR_TRUNCATED');
    const group = groups.get(match[1]) ?? new Map(); groups.set(match[1], group);
    if (match[2]) group.set(match[2], tar.subarray(offset + 512, offset + 512 + size));
    offset = next;
  }
  requireThat(ended && groups.size > 0, 'UNITY_PUBLISH_PACKAGE_FORMAT');
  const assetRoot = 'Assets/PanelHarness', panelFolder = prefabAssetPath.slice(0, prefabAssetPath.lastIndexOf('/'));
  const runtimePaths = RUNTIME_NAMES.map(name => `${assetRoot}/Runtime/${name}`), paths = new Set();
  for (const group of groups.values()) {
    requireThat(group.has('asset') && group.has('asset.meta') && group.has('pathname') && group.get('pathname').length <= 512, 'UNITY_PUBLISH_PACKAGE_RECORD');
    const raw = utf8(group.get('pathname')), path = raw.endsWith('\0') ? raw.slice(0, -1) : raw;
    requireThat(!paths.has(path.toLowerCase()), 'UNITY_PUBLISH_PACKAGE_DUPLICATE');
    paths.add(path.toLowerCase());
    const local = path.startsWith(`${panelFolder}/`) ? path.slice(panelFolder.length + 1) : '';
    requireThat(runtimePaths.includes(path) || path === prefabAssetPath ||
      /^(?:Fonts\/[a-f0-9]{64}\.(?:otf|ttf)|Textures\/[a-f0-9]{64}\.png|Sprites\/(?:panel-[0-9]+|sprite-[a-f0-9]{64})\.asset|panel-identity\.json)$(?![\s\S])/.test(local), 'UNITY_PUBLISH_PACKAGE_ASSET_ROOT');
  }
  requireThat(paths.has(prefabAssetPath.toLowerCase()) && runtimePaths.every(path => paths.has(path.toLowerCase()))
    && [...paths].some(path => path.startsWith(`${panelFolder.toLowerCase()}/fonts/`)), 'UNITY_PUBLISH_PACKAGE_DEPENDENCIES');
  const layout = { assetRoot, panelFolder, assets: groups.size, paths: [...groups.values()].map(group => {
    const raw = utf8(group.get('pathname')); return raw.endsWith('\0') ? raw.slice(0, -1) : raw;
  }).sort() };
  if (!includeAssets) return layout;
  const files = new Map();
  for (const [guid, group] of groups) {
    const raw = utf8(group.get('pathname')), path = raw.endsWith('\0') ? raw.slice(0, -1) : raw;
    const meta = utf8(group.get('asset.meta'));
    requireThat(new RegExp(`^guid: ${guid}$`, 'm').test(meta.replace(/\r\n/g, '\n')), 'UNITY_PUBLISH_PACKAGE_GUID');
    files.set(path, { bytes: group.get('asset'), meta: group.get('asset.meta'), guid });
  }
  return { layout, files };
}

/** Only exact relative artifact forms are accepted; no absolute/normalized alternative spellings. */
export function nativeArtifactKind(path) {
  if (path === 'panel.unitypackage') return 'package';
  if (path === 'native-panel.png') return 'screenshot';
  if (typeof path === 'string' && PREFAB.test(path)) return 'prefab';
  throw new Error('UNITY_PUBLISH_ARTIFACT_PATH');
}

function passingChecks(checks) {
  requireThat(Array.isArray(checks) && checks.length > 0 && checks.length <= 1024, 'UNITY_PUBLISH_CHECKS_REQUIRED');
  const names = new Set();
  return checks.map(check => {
    requireThat(check && typeof check.name === 'string' && CODE.test(check.name) && !names.has(check.name)
      && check.status === 'PASS', 'UNITY_PUBLISH_CHECK_FAILED');
    names.add(check.name);
    return { name: check.name, status: 'PASS' };
  });
}

function cleanCoverage(value) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'UNITY_PUBLISH_COVERAGE');
  return Object.fromEntries(Object.entries(value).filter(([key]) => COVERAGE.has(key)).map(([key, count]) => {
    requireThat(isCount(count), 'UNITY_PUBLISH_COVERAGE');
    return [key, count];
  }));
}

/** Pure report gate, with allowlisted output fields so host/log data never enters delivery. */
export function validatePublicationReports(validation, smoke) {
  requireThat(validation?.status === 'PASS' && smoke?.status === 'PASS', 'UNITY_PUBLISH_SUCCESS_REQUIRED');
  requireThat(validation.version === '0.1' && validation.exitCode === 0 && validation.providerCalls === 0,
    'UNITY_PUBLISH_VALIDATION_VERSION');
  requireThat(validation.sourceReplay === 'PASS', 'UNITY_PUBLISH_SOURCE_REPLAY_REQUIRED');
  requireThat(isSha(validation.panelSha256) && validation.panelSha256 === smoke.panelSha256, 'UNITY_PUBLISH_PANEL_IDENTITY');
  requireThat(typeof smoke.panelId === 'string' && CODE.test(smoke.panelId), 'UNITY_PUBLISH_PANEL_ID');
  requireThat(smoke.playMode === true && typeof smoke.rendered === 'boolean' && smoke.error === ''
    && smoke.unexpectedErrorLogs === 0 && isCount(smoke.expectedErrorLogs), 'UNITY_PUBLISH_RUNTIME_REQUIRED');
  const checks = passingChecks(validation.checks), smokeChecks = passingChecks(smoke.checks);
  requireThat(validation.smoke?.status === 'PASS' && validation.smoke.playMode === true
    && validation.smoke.rendered === smoke.rendered, 'UNITY_PUBLISH_RUNTIME_SUMMARY');
  requireThat(canonicalJson(checks) === canonicalJson(smokeChecks)
    && canonicalJson(checks) === canonicalJson(passingChecks(validation.smoke.checks)), 'UNITY_PUBLISH_CHECKS_MISMATCH');
  requireThat(['batchmode-render', 'batchmode-nographics'].includes(validation.mode)
    && (smoke.rendered ? validation.mode === 'batchmode-render' : true), 'UNITY_PUBLISH_RUN_MODE');
  requireThat(typeof validation.editor?.version === 'string' && /^6000\.\d+\.\d+[abfp]\d+$(?![\s\S])/.test(validation.editor.version)
    && typeof validation.editor.revision === 'string' && /^(?:[a-f0-9]{1,64})?$(?![\s\S])/.test(validation.editor.revision)
    && isSha(validation.editor.executableSha256), 'UNITY_PUBLISH_EDITOR_EVIDENCE');
  requireThat(isSha(validation.documentSha256) && isSha(validation.exportManifestSha256)
    && isSha(validation.smokeSourceSha256), 'UNITY_PUBLISH_SOURCE_EVIDENCE');
  requireThat(validation.font && isCount(validation.font.bytes) && validation.font.bytes > 0 && isSha(validation.font.sha256), 'UNITY_PUBLISH_FONT_EVIDENCE');
  requireThat(Array.isArray(smoke.artifacts) && smoke.artifacts.length >= 2 && smoke.artifacts.length <= 3, 'UNITY_PUBLISH_ARTIFACTS_REQUIRED');
  const kinds = new Set();
  const artifacts = smoke.artifacts.map(artifact => {
    requireThat(artifact && isSha(artifact.sha256) && isCount(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= MAX_ARTIFACT_BYTES,
      'UNITY_PUBLISH_ARTIFACT_RECORD');
    const kind = nativeArtifactKind(artifact.path);
    requireThat(!kinds.has(kind), 'UNITY_PUBLISH_DUPLICATE_ARTIFACT');
    kinds.add(kind);
    return { path: artifact.path, bytes: artifact.bytes, sha256: artifact.sha256 };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  requireThat(kinds.has('package') && kinds.has('prefab') && kinds.has('screenshot') === smoke.rendered, 'UNITY_PUBLISH_ARTIFACTS_INCOMPLETE');
  requireThat(smoke.package === 'panel.unitypackage' && artifacts.some(artifact => artifact.path === `project/${smoke.prefab}`)
    && (smoke.rendered ? smoke.screenshot === 'native-panel.png' : smoke.screenshot === ''), 'UNITY_PUBLISH_ARTIFACT_REFERENCE');
  const coverage = cleanCoverage(smoke.coverage);
  requireThat(canonicalJson(coverage) === canonicalJson(cleanCoverage(validation.smoke.coverage)), 'UNITY_PUBLISH_COVERAGE_MISMATCH');
  const cleanSmoke = {
    status: 'PASS', panelId: smoke.panelId, panelSha256: smoke.panelSha256, checks: smokeChecks, coverage,
    playMode: true, rendered: smoke.rendered, expectedErrorLogs: smoke.expectedErrorLogs, unexpectedErrorLogs: 0,
    artifacts, prefab: smoke.prefab, package: smoke.package, screenshot: smoke.screenshot,
    humanVisualReview: 'NOT_RUN',
  };
  const cleanValidation = {
    version: '0.1', status: 'PASS', panelSha256: validation.panelSha256, sourceReplay: 'PASS', checks, exitCode: 0,
    editor: { version: validation.editor.version, revision: validation.editor.revision, executableSha256: validation.editor.executableSha256 },
    mode: validation.mode, providerCalls: 0, documentSha256: validation.documentSha256,
    exportManifestSha256: validation.exportManifestSha256, smokeSourceSha256: validation.smokeSourceSha256,
    font: { bytes: validation.font.bytes, sha256: validation.font.sha256, use: 'host-supplied-font' },
    smoke: { status: 'PASS', playMode: true, rendered: smoke.rendered, checks: smokeChecks, coverage },
    visualReview: 'NOT_RUN', diagnosticsOmitted: true,
  };
  return { validation: cleanValidation, smoke: cleanSmoke };
}

async function assertNoLinks(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    requireThat(!(await lstat(current)).isSymbolicLink(), 'UNITY_PUBLISH_INPUT_LINK');
    if (dirname(current) === current) return;
  }
}

async function readVerifiedInput(directory, path, maximum = MAX_JSON_BYTES) {
  requireThat(typeof path === 'string' && /^[A-Za-z0-9._/-]+$(?![\s\S])/.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..'), 'UNITY_PUBLISH_INPUT_PATH');
  const target = join(directory, ...path.split('/'));
  await assertNoLinks(target);
  const info = await lstat(target);
  requireThat(info.isFile() && info.size > 0 && info.size <= maximum, 'UNITY_PUBLISH_INPUT_FILE');
  const bytes = await readFile(target);
  requireThat(bytes.length === info.size, 'UNITY_PUBLISH_INPUT_CHANGED');
  return bytes;
}

const parseJson = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

export async function publishUnityExport({ validation: validationInput, output }) {
  requireThat(typeof validationInput === 'string' && validationInput && typeof output === 'string' && output, 'UNITY_PUBLISH_ARGUMENTS');
  const directory = resolve(validationInput), rel = relative(resolve(harnessRoot), directory);
  requireThat(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'UNITY_PUBLISH_INPUT_OUTSIDE_HARNESS');
  await assertNoLinks(directory);
  requireThat((await lstat(directory)).isDirectory(), 'UNITY_PUBLISH_INPUT_DIRECTORY');
  const [validationBytes, smokeBytes] = await Promise.all([
    readVerifiedInput(directory, 'unity-validation.json'), readVerifiedInput(directory, 'unity-smoke.json'),
  ]);
  const reports = validatePublicationReports(parseJson(validationBytes), parseJson(smokeBytes));
  const contents = new Map();
  let packageLayout;
  for (const artifact of reports.smoke.artifacts) {
    const bytes = await readVerifiedInput(directory, artifact.path, MAX_ARTIFACT_BYTES);
    requireThat(bytes.length === artifact.bytes && hash(bytes) === artifact.sha256, 'UNITY_PUBLISH_ARTIFACT_INTEGRITY');
    const kind = nativeArtifactKind(artifact.path);
    if (kind === 'screenshot') requireThat(bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'UNITY_PUBLISH_SCREENSHOT_FORMAT');
    if (kind === 'package') packageLayout = inspectUnityPackage(bytes, reports.smoke.prefab);
    // A Prefab alone loses its native references; verify it, then deliver the Unity package.
    if (kind !== 'prefab') contents.set(artifact.path, bytes);
  }
  const sourceBytes = await readVerifiedInput(directory, 'project/Assets/PanelHarness/Kit/panel.bundle.json');
  const core = await loadWorkspaceCore();
  const bundle = await validatePanelBundle(parseJson(sourceBytes), core);
  requireThat(bundle.sha256 === reports.smoke.panelSha256 && bundle.spec.id === reports.smoke.panelId, 'UNITY_PUBLISH_SOURCE_IDENTITY');
  const documentBytes = await readVerifiedInput(directory, 'project/Assets/PanelHarness/Kit/panel.unity.json');
  requireThat(hash(documentBytes) === reports.validation.documentSha256, 'UNITY_PUBLISH_DOCUMENT_INTEGRITY');
  const document = parseJson(documentBytes);
  requireThat(document.panelSha256 === bundle.sha256 && document.panelId === bundle.spec.id, 'UNITY_PUBLISH_DOCUMENT_IDENTITY');
  const { readManagedUnityPackage } = await import('./unity-package-evidence.mjs');
  const managed = await readManagedUnityPackage(contents.get('panel.unitypackage'), reports.smoke.prefab);
  requireThat(managed.identity.panelId === bundle.spec.id && managed.identity.panelSha256 === bundle.sha256, 'UNITY_PUBLISH_MANAGED_IDENTITY');
  requireThat(hash(managed.files.get(reports.smoke.prefab).bytes) === reports.smoke.artifacts.find(artifact => nativeArtifactKind(artifact.path) === 'prefab').sha256, 'UNITY_PUBLISH_PACKAGED_PREFAB_INTEGRITY');
  if (managed.identity.revision > 1) {
    const baseline = parseJson(validationBytes).baseline;
    requireThat(baseline?.status === 'VERIFIED' && baseline.panelSha256 === managed.identity.previousPanelSha256
      && baseline.prefabGuid === managed.identity.prefabGuid && baseline.revision + 1 === managed.identity.revision
      && isSha(baseline.packageSha256), 'UNITY_PUBLISH_UPDATE_BASE_REQUIRED');
  }
  contents.set('panel.bundle.json', sourceBytes);
  contents.set('unity-validation.json', jsonFileBytes(reports.validation));
  contents.set('unity-smoke.json', jsonFileBytes(reports.smoke));
  const files = [...contents].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const delivery = {
    unityDeliveryVersion: '0.1', status: 'COMPLETE', target: 'unity-ugui', panelSha256: bundle.sha256,
    editorVersion: reports.validation.editor.version, files,
    packageLayout,
    installation: managed.identity,
    sourceEvidence: { validationReportSha256: hash(validationBytes), smokeReportSha256: hash(smokeBytes),
      prefab: reports.smoke.artifacts.find(artifact => nativeArtifactKind(artifact.path) === 'prefab') },
    verification: { sourceBundle: 'PASS', sourceReplay: 'PASS', artifactIntegrity: 'PASS', unityImport: 'PASS', nativeInteraction: 'PASS',
      packageAssetRoot: 'PASS', managedIdentity: 'PASS', playMode: true, rendering: reports.smoke.rendered ? 'PASS' : 'NOT_RUN', checks: reports.smoke.checks.length,
      humanVisualReview: 'NOT_RUN' },
  };
  // Publication starts only after every bounded input, runtime gate and checksum passed.
  const target = await createOutputDirectory(output);
  for (const [path, bytes] of contents) await writeFile(join(target, path), bytes, { flag: 'wx' });
  await writeNewJson(target, 'delivery.json', delivery);
  return { status: 'UNITY_NATIVE_DELIVERY_PUBLISHED', panelSha256: bundle.sha256, files: files.length + 1,
    unityImport: 'PASS', nativeInteraction: 'PASS', rendering: delivery.verification.rendering, humanVisualReview: 'NOT_RUN' };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    requireThat(['--validation', '--output'].includes(args[index]) && args[index + 1] && !options[args[index].slice(2)], 'UNITY_PUBLISH_ARGUMENTS');
    options[args[index].slice(2)] = args[index + 1];
  }
  requireThat(options.validation && options.output, 'UNITY_PUBLISH_ARGUMENTS');
  process.stdout.write(`${JSON.stringify(await publishUnityExport(options))}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    const code = /^[A-Z][A-Z0-9_]+$(?![\s\S])/.test(error.message) ? error.message
      : /^[A-Z][A-Z0-9_]+$(?![\s\S])/.test(error.code ?? '') ? error.code : 'UNITY_PUBLISH_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code })}\n`);
    process.exitCode = 1;
  });
}
