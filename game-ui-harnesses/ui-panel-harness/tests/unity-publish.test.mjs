import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { core, fixture, catalog, copy } from './helpers.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { createUnityRuntimeIdentity } from '../src/unity-kit.mjs';
import { readUnityAdapterSources } from '../src/unity-export-io.mjs';
import { inspectUnityPackage, nativeArtifactKind, publishUnityExport, validatePublicationReports } from '../scripts/publish-unity-export.mjs';

// All native evidence below is an explicit filesystem test double. No Unity process,
// model call, actual Prefab generation or native acceptance is performed by this suite.
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'unity-publish-tests-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digestFixture = hash(Buffer.from('deterministic-test-evidence'));
const privateFixture = 'omit-this-private-fixture-string';
const bundle = await createPanelBundle(fixture, catalog, core);
const document = await createUnityDocument(bundle, core);
const documentBytes = Buffer.from(`${JSON.stringify(document)}\n`);
const prefabBytes = Buffer.from('TEST DOUBLE ONLY: no native Prefab was generated.\n');
const pngBytes = await readFile(new URL('../examples/custom-assets/panel-surface.png', import.meta.url));
const panelFolder = `Assets/PanelHarness/Panels/${document.panelId}`;
const prefabPath = `project/${panelFolder}/${document.nodes[0].id}.prefab`;
const adapterSources = await readUnityAdapterSources(), runtimeIdentity = await createUnityRuntimeIdentity(adapterSources);
const fontBytes = Buffer.alloc(32, 7), fontSha = hash(fontBytes);
const runtimePaths = ['PanelControlView.cs', 'PanelController.cs', 'PanelDocument.cs', 'PanelRoundedGraphic.cs', 'PanelScrollReveal.cs']
  .map(name => `Assets/PanelHarness/Runtime/${name}`);
const packagePaths = [...runtimePaths, prefabPath.slice('project/'.length), `${panelFolder}/Fonts/${fontSha}.otf`, `${panelFolder}/panel-identity.json`];
const identity = { identityVersion: '0.1', panelId: document.panelId, panelSha256: bundle.sha256, previousPanelSha256: '',
  ...runtimeIdentity, prefabGuid: (6).toString(16).padStart(32, '0'), prefabSha256: hash(prefabBytes), revision: 1 };

// TAR-shaped test doubles exercise archive paths and bounds; their asset bodies are not native assets.
function packageFixture(paths = packagePaths) {
  const blocks = [];
  const entry = (name, body) => {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'ascii'); header.write('0000644\0', 100, 8, 'ascii');
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.fill(32, 148, 156); header[156] = 48;
    header.write('ustar\0', 257, 6, 'ascii');
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  };
  paths.forEach((path, index) => {
    const guid = (index + 1).toString(16).padStart(32, '0');
    let body = prefabBytes;
    if (runtimePaths.includes(path)) body = Buffer.from(adapterSources[path.slice('Assets/PanelHarness/'.length)]);
    if (path === `${panelFolder}/Fonts/${fontSha}.otf`) body = fontBytes;
    if (path === `${panelFolder}/panel-identity.json`) body = Buffer.from(JSON.stringify(identity));
    entry(`${guid}/asset`, body); entry(`${guid}/asset.meta`, Buffer.from(`fileFormatVersion: 2\nguid: ${guid}\n`));
    entry(`${guid}/pathname`, Buffer.from(path + '\0'));
  });
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
const packageBytes = packageFixture();
const artifact = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes) });
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const noOutput = async output => assert.rejects(stat(output), { code: 'ENOENT' });

function reportFixture(rendered = true) {
  const checks = [{ name: 'filesystem-native-test-double', status: 'PASS' }];
  const coverage = { sourceNodes: document.nodes.length, visibleTextMeshes: rendered ? 4 : 0, sliderThumbs: 1 };
  const smoke = {
    status: 'PASS', panelId: bundle.spec.id, panelSha256: bundle.sha256, checks: copy(checks), coverage,
    playMode: true, rendered, error: '', expectedErrorLogs: 1, unexpectedErrorLogs: 0,
    artifacts: [artifact('panel.unitypackage', packageBytes), artifact(prefabPath, prefabBytes),
      ...(rendered ? [artifact('native-panel.png', pngBytes)] : [])],
    prefab: prefabPath.slice('project/'.length), package: 'panel.unitypackage', screenshot: rendered ? 'native-panel.png' : '',
    unexpectedLogMessages: [privateFixture], unexpectedLogDetails: [{ message: privateFixture }],
    ignoredHostData: privateFixture,
  };
  const validation = {
    version: '0.1', status: 'PASS', sourceReplay: 'PASS', exitCode: 0, providerCalls: 0,
    panelSha256: bundle.sha256, checks: copy(checks),
    smoke: { status: 'PASS', checks: copy(checks), playMode: true, rendered, coverage: copy(coverage) },
    mode: rendered ? 'batchmode-render' : 'batchmode-nographics',
    editor: { version: '6000.3.7f1', revision: 'abc123', executableSha256: digestFixture },
    documentSha256: hash(documentBytes), exportManifestSha256: digestFixture, smokeSourceSha256: digestFixture,
    font: { bytes: fontBytes.length, sha256: fontSha, source: privateFixture }, diagnostics: [privateFixture],
    ignoredHostData: privateFixture,
  };
  return { validation, smoke };
}

async function writeBytes(directory, path, bytes) {
  const target = join(directory, ...path.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function writeReports(directory, reports) {
  await writeBytes(directory, 'unity-validation.json', JSON.stringify(reports.validation));
  await writeBytes(directory, 'unity-smoke.json', JSON.stringify(reports.smoke));
}

async function filesystemFixture(rendered = true) {
  const directory = await mkdtemp(join(work, 'validation-')), reports = reportFixture(rendered);
  await writeReports(directory, reports);
  await writeBytes(directory, 'panel.unitypackage', packageBytes);
  await writeBytes(directory, prefabPath, prefabBytes);
  if (rendered) await writeBytes(directory, 'native-panel.png', pngBytes);
  await writeBytes(directory, 'project/Assets/PanelHarness/Kit/panel.bundle.json', JSON.stringify(bundle));
  await writeBytes(directory, 'project/Assets/PanelHarness/Kit/panel.unity.json', documentBytes);
  const output = join(directory, 'published');
  return { directory, output, ...reports };
}

test('report sanitization retains source replay and visual regression coverage without private fields', () => {
  const source = reportFixture(), before = copy(source);
  const checked = validatePublicationReports(source.validation, source.smoke);
  assert.deepEqual(source, before);
  assert.equal(checked.validation.sourceReplay, 'PASS');
  assert.equal(checked.smoke.coverage.visibleTextMeshes, 4);
  assert.equal(checked.smoke.coverage.sliderThumbs, 1);
  assert.equal(checked.smoke.humanVisualReview, 'NOT_RUN');
  assert.equal(checked.validation.visualReview, 'NOT_RUN');
  assert(!JSON.stringify(checked).includes(privateFixture));
});

test('report gates reject failed, missing, inconsistent or non-runtime evidence', () => {
  const cases = [
    ['failed validation', r => { r.validation.status = 'FAIL'; }],
    ['failed smoke', r => { r.smoke.status = 'FAIL'; }],
    ['missing source replay', r => { delete r.validation.sourceReplay; }],
    ['failed source replay', r => { r.validation.sourceReplay = 'FAIL'; }],
    ['nonzero exit', r => { r.validation.exitCode = 1; }],
    ['provider call', r => { r.validation.providerCalls = 1; }],
    ['empty checks', r => { r.validation.checks = []; }],
    ['failed check', r => { r.smoke.checks[0].status = 'FAIL'; }],
    ['duplicate check', r => { r.smoke.checks.push(copy(r.smoke.checks[0])); }],
    ['different checks', r => { r.validation.checks[0].name = 'different'; }],
    ['different panel', r => { r.smoke.panelSha256 = digestFixture; }],
    ['no play mode', r => { r.smoke.playMode = false; }],
    ['no summary play mode', r => { r.validation.smoke.playMode = false; }],
    ['unexpected runtime errors', r => { r.smoke.unexpectedErrorLogs = 1; }],
    ['different coverage', r => { r.validation.smoke.coverage.visibleTextMeshes++; }],
    ['missing screenshot', r => { r.smoke.artifacts.pop(); }],
    ['missing prefab', r => { r.smoke.artifacts = r.smoke.artifacts.filter(a => nativeArtifactKind(a.path) !== 'prefab'); }],
    ['missing package', r => { r.smoke.artifacts = r.smoke.artifacts.filter(a => a.path !== 'panel.unitypackage'); }],
    ['duplicate artifact', r => { r.smoke.artifacts[2] = copy(r.smoke.artifacts[0]); }],
    ['nonpositive bytes', r => { r.smoke.artifacts[0].bytes = 0; }],
    ['malformed hash', r => { r.smoke.artifacts[0].sha256 = 'invalid'; }],
  ];
  for (const [name, mutate] of cases) {
    const reports = reportFixture(); mutate(reports);
    assert.throws(() => validatePublicationReports(reports.validation, reports.smoke), undefined, name);
  }
});

test('artifact path allowlist rejects traversal, absolute paths, extra subfolders and line endings', () => {
  assert.equal(nativeArtifactKind('panel.unitypackage'), 'package');
  assert.equal(nativeArtifactKind('native-panel.png'), 'screenshot');
  assert.equal(nativeArtifactKind(prefabPath), 'prefab');
  for (const path of ['../panel.unitypackage', '/panel.unitypackage', 'C:/panel.unitypackage',
    `project/${panelFolder}/../a.prefab`, `project/${panelFolder}/sub/a.prefab`, 'project/Assets/Generated/a.prefab',
    'project\\Assets\\Generated\\a.prefab', `${prefabPath}\n`, 'native-panel.png/x', 'unity-editor.log']) {
    assert.throws(() => nativeArtifactKind(path), /UNITY_PUBLISH_ARTIFACT_PATH/, path);
  }
});

test('native package inspection requires a single adapter root and panel-local dependencies', () => {
  const layout = inspectUnityPackage(packageBytes, prefabPath.slice('project/'.length));
  assert.equal(layout.assetRoot, 'Assets/PanelHarness'); assert.equal(layout.panelFolder, panelFolder);
  assert.equal(layout.assets, 8); assert.deepEqual(layout.paths, [...packagePaths].sort());
  for (const unsafe of ['Assets/Generated/a.prefab', 'Assets/Fonts/font.otf', 'Assets/PanelHarness/TestFont.otf',
    'Assets/PanelHarness/Editor/PanelPrefabBuilder.cs', `${panelFolder}/Smoke.unity`,
    `${panelFolder}/../font.otf`, `${panelFolder}/Fonts/a.otf`, `${panelFolder}/Fonts/a.otf\n`,
    `Assets/PanelHarness/Panels/another/Fonts/${digestFixture}.otf`, '/Assets/PanelHarness/Runtime/A.cs'])
    assert.throws(() => inspectUnityPackage(packageFixture([...packagePaths, unsafe]), prefabPath.slice('project/'.length)),
      /UNITY_PUBLISH_PACKAGE_ASSET_ROOT/, unsafe);
  assert.throws(() => inspectUnityPackage(packageFixture(packagePaths.slice(1)), prefabPath.slice('project/'.length)), /UNITY_PUBLISH_PACKAGE_DEPENDENCIES/);
  assert.throws(() => inspectUnityPackage(packageFixture([...packagePaths, runtimePaths[0]]), prefabPath.slice('project/'.length)), /UNITY_PUBLISH_PACKAGE_DUPLICATE/);
});

test('native package inspection rejects malformed gzip, checksums and truncated TAR', () => {
  assert.throws(() => inspectUnityPackage(Buffer.from('not gzip'), prefabPath.slice('project/'.length)), /UNITY_PUBLISH_PACKAGE_FORMAT/);
  const bad = gunzipSync(packageBytes); bad[10] ^= 1;
  assert.throws(() => inspectUnityPackage(gzipSync(bad), prefabPath.slice('project/'.length)), /UNITY_PUBLISH_TAR_CHECKSUM/);
  assert.throws(() => inspectUnityPackage(gzipSync(gunzipSync(packageBytes).subarray(0, 600)), prefabPath.slice('project/'.length)), /UNITY_PUBLISH_TAR_TRUNCATED/);
  assert.throws(() => inspectUnityPackage(gzipSync(Buffer.from('not TAR')), prefabPath.slice('project/'.length)), /UNITY_PUBLISH_PACKAGE_FORMAT/);
});

test('PASS publication is deterministic, whitelisted, checksummed and keeps Prefab as evidence only', async () => {
  const source = await filesystemFixture();
  const originalValidation = await readFile(join(source.directory, 'unity-validation.json'));
  const originalSmoke = await readFile(join(source.directory, 'unity-smoke.json'));
  const result = await publishUnityExport({ validation: source.directory, output: source.output });
  assert.equal(result.status, 'UNITY_NATIVE_DELIVERY_PUBLISHED');
  assert.equal(result.files, 6); assert.equal(result.humanVisualReview, 'NOT_RUN');
  const expected = ['delivery.json', 'native-panel.png', 'panel.bundle.json', 'panel.unitypackage', 'unity-smoke.json', 'unity-validation.json'];
  assert.deepEqual((await readdir(source.output)).sort(), expected);
  const delivery = await json(join(source.output, 'delivery.json'));
  assert.equal(delivery.panelSha256, bundle.sha256);
  assert.equal(delivery.verification.sourceReplay, 'PASS');
  assert.equal(delivery.verification.packageAssetRoot, 'PASS');
  assert.equal(delivery.verification.managedIdentity, 'PASS');
  assert.deepEqual(delivery.installation, identity);
  assert.deepEqual(delivery.packageLayout, inspectUnityPackage(packageBytes, prefabPath.slice('project/'.length)));
  assert.equal(delivery.verification.rendering, 'PASS');
  assert.equal(delivery.verification.humanVisualReview, 'NOT_RUN');
  assert.equal(delivery.sourceEvidence.validationReportSha256, hash(originalValidation));
  assert.equal(delivery.sourceEvidence.smokeReportSha256, hash(originalSmoke));
  assert.deepEqual(delivery.sourceEvidence.prefab, artifact(prefabPath, prefabBytes));
  assert.equal(delivery.files.length, 5);
  for (const file of delivery.files) {
    const bytes = await readFile(join(source.output, file.path));
    assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256);
    if (file.path.endsWith('.json')) assert(!bytes.toString('utf8').includes(privateFixture));
  }
  assert.deepEqual(await readFile(join(source.output, 'panel.unitypackage')), packageBytes);
  assert.deepEqual(await json(join(source.output, 'panel.bundle.json')), bundle);
  assert.equal((await json(join(source.output, 'unity-smoke.json'))).coverage.visibleTextMeshes, 4);
  assert.deepEqual(await readFile(join(source.directory, 'unity-validation.json')), originalValidation);
  assert.deepEqual(await readFile(join(source.directory, 'unity-smoke.json')), originalSmoke);
  const second = join(source.directory, 'published-again');
  await publishUnityExport({ validation: source.directory, output: second });
  for (const name of expected) assert.deepEqual(await readFile(join(second, name)), await readFile(join(source.output, name)));
  await assert.rejects(publishUnityExport({ validation: source.directory, output: source.output }), /OUTPUT_EXISTS/);
  assert.deepEqual(await readFile(join(source.output, 'panel.unitypackage')), packageBytes);
});

test('publication rejects a package with an outside asset despite matching PASS reports and hashes', async () => {
  const source = await filesystemFixture();
  const unsafeBytes = packageFixture([...packagePaths, 'Assets/Generated/unexpected.png']);
  source.smoke.artifacts[0] = artifact('panel.unitypackage', unsafeBytes);
  await writeReports(source.directory, source);
  await writeBytes(source.directory, 'panel.unitypackage', unsafeBytes);
  await assert.rejects(publishUnityExport({ validation: source.directory, output: source.output }), /UNITY_PUBLISH_PACKAGE_ASSET_ROOT/);
  await noOutput(source.output);
});

test('non-rendered acceptance publishes no screenshot and does not claim rendering passed', async () => {
  const source = await filesystemFixture(false);
  const result = await publishUnityExport({ validation: source.directory, output: source.output });
  assert.equal(result.files, 5); assert.equal(result.rendering, 'NOT_RUN');
  await assert.rejects(stat(join(source.output, 'native-panel.png')), { code: 'ENOENT' });
  const report = await json(join(source.output, 'unity-smoke.json'));
  assert.equal(report.rendered, false); assert.equal(report.coverage.visibleTextMeshes, 0);
});

test('failed reports and absent source replay are rejected before any publication directory exists', async () => {
  for (const key of ['failed-validation', 'failed-smoke', 'sourceReplay']) {
    const source = await filesystemFixture();
    if (key === 'failed-validation') source.validation.status = 'FAIL';
    else if (key === 'failed-smoke') source.smoke.status = 'FAIL';
    else delete source.validation.sourceReplay;
    await writeReports(source.directory, source);
    await assert.rejects(publishUnityExport({ validation: source.directory, output: source.output }), /UNITY_PUBLISH_(SUCCESS|SOURCE_REPLAY)_REQUIRED/);
    await noOutput(source.output);
  }
});

test('every native artifact is rehashed, including the Prefab that is not copied', async () => {
  for (const path of ['panel.unitypackage', 'native-panel.png', prefabPath]) {
    const source = await filesystemFixture();
    const bytes = await readFile(join(source.directory, path));
    bytes[bytes.length - 1] ^= 1;
    await writeBytes(source.directory, path, bytes);
    await assert.rejects(publishUnityExport({ validation: source.directory, output: source.output }), /UNITY_PUBLISH_ARTIFACT_INTEGRITY/);
    await noOutput(source.output);
  }
  const source = await filesystemFixture();
  source.smoke.artifacts[0].sha256 = digestFixture;
  await writeReports(source.directory, source);
  await assert.rejects(publishUnityExport({ validation: source.directory, output: source.output }), /UNITY_PUBLISH_ARTIFACT_INTEGRITY/);
  await noOutput(source.output);
});

test('source Bundle tampering and stale normalized document bytes cannot inherit a PASS report', async () => {
  const forged = await filesystemFixture(), altered = copy(bundle);
  altered.spec.title = 'Tampered source';
  await writeBytes(forged.directory, 'project/Assets/PanelHarness/Kit/panel.bundle.json', JSON.stringify(altered));
  await assert.rejects(publishUnityExport({ validation: forged.directory, output: forged.output }));
  await noOutput(forged.output);
  const stale = await filesystemFixture();
  await writeBytes(stale.directory, 'project/Assets/PanelHarness/Kit/panel.unity.json', `${documentBytes.toString('utf8')} `);
  await assert.rejects(publishUnityExport({ validation: stale.directory, output: stale.output }), /UNITY_PUBLISH_DOCUMENT_INTEGRITY/);
  await noOutput(stale.output);
});

test('artifact traversal and cross-Harness input/output paths fail without new output', async () => {
  const source = await filesystemFixture();
  source.smoke.artifacts[0].path = '../panel.unitypackage';
  await writeReports(source.directory, source);
  await assert.rejects(publishUnityExport({ validation: source.directory, output: source.output }), /UNITY_PUBLISH_ARTIFACT_PATH/);
  await noOutput(source.output);
  await assert.rejects(publishUnityExport({ validation: resolve(root, '..'), output: source.output }), /UNITY_PUBLISH_INPUT_OUTSIDE_HARNESS/);
  await noOutput(source.output);
  const valid = await filesystemFixture();
  const outsideOutput = resolve(root, '..', 'must-not-publish-unity-test');
  await assert.rejects(publishUnityExport({ validation: valid.directory, output: outsideOutput }), /OUTPUT_OUTSIDE_HARNESS/);
  await noOutput(outsideOutput);
});

test('linked validation directories are rejected before reading source evidence', async t => {
  const source = await filesystemFixture(), link = join(work, `linked-${Date.now()}`);
  try { await symlink(source.directory, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Filesystem does not permit test directory links.'); return; }
    throw error;
  }
  await assert.rejects(publishUnityExport({ validation: link, output: source.output }), /UNITY_PUBLISH_INPUT_LINK/);
  await noOutput(source.output);
});
