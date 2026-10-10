import { validatePanelSpec, snapshotJson } from './spec.mjs';
import { validateCatalog } from './catalog.mjs';
import { compilePanel, defaultPanelCompilerVersion, PANEL_COMPILER_VERSION, ASSET_PANEL_COMPILER_VERSION, CONTROLS_PANEL_COMPILER_VERSION, FLOW_PANEL_COMPILER_VERSION, LEGACY_FLOW_PANEL_COMPILER_VERSION, PROGRESS_PANEL_COMPILER_VERSION, LEGACY_PROGRESS_PANEL_COMPILER_VERSION, TABS_PANEL_COMPILER_VERSION, FORMS_PANEL_COMPILER_VERSION, MODERN_PANEL_COMPILER_VERSION, THEMED_PANEL_COMPILER_VERSION, ADAPTIVE_PANEL_COMPILER_VERSION, APPEARANCE_PANEL_COMPILER_VERSION, ACTION_LAYOUT_PANEL_COMPILER_VERSION, BUTTON_STYLE_PANEL_COMPILER_VERSION, BUTTON_FONT_PANEL_COMPILER_VERSION, TITLE_BAR_PANEL_COMPILER_VERSION, TEXT_WRAP_PANEL_COMPILER_VERSION, FRAME_PANEL_COMPILER_VERSION, SEMANTIC_PANEL_COMPILER_VERSION, FOCUSED_PANEL_COMPILER_VERSION, NAVIGATION_PANEL_COMPILER_VERSION, REFINED_PANEL_COMPILER_VERSION, MINIMAL_PANEL_COMPILER_VERSION, CRAFTED_PANEL_COMPILER_VERSION, GROUPED_PANEL_COMPILER_VERSION, PLAIN_ICON_PANEL_COMPILER_VERSION, RAISED_SLIDER_PANEL_COMPILER_VERSION, GROUPED_CONTENT_PANEL_COMPILER_VERSION, ALIGNED_SETTINGS_PANEL_COMPILER_VERSION, POLISHED_MENU_PANEL_COMPILER_VERSION, SECTION_HEADING_PANEL_COMPILER_VERSION } from './compiler.mjs';
import { canonicalJson, digestJson } from './canonical.mjs';
import { validatePanelAssetInputs, panelAssetPath } from './panel-assets.mjs';

/** An envelope around the unchanged component bundle, not a new UiBundle version. */
export async function createPanelBundle(specInput, catalogInput, core, stateInput, assetInput, compilerVersionInput) {
  const spec = validatePanelSpec(specInput), catalog = validateCatalog(catalogInput);
  const sized = spec.panelSpecVersion === '0.14', wrapping = sized || spec.panelSpecVersion === '0.13', titled = wrapping || spec.panelSpecVersion === '0.12', typography = titled || spec.panelSpecVersion === '0.11', individual = typography || spec.panelSpecVersion === '0.10', arranged = individual || spec.panelSpecVersion === '0.9', styled = arranged || spec.panelSpecVersion === '0.8', forms = styled || spec.panelSpecVersion === '0.7', tabbed = forms || spec.panelSpecVersion === '0.6', progress = tabbed || spec.panelSpecVersion === '0.5', flow = progress || spec.panelSpecVersion === '0.4', controls = flow || spec.panelSpecVersion === '0.3';
  const state = stateInput === undefined ? undefined : snapshotJson(stateInput);
  const assets = await validatePanelAssetInputs(spec, assetInput);
  const compilerVersion = compilerVersionInput ?? defaultPanelCompilerVersion(spec, catalog);
  const compiled = compilePanel(spec, catalog, core, state, assets.closure, compilerVersion);
  const componentBundle = await core.createBundle(compiled.document, [...assets.resources,...(compiled.resources ?? [])], {
    kind: spec.provenance.kind === 'programmatic-fixture' ? 'programmatic-fixture' : 'user-provided',
    description: spec.provenance.kind === 'agent-authored'
      ? 'Agent-proposed external document; not user-authored or reviewed. Full author description and assumptions are preserved in the enclosing PanelBundle spec.provenance.'
      : spec.provenance.description,
  });
  const payload = {
    panelBundleVersion: sized ? '0.14' : wrapping ? '0.13' : titled ? '0.12' : typography ? '0.11' : individual ? '0.10' : arranged ? '0.9' : styled ? '0.8' : forms ? '0.7' : tabbed ? '0.6' : progress ? '0.5' : flow ? '0.4' : controls ? '0.3' : spec.assets ? '0.2' : '0.1', compilerVersion,
    spec, catalog, state: compiled.state, selection: compiled.selection, bindings: compiled.bindings, componentBundle,
    ...(controls ? { actions: compiled.actions } : {}),
    ...(assets.closure ? { assetClosure: assets.closure } : {}),
    capabilities: { componentSchema: '0.2', target: 'pixi', layout: flow ? 'flow-containers-v1' : 'fixed-viewport-stacks', font: 'environment-family', ...(controls ? { sessionRequired: true } : {}) },
    verification: { contract: 'PASS', browser: 'NOT_RUN', humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' },
  };
  return { ...payload, sha256: await digestJson(payload) };
}

export async function validatePanelBundle(input, core) {
  input = snapshotJson(input);
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) throw new Error('PANEL_BUNDLE_OBJECT');
  // Recompile the embedded authored inputs: hashes alone do not prove that output follows the spec.
  const semantic = ['0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(input.panelBundleVersion) && [SEMANTIC_PANEL_COMPILER_VERSION, FOCUSED_PANEL_COMPILER_VERSION, NAVIGATION_PANEL_COMPILER_VERSION, REFINED_PANEL_COMPILER_VERSION, MINIMAL_PANEL_COMPILER_VERSION, CRAFTED_PANEL_COMPILER_VERSION, GROUPED_PANEL_COMPILER_VERSION, PLAIN_ICON_PANEL_COMPILER_VERSION, RAISED_SLIDER_PANEL_COMPILER_VERSION, GROUPED_CONTENT_PANEL_COMPILER_VERSION, ALIGNED_SETTINGS_PANEL_COMPILER_VERSION, POLISHED_MENU_PANEL_COMPILER_VERSION, SECTION_HEADING_PANEL_COMPILER_VERSION].includes(input.compilerVersion);
  if (!semantic && !(input.panelBundleVersion === '0.1' && input.compilerVersion === PANEL_COMPILER_VERSION)
    && !(input.panelBundleVersion === '0.2' && input.compilerVersion === ASSET_PANEL_COMPILER_VERSION)
    && !(input.panelBundleVersion === '0.3' && input.compilerVersion === CONTROLS_PANEL_COMPILER_VERSION)
    && !(input.panelBundleVersion === '0.4' && [FLOW_PANEL_COMPILER_VERSION, LEGACY_FLOW_PANEL_COMPILER_VERSION].includes(input.compilerVersion))
    && !(input.panelBundleVersion === '0.5' && [PROGRESS_PANEL_COMPILER_VERSION, LEGACY_PROGRESS_PANEL_COMPILER_VERSION].includes(input.compilerVersion))
    && !(input.panelBundleVersion === '0.6' && input.compilerVersion === TABS_PANEL_COMPILER_VERSION)
    && !(input.panelBundleVersion === '0.7' && [FORMS_PANEL_COMPILER_VERSION, MODERN_PANEL_COMPILER_VERSION, THEMED_PANEL_COMPILER_VERSION, ADAPTIVE_PANEL_COMPILER_VERSION].includes(input.compilerVersion))
    && !(input.panelBundleVersion === '0.8' && input.compilerVersion === APPEARANCE_PANEL_COMPILER_VERSION)
    && !(input.panelBundleVersion === '0.9' && input.compilerVersion === ACTION_LAYOUT_PANEL_COMPILER_VERSION)
    && !(input.panelBundleVersion === '0.10' && input.compilerVersion === BUTTON_STYLE_PANEL_COMPILER_VERSION)
    && !(input.panelBundleVersion === '0.11' && input.compilerVersion === BUTTON_FONT_PANEL_COMPILER_VERSION)
    && !(input.panelBundleVersion === '0.12' && input.compilerVersion === TITLE_BAR_PANEL_COMPILER_VERSION)
    && !(input.panelBundleVersion === '0.13' && input.compilerVersion === TEXT_WRAP_PANEL_COMPILER_VERSION)
    && !(input.panelBundleVersion === '0.14' && input.compilerVersion === FRAME_PANEL_COMPILER_VERSION)) throw new Error('PANEL_BUNDLE_VERSION');
  input.componentBundle = await core.validateBundle(input.componentBundle);
  const expected = await createPanelBundle(input.spec, input.catalog, core, input.state, panelBundleAssetInputs(input, core), input.compilerVersion);
  if (canonicalJson(input) !== canonicalJson(expected)) throw new Error('PANEL_BUNDLE_MISMATCH');
  return expected;
}

/** Call only with a validated component bundle; binary decoding is owned by its adapter. */
export function panelBundleAssetInputs(bundle, core) {
  const paths = new Set((bundle.assetClosure?.records ?? []).map(panelAssetPath));
  return bundle.spec?.assets
    ? { closure: bundle.assetClosure, resources: core.bundleResources(bundle.componentBundle).filter(resource=>paths.has(resource.path)) } : undefined;
}
