import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareUnityValidation, sanitizeUnityDiagnostic, summarizeUnityRun, cleanupUnityPrivateLog } from '../scripts/check-unity-export.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { createUnityDocument, UNITY_ADAPTER_VERSION } from '../src/unity-export.mjs';
import { createUnityRuntimeIdentity } from '../src/unity-kit.mjs';
import { readUnityAdapterSources } from '../src/unity-export-io.mjs';
import { canonicalJson } from '../src/canonical.mjs';
import { core, fixture, catalog } from './helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'unity-validation-'));
const editor = join(work, 'fixture-editor'), executable = join(editor, 'Unity.exe'), font = join(work, 'fixture.otf');
await mkdir(editor);
// Only the version-resource reader consumes these fixture bytes. No executable is launched.
await writeFile(executable, Buffer.concat([Buffer.from('MZ'), Buffer.from(
  ['ProductVersion', '', '6000.0.0f1_abcdef12', ''].join('\0'), 'utf16le')]));
await writeFile(font, 'test fixture; never imported or rendered');
const packageNames = ['com.unity.ugui', ...['ui', 'imgui', 'uielements', 'physics', 'jsonserialize', 'imageconversion', 'animation']
  .map(name => `com.unity.modules.${name}`)];
for (const name of [...packageNames, 'com.unity.modules.audio']) {
  const directory = join(editor, 'Data', 'Resources', 'PackageManager', 'BuiltInPackages', name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name,
    version: name === 'com.unity.ugui' ? '2.0.0' : '1.0.0', dependencies: {} }));
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixtureKit() {
  const kit = await mkdtemp(join(work, 'kit-'));
  const contents = [['panel.unity.json', '{}'], ['panel.bundle.json', '{}'], ['README.md', 'fixture']];
  for (const [name, data] of contents) await writeFile(join(kit, name), data);
  return { kit, manifest: {
    unityExportVersion: '0.1', adapterVersion: UNITY_ADAPTER_VERSION, status: 'COMPLETE', target: 'unity-ugui',
    panelSha256: 'a'.repeat(64), verification: { sourceBundle: 'PASS' },
    files: contents.map(([path, text]) => ({ path, bytes: Buffer.byteLength(text), sha256: digest(text) })),
  } };
}

for (const [name, mutate, expected] of [
  ['incomplete manifest', manifest => { manifest.status = 'PASS'; }, 'KIT_MANIFEST_INVALID'],
  ['path traversal', manifest => { manifest.files[0].path = '../escape'; }, 'KIT_MANIFEST_PATH'],
  ['duplicate files', manifest => { manifest.files.push(manifest.files[0]); }, 'KIT_MANIFEST_PATH'],
  ['tampered content hash', manifest => { manifest.files[0].sha256 = '0'.repeat(64); }, 'KIT_MANIFEST_INTEGRITY'],
  ['tampered byte count', manifest => { manifest.files[0].bytes += 1; }, 'KIT_MANIFEST_INTEGRITY'],
  ['invalid import document', () => {}, 'KIT_DOCUMENT_INVALID'],
]) test(`Unity validation refuses ${name} before creating an isolated project`, async () => {
  const { kit, manifest } = await fixtureKit(), output = join(kit, 'unused-output');
  mutate(manifest);
  await writeFile(join(kit, 'export-manifest.json'), JSON.stringify(manifest));
  await assert.rejects(prepareUnityValidation({ unity: executable, font, kit, output }), error => error.message === expected);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

async function replayKit(mutateDocument = () => {}, mutateBundle = () => {}) {
  const kit = await mkdtemp(join(work, 'replay-kit-'));
  const original = await createPanelBundle(fixture, catalog, core), document = await createUnityDocument(original, core);
  const bundle = structuredClone(original);
  mutateDocument(document); mutateBundle(bundle);
  const adapterSources = await readUnityAdapterSources();
  const contents = [
    ['panel.unity.json', canonicalJson(document)], ['panel.bundle.json', canonicalJson(bundle)],
    ['unity-runtime.json', canonicalJson(await createUnityRuntimeIdentity(adapterSources))],
    ...Object.entries(adapterSources).map(([name, text]) => [`Assets/PanelHarness/${name}`, text]),
  ];
  for (const [name, text] of contents) {
    await mkdir(dirname(join(kit, name)), { recursive: true }); await writeFile(join(kit, name), text);
  }
  // All attacker-modified bytes deliberately receive fresh hashes, reproducing a self-consistent forged kit.
  const manifest = { unityExportVersion: '0.1', adapterVersion: UNITY_ADAPTER_VERSION, status: 'COMPLETE', target: 'unity-ugui',
    panelSha256: document.panelSha256, verification: { sourceBundle: 'PASS' },
    files: contents.map(([path, text]) => ({ path, bytes: Buffer.byteLength(text), sha256: digest(text) })),
  };
  await writeFile(join(kit, 'export-manifest.json'), canonicalJson(manifest));
  return { kit, output: join(kit, 'isolated-output') };
}

test('Unity preparation rejects a rehashed native document that differs from verified source lowering', async () => {
  const { kit, output } = await replayKit(document => { document.nodes[0].x += 1; });
  await assert.rejects(prepareUnityValidation({ unity: executable, font, kit, output }), /UNITY_DOCUMENT_REPLAY/);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

test('Unity preparation validates the source bundle even when every kit file hash matches', async () => {
  const { kit, output } = await replayKit(undefined, bundle => { bundle.componentBundle.document.root.children[0].layout.x += 1; });
  await assert.rejects(prepareUnityValidation({ unity: executable, font, kit, output }), /UNITY_SOURCE_BUNDLE_INVALID/);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

test('Unity preparation rejects unsafe panel folder IDs before creating the isolated project', async () => {
  for (const id of ['CON', 'nul.txt', 'trailing.', '../escape', 'panel\\escape', 'x'.repeat(129)]) {
    const { kit, output } = await replayKit(document => { document.panelId = id; });
    await assert.rejects(prepareUnityValidation({ unity: executable, font, kit, output }), /KIT_PANEL_FOLDER/, id);
    await assert.rejects(lstat(output), { code: 'ENOENT' });
  }
});

test('Unity preparation records source replay only after an exact deterministic lowering match', async () => {
  const { kit, output } = await replayKit();
  const prepared = await prepareUnityValidation({ unity: executable, font, kit, output });
  assert.equal(prepared.report.sourceReplay, 'PASS'); assert.equal(prepared.report.status, 'PREPARED');
  assert.equal(prepared.report.providerCalls, 0);
  assert((await lstat(join(prepared.project, 'Assets/PanelHarness/Runtime/PanelController.cs'))).isFile());
  const nativeDocument = JSON.parse(await readFile(join(kit, 'panel.unity.json'), 'utf8'));
  assert.equal(prepared.panelOutput, `Assets/PanelHarness/Panels/${nativeDocument.panelId}`);
  assert((await lstat(join(prepared.project, 'Assets/PanelHarness/Panels'))).isDirectory());
  await assert.rejects(lstat(join(prepared.project, 'Assets/Generated')), { code: 'ENOENT' });
});

test('audio acceptance opts into installed builtin AudioModule without changing standard panel dependencies', async () => {
  const standard = await replayKit(), audio = await replayKit();
  const ordinary = await prepareUnityValidation({ unity: executable, font, ...standard });
  const extra = await prepareUnityValidation({ unity: executable, font, ...audio, audio: true });
  assert.equal(ordinary.report.declaredPackages['com.unity.modules.audio'], undefined);
  assert.equal(extra.report.declaredPackages['com.unity.modules.audio'], '1.0.0');
  const manifest = JSON.parse(await readFile(join(extra.project, 'Packages/manifest.json'), 'utf8'));
  assert.equal(manifest.dependencies['com.unity.modules.audio'], '1.0.0');
  assert.deepEqual(manifest.scopedRegistries, []);
});

test('Unity diagnostic redaction removes local paths, URLs, email, license channels and IPv4/IPv6 hosts', () => {
  const values = [
    ['Error: X:\\fixture-private\\source.cs', /fixture-private|source\.cs/],
    ['Error: X:/fixture-private/source.cs', /fixture-private|source\.cs/],
    ['Error: https://example.invalid/path?token=fixture', /example\.invalid|token/],
    ['Error: fixture@example.invalid', /fixture@/],
    ['Error: handshake "LicenseClient-fixture-user-6000.0.0"', /fixture-user|LicenseClient-/],
    ['Error: host 192.0.2.42:8080', /192\.0\.2\.42|8080/],
    ['Error: host [2001:db8::42]:443', /2001:db8|443/],
    ['Error: host fe80::1%12', /fe80::|%12/],
    ['Error: host ::ffff:192.0.2.42', /::ffff|192\.0\.2/],
  ];
  for (const [raw, sensitive] of values) assert.doesNotMatch(sanitizeUnityDiagnostic(raw), sensitive);
  const compilation = 'Assets/PanelHarness/Runtime/Panel.cs(12): error CS0100';
  assert.equal(sanitizeUnityDiagnostic(compilation), compilation, 'Keep useful relative source locations and compiler codes');
});

const failedSmoke = () => ({ status: 'FAIL', error: 'PANEL_SMOKE_stable-node-id-unique',
  checks: [{ name: 'native-prefab-saved-and-loaded', status: 'PASS' }, { name: 'prefab-has-no-missing-scripts', status: 'PASS' }],
  playMode: false, rendered: false, coverage: { sourceNodes: 0 } });
const passedSmoke = () => ({ status: 'PASS', checks: [{ name: 'prefab-loaded', status: 'PASS' }] });

test('a nonzero Unity exit preserves the primary smoke error, failed stage and partial evidence', () => {
  const smoke = failedSmoke(), original = structuredClone(smoke), result = summarizeUnityRun({ exitCode: 1 }, smoke);
  assert.equal(result.status, 'FAIL'); assert.equal(result.exitCode, 1);
  assert.equal(result.primaryError, 'PANEL_SMOKE_stable-node-id-unique'); assert.equal(result.error, result.primaryError);
  assert.equal(result.failedStage, 'stable-node-id-unique'); assert.equal(result.smoke.failedStage, result.failedStage);
  assert.deepEqual(result.checks, smoke.checks); assert.deepEqual(result.smoke.coverage, smoke.coverage);
  assert.equal(result.smoke.playMode, false); assert.equal(result.smoke.rendered, false);
  assert.deepEqual(smoke, original, 'Aggregation must not repair the original evidence');
});

test('Unity outcome precedence distinguishes pass, abnormal exit, timeout, launch errors and invalid evidence', () => {
  assert.equal(summarizeUnityRun({ exitCode: 0 }, passedSmoke()).status, 'PASS');
  assert.equal(summarizeUnityRun({ exitCode: 1 }, passedSmoke()).primaryError, 'UNITY_EXIT_FAILURE');
  const timeout = summarizeUnityRun({ exitCode: null, timedOut: true }, failedSmoke());
  assert.equal(timeout.status, 'TIMEOUT'); assert.equal(timeout.primaryError, 'UNITY_TIMEOUT');
  assert.equal(timeout.failedStage, 'stable-node-id-unique', 'Partial evidence survives a later process timeout');
  assert.equal(summarizeUnityRun({ exitCode: null, launchError: { code: 'EACCES' } }, failedSmoke()).primaryError, 'EACCES');
  assert.equal(summarizeUnityRun({ exitCode: 0 }, undefined, { code: 'ENOENT' }).error, 'UNITY_SMOKE_REPORT_MISSING');
  assert.equal(summarizeUnityRun({ exitCode: 1 }, undefined, { code: 'ENOENT' }).error, 'UNITY_EXIT_FAILURE');
  const leaked = summarizeUnityRun({ exitCode: 0 }, { ...passedSmoke(), privatePath: 'X:/fixture-private/source.cs' });
  assert.equal(leaked.error, 'UNITY_SMOKE_REPORT_INVALID'); assert.doesNotMatch(JSON.stringify(leaked), /fixture-private/);
  assert.equal(summarizeUnityRun({ exitCode: 0 }, { status: 'PASS', checks: [] }).error, 'UNITY_SMOKE_FAILURE');
});

test('transient Unity log locks retry only the file removal with bounded backoff', async () => {
  let removeCalls = 0;
  const waits = [], result = await cleanupUnityPrivateLog('fixture-only', {
    remove: async () => { if (++removeCalls < 3) throw Object.assign(new Error('fixture lock'), { code: 'EBUSY' }); },
    sleep: async milliseconds => { waits.push(milliseconds); },
  });
  assert.deepEqual(result, { status: 'REMOVED', attempts: 3 }); assert.equal(removeCalls, 3);
  assert.deepEqual(waits, [100, 250]);
});

test('persistent Unity log locks become independent warnings without replacing the primary failure', async () => {
  let removeCalls = 0;
  const waits = [], cleanup = await cleanupUnityPrivateLog('fixture-only', {
    remove: async () => { removeCalls += 1; throw Object.assign(new Error('fixture lock'), { code: 'EPERM' }); },
    sleep: async milliseconds => { waits.push(milliseconds); },
  });
  assert.deepEqual(cleanup, { status: 'RETAINED', attempts: 6, warning: 'RAW_LOG_CLEANUP_FAILED', code: 'EPERM' });
  assert.equal(removeCalls, 6); assert.deepEqual(waits, [100, 250, 500, 1000, 2000]);
  const report = { ...summarizeUnityRun({ exitCode: 1 }, failedSmoke()), cleanup, warnings: [cleanup.warning] };
  assert.equal(report.primaryError, 'PANEL_SMOKE_stable-node-id-unique'); assert.equal(report.error, report.primaryError);
  assert.equal(report.failedStage, 'stable-node-id-unique'); assert.equal(report.status, 'FAIL');
});

test('an already absent Unity log requires neither retries nor a warning', async () => {
  const result = await cleanupUnityPrivateLog('fixture-only', {
    remove: async () => { throw Object.assign(new Error('fixture absent'), { code: 'ENOENT' }); },
    sleep: async () => { assert.fail('Missing files do not need retries'); },
  });
  assert.deepEqual(result, { status: 'ABSENT', attempts: 1 });
});
