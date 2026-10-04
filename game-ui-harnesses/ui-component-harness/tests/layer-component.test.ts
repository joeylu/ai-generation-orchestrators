import test from 'node:test';
import assert from 'node:assert/strict';
import { compileLayerComponents, intakeLayerComponents, LayerPlanResourcePathError } from '../src/layer-component.ts';
import { bundleResources, validateBundle } from '../src/bundle.ts';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { validateRuntimeBundle } from '../src/runtime-bundle.ts';
import { layerComponentFixture } from './helpers/layer-component-fixture.ts';

test('layer ZIP intake and explicit component plan produce a source-bound v0.4 bundle', async () => {
  const { bytes, plan } = await layerComponentFixture();
  const intake = await intakeLayerComponents(bytes);
  assert.equal(intake.componentStatus, 'needs_input');
  assert.equal(intake.humanVisualAcceptance, false);
  assert.equal(intake.archiveSha256, plan.archiveSha256);
  const bundle = await compileLayerComponents(bytes, plan);
  assert.equal(bundle.bundleVersion, '0.4');
  assert.equal(bundle.resources.length, 2);
  assert.equal(bundle.layerSource?.sha256, plan.archiveSha256);
  assert.deepEqual(new Uint8Array(Buffer.from(bundle.layerSource!.base64, 'base64')), bytes);
  const reopened = await validateBundle(JSON.parse(JSON.stringify(bundle)));
  assert.equal(bundleResources(reopened).length, 2);
  assert.equal(reopened.document.schemaVersion, '0.2');
});

test('layer plan rejects missing, false or stale mappings and source bytes', async () => {
  const { bytes, plan } = await layerComponentFixture();
  const change = () => structuredClone(plan);
  let bad = change(); bad.bindings.pop();
  await assert.rejects(compileLayerComponents(bytes, bad), /LAYER_PLAN_UNBOUND_RESOURCE/);
  bad = change(); bad.bindings = []; bad.unusedLayers = [{ layerId: 'back', reason: 'unused' }, { layerId: 'button', reason: 'unused' }];
  await assert.rejects(compileLayerComponents(bytes, bad), /LAYER_PLAN_NO_BOUND_LAYER/);
  bad = change(); bad.bindings[1].layerId = 'back';
  await assert.rejects(compileLayerComponents(bytes, bad), /LAYER_PLAN_BINDING_MISMATCH/);
  bad = change(); bad.archiveSha256 = '0'.repeat(64);
  await assert.rejects(compileLayerComponents(bytes, bad), /LAYER_PLAN_SOURCE_STALE/);
  bad = change(); bad.document.root.children[1].props.label = 'DIFFERENT';
  const altered = await compileLayerComponents(bytes, bad);
  assert.equal((altered.document as typeof plan.document).root.children[1].props.label, 'DIFFERENT');
  const corrupt = new Uint8Array(bytes); corrupt[50] ^= 1;
  await assert.rejects(compileLayerComponents(corrupt, plan));
});

test('bundle reload rejects edited plan, source, document and resource evidence', async () => {
  const { bytes, plan } = await layerComponentFixture();
  const bundle = await compileLayerComponents(bytes, plan);
  const change = () => JSON.parse(JSON.stringify(bundle));
  let bad = change(); bad.layerSource.sha256 = '0'.repeat(64);
  await assert.rejects(validateBundle(bad), /LAYER_SOURCE_DIGEST/);
  bad = change(); bad.layerSource.plan.requirements = 'changed';
  await assert.rejects(validateBundle(bad), /LAYER_PLAN_DIGEST/);
  bad = change(); bad.document.root.children[1].props.label = 'EXIT';
  await assert.rejects(validateBundle(bad), /LAYER_SOURCE_STALE/);
  bad = change(); bad.resources[1].base64 = bad.resources[0].base64;
  await assert.rejects(validateBundle(bad));
  bad = change(); delete bad.layerSource;
  await assert.rejects(validateBundle(bad), /BUNDLE_VERSION_REQUIRED/);
});

test('source-bound bundle cannot silently enter the different assets handoff', async () => {
  const { bytes, plan } = await layerComponentFixture();
  const bundle = await compileLayerComponents(bytes, plan);
  await assert.rejects(applyAppearanceBinding(bundle, null as never, null), /LAYER_SOURCE_TARGET_IMMUTABLE/);
  await assert.rejects(validateRuntimeBundle(bundle, bundle), /RECURSIVE_COMPONENT_HANDOFF/);
});

test('raster Button IDs are not resource aliases and unknown resources have bounded field diagnostics', async () => {
  const fixture = await layerComponentFixture();
  for (const source of ['button', 'unlisted.png']) {
    const plan = structuredClone(fixture.plan);
    (plan.document.root.children[1] as any).props.appearance.backgroundImage = source;
    await assert.rejects(compileLayerComponents(fixture.bytes, plan), (error: unknown) => {
      assert.ok(error instanceof LayerPlanResourcePathError);
      assert.equal(error.message, 'LAYER_PLAN_EXTERNAL_IMAGE');
      assert.equal(error.issues[0].path, '/document/root/children/1/props/appearance/backgroundImage');
      assert.equal(error.issues[0].code, 'LAYER_PLAN_RESOURCE_PATH_REQUIRED');
      assert.ok(error.issues[0].message.includes(source === 'button' ? 'layers/layer-002.png' : 'authenticated layers[].path'));
      return true;
    });
  }
});
