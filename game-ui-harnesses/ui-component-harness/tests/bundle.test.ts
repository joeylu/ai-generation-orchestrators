import test from 'node:test';
import assert from 'node:assert/strict';
import { BundleError, bundleResources, createBundle, MAX_BUNDLE_RESOURCE_BYTES, validateBundle } from '../src/bundle.ts';
import { fixtureDocument, fixtureInputs } from '../src/fixtures.ts';

function legacyDocument(source = './assets/go.png') {
  return {
    schemaVersion: '0.1' as const, id: 'go', type: 'Button' as const,
    layout: { x: 0, y: 0, width: 12, height: 8 }, props: { enabled: true },
    slots: { visual: { id: 'go-image', type: 'Image' as const, props: { source } } },
  };
}
const provenance = { kind: 'programmatic-fixture' as const, description: 'Unit-test byte fixture; no model or provider was used.' };
const bytes = new Uint8Array([0, 1, 2, 3, 254, 255]);

test('v0.1 bundle embeds verified bytes and materializes fresh bytes after validation', async () => {
  const bundle = await createBundle(legacyDocument(), [{ path: 'assets/go.png', mime: 'image/png', bytes }], provenance);
  assert.equal(bundle.bundleVersion, '0.1');
  assert.equal(bundle.resources[0].path, 'assets/go.png');
  assert.equal(bundle.resources[0].id, 'assets/go.png');
  assert.equal(bundle.resources[0].base64, 'AAECA/7/');
  const reloaded = await validateBundle(JSON.parse(JSON.stringify(bundle)));
  const materialized = bundleResources(reloaded);
  assert.deepEqual([...materialized[0].bytes], [...bytes]);
  materialized[0].bytes[0] = 99;
  assert.equal(bundleResources(reloaded)[0].bytes[0], 0);
  const unvalidated = JSON.parse(JSON.stringify(bundle)) as Parameters<typeof bundleResources>[0];
  assert.throws(() => bundleResources(unvalidated), BundleError);
});

test('verified bundles are immutable and reject oversized Base64 before decoding', async () => {
  const bundle = await createBundle(legacyDocument(), [{ path: 'assets/go.png', mime: 'image/png', bytes }], provenance);
  assert.throws(() => { bundle.resources[0].base64 = 'AQID'; }, TypeError);
  assert.deepEqual([...bundleResources(bundle)[0].bytes], [...bytes]);
  const oversized = {
    bundleVersion: '0.1', document: legacyDocument(), provenance,
    resources: [{ id: 'assets/go.png', path: 'assets/go.png', mime: 'image/png', sha256: '0'.repeat(64), base64: 'A'.repeat(Math.ceil(MAX_BUNDLE_RESOURCE_BYTES / 3) * 4 + 4) }],
  };
  await assert.rejects(validateBundle(oversized), (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'RESOURCE_SIZE_LIMIT'));
});

test('rejects aggregate Base64 bytes before decoding resources beyond the total limit', async () => {
  const maximumResourceBase64 = `${'A'.repeat(Math.floor(MAX_BUNDLE_RESOURCE_BYTES / 3) * 4)}AA==`;
  const aggregate = {
    bundleVersion: '0.1', document: legacyDocument(), provenance,
    resources: Array.from({ length: 5 }, (_, index) => ({
      id: `assets/${index}.png`, path: index === 0 ? 'assets/go.png' : `assets/${index}.png`, mime: 'image/png', sha256: '0'.repeat(64), base64: maximumResourceBase64,
    })),
  };
  await assert.rejects(validateBundle(aggregate), (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'TOTAL_SIZE_LIMIT'));
});

test('requires every local document source and does not package network or blob references', async () => {
  await assert.rejects(
    createBundle(legacyDocument(), [], provenance),
    (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'MISSING_RESOURCE'),
  );
  await assert.rejects(
    createBundle(legacyDocument('https://example.test/go.png'), [{ path: 'assets/go.png', mime: 'image/png', bytes }], provenance),
    (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'EXTERNAL_RESOURCE_FORBIDDEN'),
  );
  await assert.rejects(
    createBundle(legacyDocument('blob:https://example.test/a'), [{ path: 'assets/go.png', mime: 'image/png', bytes }], provenance),
    /UNSUPPORTED_SCHEME/,
  );
});

test('rejects unsafe resource paths, duplicate IDs and checksum tampering', async () => {
  await assert.rejects(
    createBundle(legacyDocument(), [{ path: '../go.png', mime: 'image/png', bytes }], provenance),
    (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'PATH_TRAVERSAL_FORBIDDEN'),
  );
  const bundle = await createBundle(legacyDocument(), [{ path: 'assets/go.png', mime: 'image/png', bytes }], provenance);
  const duplicateId = structuredClone(bundle);
  duplicateId.resources.push({ ...duplicateId.resources[0], path: 'assets/second.png' });
  await assert.rejects(validateBundle(duplicateId), (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'DUPLICATE_RESOURCE_ID'));
  const tampered = structuredClone(bundle);
  tampered.resources[0].base64 = 'AQID';
  await assert.rejects(validateBundle(tampered), (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'CHECKSUM_MISMATCH'));
});

test('rejects paths that collide on case-insensitive extraction targets', async () => {
  await assert.rejects(
    createBundle(legacyDocument(), [
      { path: 'assets/go.png', mime: 'image/png', bytes },
      { path: 'assets/GO.png', mime: 'image/png', bytes },
    ], provenance),
    (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'CASE_INSENSITIVE_PATH_COLLISION'),
  );
  const bundle = await createBundle(legacyDocument(), [{ path: 'assets/go.png', mime: 'image/png', bytes }], provenance);
  const collision = structuredClone(bundle);
  collision.resources.push({ ...collision.resources[0], id: 'assets/GO.png', path: 'assets/GO.png' });
  await assert.rejects(validateBundle(collision), (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'CASE_INSENSITIVE_PATH_COLLISION'));
});

test('supports v0.2 documents and validates optional motion against that document', async () => {
  const document = fixtureDocument('composite');
  const { motion } = fixtureInputs('composite');
  const bundle = await createBundle(document, [
    { path: 'fixtures/plate.svg', mime: 'image/svg+xml', bytes: new Uint8Array([60, 115, 118, 103, 62]) },
    { path: 'fixtures/gem.svg', mime: 'image/svg+xml', bytes: new Uint8Array([60, 115, 118, 103, 47, 62]) },
  ], provenance, motion);
  const reloaded = await validateBundle(JSON.parse(JSON.stringify(bundle)));
  assert.equal(reloaded.document.schemaVersion, '0.2');
  assert.equal(reloaded.motion?.id, 'fixture-entrance');
  assert.equal(bundleResources(reloaded).length, 2);
});

test('v0.2 button backgroundImage is a required portable bundle resource', async () => {
  const document = fixtureDocument('composite') as any;
  const button = document.root.children.find((node: any) => node.id === 'confirm');
  button.props.backgroundImage = 'fixtures/confirm-background.png';
  const resources = [
    { path: 'fixtures/plate.svg', mime: 'image/svg+xml', bytes: new Uint8Array([60, 115, 118, 103, 62]) },
    { path: 'fixtures/gem.svg', mime: 'image/svg+xml', bytes: new Uint8Array([60, 115, 118, 103, 47, 62]) },
    { path: 'fixtures/confirm-background.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) },
  ] as const;
  const bundle = await createBundle(document, resources, provenance);
  const reloaded = await validateBundle(JSON.parse(JSON.stringify(bundle)));
  assert.equal(bundleResources(reloaded).some(resource => resource.path === 'fixtures/confirm-background.png'), true);
  await assert.rejects(
    createBundle(document, resources.slice(0, 2), provenance),
    (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'MISSING_RESOURCE'),
  );
});

test('v0.2 Switch raster appearance requires both portable layer resources', async () => {
  const document = fixtureDocument('gallery') as any;
  const toggle = document.root.children.find((node: any) => node.id === 'sound');
  toggle.props.appearance = {
    trackImage: 'fixtures/switch-track.png', thumbImage: 'fixtures/switch-thumb.png', sourceCanvas: { width: 241, height: 129 },
    thumbPositions: { off: { x: 18, y: 18 }, on: { x: 128, y: 18 } },
  };
  const resources = [
    { path: 'fixtures/plate.svg', mime: 'image/svg+xml', bytes: new Uint8Array([60, 115, 118, 103, 62]) },
    { path: 'fixtures/gem.svg', mime: 'image/svg+xml', bytes: new Uint8Array([60, 115, 118, 103, 47, 62]) },
    { path: 'fixtures/switch-track.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) },
    { path: 'fixtures/switch-thumb.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 1]) },
  ];
  const bundle = await createBundle(document, resources, provenance);
  assert.equal(bundleResources(bundle).filter(resource => resource.path.includes('switch-')).length, 2);
  await assert.rejects(
    createBundle(document, resources.slice(0, 3), provenance),
    (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'MISSING_RESOURCE'),
  );
});

test('v0.2 Select raster appearance requires field, arrow, and popup resources', async () => {
  const document = fixtureDocument('gallery') as any;
  const select = document.root.children.find((node: any) => node.id === 'region');
  select.props.appearance = {
    fieldImage: 'fixtures/select-field.png', arrowImage: 'fixtures/select-arrow.png', popupImage: 'fixtures/select-popup.png',
    sourceCanvas: { width: 300, height: 100 }, labelLayout: { x: 64, y: 18, width: 150, height: 64 },
    arrowLayout: { x: 230, y: 40, width: 30, height: 21 }, popupCanvas: { width: 300, height: 150 }, popupGap: 2,
  };
  const resources = [
    { path: 'fixtures/plate.svg', mime: 'image/svg+xml', bytes: new Uint8Array([60, 115, 118, 103, 62]) },
    { path: 'fixtures/gem.svg', mime: 'image/svg+xml', bytes: new Uint8Array([60, 115, 118, 103, 47, 62]) },
    { path: 'fixtures/select-field.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) },
    { path: 'fixtures/select-arrow.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 1]) },
    { path: 'fixtures/select-popup.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 2]) },
  ];
  const bundle = await createBundle(document, resources, provenance);
  assert.equal(bundleResources(bundle).filter(resource => resource.path.includes('select-')).length, 3);
  await assert.rejects(
    createBundle(document, resources.slice(0, 4), provenance),
    (error: unknown) => error instanceof BundleError && error.issues.some(issue => issue.code === 'MISSING_RESOURCE'),
  );
});
