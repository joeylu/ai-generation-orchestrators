import { verifyAssetLibrary, resolveAsset } from './asset-library.mjs';
import { snapshotJson, validatePanelSpec } from './spec.mjs';
import { panelAssetKeys, panelAssetPath, validatePanelAssetInputs } from './panel-assets.mjs';
import { createAssetRetrieval } from './asset-retrieval.mjs';
import { createPlanningContext, validatePlanningContext, validatePanelRequest } from './planning-context.mjs';
import { canonicalJson, digestJson } from './canonical.mjs';

/** Node-only adapter: fully verify the library before selecting any exact-version resource. */
export async function loadPanelAssets(specInput, directory, adapter) {
  const spec = validatePanelSpec(specInput);
  if (!spec.assets) throw new Error('PANEL_ASSETS_UNEXPECTED');
  return selectVerifiedAssets(spec, await verifyAssetLibrary(directory, adapter));
}

function selectVerifiedAssets(spec, { index, blobs }) {
  if (index.id !== spec.assets.library.id || index.sha256 !== spec.assets.library.sha256) throw new Error('PANEL_ASSET_LIBRARY_MISMATCH');
  const records = panelAssetKeys(spec).map(key => {
    const r = resolveAsset(index, key);
    return { key, role: r.metadata.role, width: r.image.width, height: r.image.height,
      slice: r.metadata.slice, sha256: r.file.sha256, bytes: r.file.bytes };
  });
  const resources = [...new Map(records.map(r => [panelAssetPath(r), {
    path: panelAssetPath(r), mime: 'image/png', bytes: blobs.get(panelAssetPath(r)),
  }])).values()];
  return validatePanelAssetInputs(spec, { closure: { assetClosureVersion: '0.1', library: spec.assets.library, records }, resources });
}

/** Verify full library, then bound the external planning context to small ranked candidates. */
export async function createAssetPlanningContext(requestInput, catalog, directory, adapter, options = {}) {
  const request = validatePanelRequest(requestInput);
  const checkedOptions = snapshotJson(options);
  if (!checkedOptions || Array.isArray(checkedOptions) || typeof checkedOptions !== 'object'
    || Object.keys(checkedOptions).some(key => key !== 'style')) throw new Error('PLAN_ASSET_OPTIONS');
  const style = checkedOptions.style ?? null;
  if (style !== null && (typeof style !== 'string' || !/^[a-z0-9.-]{1,96}$(?![\s\S])/.test(style))) throw new Error('PLAN_ASSET_STYLE');
  // Isolate caller values before filesystem work.
  const base = await createPlanningContext(request, catalog);
  const verified = await verifyAssetLibrary(directory, adapter);
  return createPlanningContext(base.request, base.catalog, createAssetRetrieval(base.request.text, verified.index, { style }));
}

/** Recompute against real library bytes; offline context checks alone cannot authenticate candidates. */
export async function loadPanelPlanAssets(contextInput, specInput, directory, adapter) {
  const spec = validatePanelSpec(specInput), context = await validatePlanningContext(contextInput);
  if (!context.assetRetrieval) throw new Error('PLAN_ASSET_CONTEXT_REQUIRED');
  const verified = await verifyAssetLibrary(directory, adapter);
  const retrieval = createAssetRetrieval(context.request.text, verified.index, { style: context.assetRetrieval.policy.style });
  if (canonicalJson(retrieval) !== canonicalJson(context.assetRetrieval)) throw new Error('PLAN_ASSET_RETRIEVAL_MISMATCH');
  const assets = spec.assets ? await selectVerifiedAssets(spec, verified) : undefined;
  const receipt = { assetBuildVerificationVersion: '0.1', status: 'VERIFIED', contextSha256: context.sha256,
    library: retrieval.library, retrievalSha256: await digestJson(retrieval), selectedKeys: panelAssetKeys(spec) };
  return { assets, receipt };
}
