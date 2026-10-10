/** Explicit deterministic composition of verified portable PanelBundles. No model calls. */
import { snapshotJson } from './spec.mjs';
import { canonicalJson, digestJson } from './canonical.mjs';
import { validatePanelBundle, createPanelBundle, panelBundleAssetInputs } from './panel-bundle.mjs';
import { panelAssetKeys } from './panel-assets.mjs';
import { arrangeIntentSpec } from './panel-intent.mjs';

const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const exact = (value, keys) => { if (!value || Array.isArray(value) || typeof value !== 'object'
  || !equal(Object.keys(value).sort(), [...keys].sort())) fail('COMPOSITION_FIELDS'); };
const identity = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$(?![\s\S])/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$(?![\s\S])/.test(value);

function snapshotSources(input) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < 2 || input.length > 32)
    fail('COMPOSITION_REQUEST');
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== input.length + 1 || keys.some(key => typeof key !== 'string'
    || !Object.hasOwn(descriptors[key], 'value') || (key !== 'length' && !descriptors[key].enumerable)))
    fail('COMPOSITION_SOURCE_ARRAY');
  const result = [];
  for (let i = 0; i < input.length; i++) {
    if (!Object.hasOwn(descriptors, String(i))) fail('COMPOSITION_SOURCE_ARRAY');
    // Each source retains the ordinary 20,000-node/32-depth JSON budget.
    // A bounded batch must not spend one source's budget on repeated catalogs.
    result.push(snapshotJson(descriptors[String(i)].value));
  }
  return result;
}

export async function composePanelBundles(requestInput, bundlesInput, core) {
  // Snapshot every authored source before the first await.
  const request = snapshotJson(requestInput), inputs = snapshotSources(bundlesInput);
  exact(request, ['panelCompositionRequestVersion', 'id', 'title', 'sources', 'layout', 'width', 'canvasWidth', 'canvasHeight', 'maxHeight', 'surfaceFrom']);
  if (request.panelCompositionRequestVersion !== '0.1' || !identity(request.id)
    || !['column', 'row', 'grid', 'tabs'].includes(request.layout) || !Array.isArray(request.sources)
    || request.sources.length < 2 || request.sources.length > 32 || !Array.isArray(inputs) || inputs.length !== request.sources.length) fail('COMPOSITION_REQUEST');
  if (request.layout === 'tabs' && request.sources.length > 8) fail('COMPOSITION_TABS_LIMIT');
  const namespaces = new Set();
  for (const source of request.sources) {
    exact(source, ['namespace', 'bundleSha256']);
    if (!identity(source.namespace) || source.namespace.length > 24 || namespaces.has(source.namespace) || !hash(source.bundleSha256)) fail('COMPOSITION_NAMESPACE');
    namespaces.add(source.namespace);
  }
  if (request.surfaceFrom !== null && !namespaces.has(request.surfaceFrom)) fail('COMPOSITION_SURFACE');
  const bundles = await Promise.all(inputs.map(input => validatePanelBundle(input, core)));
  const catalog = bundles[0].catalog, themeRef = bundles[0].spec.theme;
  const appearance = bundles[0].spec.appearance ?? null, titleBar = bundles[0].spec.titleBar ?? null;
  const theme = catalog.themes.find(item => equal({ id: item.id, version: item.version }, themeRef));
  const state = [], current = {}, sections = [], groups = [], actionLayouts = [], buttonStyles = [], buttonFonts = [], textLayouts = [], mappings = [], rowIcons = [], records = new Map(), resources = new Map();
  let library = null, panelSurface = null;
  const mappedId = async (namespace, role, id) => {
    const full = `${namespace}_${role}_${id}`;
    return full.length <= 64 ? full : `${full.slice(0, 55)}_${(await digestJson({ namespace, role, id })).slice(0, 8)}`;
  };
  for (let i = 0; i < bundles.length; i++) {
    const bundle = bundles[i], source = request.sources[i], spec = bundle.spec, ns = source.namespace;
    if (bundle.sha256 !== source.bundleSha256) fail('COMPOSITION_SOURCE_MISMATCH');
    if (!['0.4', '0.5', '0.6', '0.7', '0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(spec.panelSpecVersion)) fail('COMPOSITION_SPEC_VERSION');
    if (spec.tabs) fail('COMPOSITION_NESTED_TABS_UNSUPPORTED');
    if (!equal(bundle.catalog, catalog)) fail('COMPOSITION_CATALOG');
    if (!equal(spec.theme, themeRef)) fail('COMPOSITION_THEME');
    if (!equal(spec.appearance ?? null, appearance)) fail('COMPOSITION_APPEARANCE');
    if (!equal(spec.titleBar ?? null, titleBar)) fail('COMPOSITION_TITLE_BAR');
    const fieldMap = new Map(), rowMap = new Map(), sectionMap = new Map();
    for (const field of spec.state) {
      const id = await mappedId(ns, 'f', field.id); fieldMap.set(field.id, id);
      state.push({ ...field, id }); current[id] = bundle.state[field.id];
    }
    for (const section of spec.sections) {
      sectionMap.set(section.id, await mappedId(ns, 's', section.id));
      for (const row of section.rows) rowMap.set(row.id, await mappedId(ns, 'r', row.id));
    }
    const events = [];
    for (const section of spec.sections) {
      sections.push({ ...section, id: sectionMap.get(section.id), title: spec.sections.length === 1 ? spec.title : `${spec.title} · ${section.title}`,
        rows: section.rows.map(original => {
          const row = { ...original, id: rowMap.get(original.id) };
          if (row.bind) row.bind = fieldMap.get(row.bind);
          if (row.event) { row.event = `panel.${row.id}`; events.push({ source: original.event, target: row.event }); }
          if (['reset-initial', 'submit'].includes(row.action?.kind)) row.action = { ...row.action, fields: row.action.fields.map(id => fieldMap.get(id)) };
          return row;
        }) });
    }
    textLayouts.push(...(spec.textLayouts??[]).map(value=>({...value,rowId:rowMap.get(value.rowId)})));
    buttonFonts.push(...(spec.buttonFonts ?? []).map(value => ({ ...value, rowId: rowMap.get(value.rowId) })));
    buttonStyles.push(...(spec.buttonStyles ?? []).map(value => ({...value,rowId:rowMap.get(value.rowId)})));
    actionLayouts.push(...(spec.actionLayouts ?? []).map(value => ({ ...value, sectionId: sectionMap.get(value.sectionId) })));
    const convertBody = node => node.kind === 'section' ? { kind: 'section', sectionId: sectionMap.get(node.sectionId) }
      : { kind: node.kind, children: node.children.map(convertBody) };
    groups.push(convertBody(spec.layout.body));
    mappings.push({ namespace: ns, panelId: spec.id, bundleSha256: bundle.sha256, provenance: spec.provenance,
      fields: [...fieldMap].map(([source, target]) => ({ source, target })), rows: [...rowMap].map(([source, target]) => ({ source, target })),
      sections: [...sectionMap].map(([source, target]) => ({ source, target })), events });
    if (spec.assets) {
      if (library && !equal(library, spec.assets.library)) fail('COMPOSITION_LIBRARY');
      library = spec.assets.library;
      rowIcons.push(...spec.assets.rowIcons.map(icon => ({ ...icon, rowId: rowMap.get(icon.rowId) })));
      if (request.surfaceFrom === ns) { if (!spec.assets.panelSurface) fail('COMPOSITION_SURFACE'); panelSurface = spec.assets.panelSurface; }
      const assets = panelBundleAssetInputs(bundle, core);
      for (const record of assets.closure.records) {
        if (records.has(record.key) && !equal(records.get(record.key), record)) fail('COMPOSITION_ASSET_CONFLICT');
        records.set(record.key, record);
      }
      for (const resource of assets.resources) {
        if (resources.has(resource.path) && !equal([...resources.get(resource.path).bytes], [...resource.bytes])) fail('COMPOSITION_ASSET_CONFLICT');
        resources.set(resource.path, resource);
      }
    } else if (request.surfaceFrom === ns) fail('COMPOSITION_SURFACE');
  }
  const wrapping = bundles.some(bundle => ['0.13','0.14'].includes(bundle.spec.panelSpecVersion));
  const titled = wrapping || bundles.some(bundle => bundle.spec.panelSpecVersion === '0.12');
  const typography = titled || bundles.some(bundle => bundle.spec.panelSpecVersion === '0.11');
  const individual = typography || bundles.some(bundle => bundle.spec.panelSpecVersion === '0.10');
  const arranged = individual || bundles.some(bundle => bundle.spec.panelSpecVersion === '0.9');
  const styled = arranged || bundles.some(bundle => bundle.spec.panelSpecVersion === '0.8');
  const forms = styled || bundles.some(bundle => bundle.spec.panelSpecVersion === '0.7');
  const tabbed = request.layout === 'tabs', modern = forms || tabbed || bundles.some(bundle => bundle.spec.panelSpecVersion === '0.6');
  const tabsRecipe = tabbed ? catalog.recipes.find(recipe => recipe.kind === 'tabs') : null;
  if (tabbed && !tabsRecipe) fail('COMPOSITION_TABS_RECIPE_REQUIRED');
  const pages = tabbed ? mappings.map((mapping, index) => ({ id: `page${index}`, label: bundles[index].spec.title, sections: mapping.sections.map(item => item.target) })) : null;
  if (tabbed) {
    state.push({ id: 'navigation', type: 'enum', initial: pages[0].id, options: pages.map(({id,label}) => ({id,label})) });
    current.navigation = pages[0].id;
  }
  const spec = arrangeIntentSpec({ panelSpecVersion: wrapping ? '0.13' : titled ? '0.12' : typography ? '0.11' : individual ? '0.10' : arranged ? '0.9' : styled ? '0.8' : forms ? '0.7' : modern ? '0.6' : bundles.some(bundle => bundle.spec.panelSpecVersion === '0.5') ? '0.5' : '0.4', id: request.id, title: request.title, theme: themeRef, state, sections,
    ...(arranged ? { actionLayouts } : {}), ...(individual ? { buttonStyles } : {}), ...(typography ? { buttonFonts } : {}), ...(titled ? { titleBar } : {}), ...(wrapping ? {textLayouts} : {}),
    ...(styled ? { appearance } : {}),
    ...(modern ? { tabs: tabbed ? { id: 'navigation', recipe: {id:tabsRecipe.id,version:tabsRecipe.version}, bind:'navigation', event:'panel.navigation', enabled:true, pages } : null } : {}),
    assets: panelSurface || rowIcons.length ? { library, panelSurface, rowIcons } : null,
    provenance: { kind: bundles.some(bundle => bundle.spec.provenance.kind === 'agent-authored') ? 'agent-authored'
      : bundles.every(bundle => bundle.spec.provenance.kind === 'programmatic-fixture') ? 'programmatic-fixture' : 'user-authored',
      description: 'Deterministic composition of verified source bundles under an explicit composition request. Source provenance is retained in the composition receipt.',
      assumptions: ['Bindings and events are namespaced per source; reset scopes remain source-local.', 'Source section layout kinds are preserved; geometry is measured for the new container.'] } },
    { width: request.width, canvasWidth: request.canvasWidth, canvasHeight: request.canvasHeight, maxHeight: request.maxHeight,
      overflow: 'scroll', sourceQuote: null, body: { kind: tabbed ? 'column' : request.layout, children: groups } }, theme, catalog);
  if (titled) spec.layout.titleHeight = bundles[0].spec.layout.titleHeight;
  const keys = panelAssetKeys(spec), selectedRecords = keys.map(key => records.get(key)), paths = new Set(selectedRecords.map(record => `textures/${record.sha256}.png`));
  const assets = spec.assets ? { closure: { assetClosureVersion: '0.1', library, records: selectedRecords },
    resources: [...resources.values()].filter(resource => paths.has(resource.path)) } : undefined;
  const bundle = await validatePanelBundle(await createPanelBundle(spec, catalog, core, current, assets), core);
  const payload = { panelCompositionReceiptVersion: '0.1', requestSha256: await digestJson(request), bundleSha256: bundle.sha256,
    mappings, preservation: { defaults: 'PASS', currentState: 'PASS', resetScopes: 'PASS', rowOrder: 'PASS', assets: 'PASS' },
    verification: { contract: 'PASS', browser: 'NOT_RUN', nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN' }, modelCalls: 0 };
  return { request, bundle, receipt: { ...payload, sha256: await digestJson(payload) } };
}

/** Reproduce every transformation from original sources, including resource bytes and current state. */
export async function validatePanelComposition(input, sources, core) {
  const result = snapshotJson(input); exact(result, ['request', 'bundle', 'receipt']);
  const expected = await composePanelBundles(result.request, sources, core);
  if (!equal(result, expected)) fail('COMPOSITION_REPLAY_MISMATCH');
  return expected;
}
