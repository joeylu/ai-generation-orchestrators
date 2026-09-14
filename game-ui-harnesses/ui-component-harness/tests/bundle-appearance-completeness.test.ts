import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { BundleError, bundleResources, createBundle, validateBundle } from '../src/bundle.ts';
import { secondBatchAppearanceFixture } from './helpers/second-batch-appearance-fixture.ts';

test('every applied second-batch raster is required by both bundle creation and validation', async () => {
  const fixture = await secondBatchAppearanceFixture();
  const bundle = await applyAppearanceBinding(fixture.target, fixture.imported, fixture.binding);
  const resources = bundleResources(bundle);
  const missingResource = (error: unknown) => error instanceof BundleError
    && error.issues.some(issue => issue.code === 'MISSING_RESOURCE');
  // Remove each delivered raster separately, including initially inactive icons,
  // selected rows and closed-dialog parts. Checksums on retained bytes stay valid.
  const rasters = resources.filter(resource => resource.path.startsWith('appearance/'));
  assert.equal(rasters.length, 21);
  for (const raster of rasters) {
    const damaged = structuredClone(bundle);
    damaged.resources = damaged.resources.filter(resource => resource.path !== raster.path);
    await assert.rejects(validateBundle(damaged), missingResource, raster.path);
    await assert.rejects(createBundle(bundle.document,
      resources.filter(resource => resource.path !== raster.path), bundle.provenance), missingResource, raster.path);
  }
});
