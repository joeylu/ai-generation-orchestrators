/** Bind a reviewed UI layer package to an explicit v0.2 component document. */
import { createBundle, type UiBundle } from './bundle.ts';
import { validateBoundLayerSemanticInputs, assertLayerSemanticInputs, type BoundLayerSemanticInputs } from './layer-semantic-inputs.ts';
import { importLayerPackage, type LayerPackage } from './layer-package.ts';
import { treeResourceReferences } from './tree-resources.ts';
import { validateDocument, type UiDocument } from './tree-contract.ts';
import { validateLayerPlanningEvidence, isPortableLayerPlanningNote, type LayerPlanningEvidence } from './layer-planning-evidence.ts';
import { validateLayerAdaptations, type LayerAdaptation } from './layer-adaptation.ts';
import { validateLayerLayoutChecks, type LayerLayoutChecks } from './layer-layout-checks.ts';

export const MAX_LAYER_SOURCE_BYTES = 64 * 1024 * 1024;
export const LAYER_COMPONENT_PLAN_VERSION = '1.0' as const;
const imageKeys = new Set([
  'source', 'image', 'backgroundImage', 'trackImage', 'thumbImage', 'fieldImage',
  'arrowImage', 'popupImage', 'rowImage', 'selectedRowImage', 'scrollbarThumbImage',
  'tabImage', 'activeTabImage', 'overlayImage',
]);

export interface LayerComponentPlan {
  kind: 'ui-layer-component-plan';
  version: typeof LAYER_COMPONENT_PLAN_VERSION;
  archiveSha256: string;
  basis: 'agent-reviewed' | 'vision-proposed' | 'model-proposed' | 'programmatic-fixture';
  requirements: string;
  document: UiDocument;
  bindings: { layerId: string; pointer: string }[];
  unusedLayers: { layerId: string; reason: string }[];
  planningEvidence?: LayerPlanningEvidence;
  adaptations?: LayerAdaptation[];
  layoutChecks?: LayerLayoutChecks;
  semanticInputs?: BoundLayerSemanticInputs;
}
export interface PersistedLayerSource { sha256: string; base64: string; planSha256: string; plan: LayerComponentPlan }

/** Portable field diagnostics; a layer ID is never accepted as a resource alias. */
export class LayerPlanResourcePathError extends Error {
  readonly issues: Array<{ path: string; code: string; message: string }>;
  constructor(code: string, issues: Array<{ path: string; code: string; message: string }>) {
    super(code); this.issues = issues;
  }
}

function fail(code: string): never { throw new Error(code); }
function object(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join('|') !== [...keys].sort().join('|')) fail(code);
  return data;
}
function text(value: unknown, code: string, maximum = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum) fail(code);
  return value;
}
export async function layerSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function encode(bytes: Uint8Array): string {
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) raw += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(raw);
}
function decode(base64: unknown): Uint8Array {
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(MAX_LAYER_SOURCE_BYTES / 3) * 4 + 4) fail('LAYER_SOURCE_BASE64');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0)); }
  catch { return fail('LAYER_SOURCE_BASE64'); }
  if (bytes.length > MAX_LAYER_SOURCE_BYTES || encode(bytes) !== base64) fail('LAYER_SOURCE_BASE64');
  return bytes;
}
function resourcePointers(value: unknown, path = ''): Map<string, string> {
  const result = new Map<string, string>();
  const visit = (entry: unknown, pointer: string): void => {
    if (!entry || typeof entry !== 'object') return;
    for (const [key, child] of Object.entries(entry)) {
      const next = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (imageKeys.has(key) && typeof child === 'string') result.set(next, child);
      else if (child && typeof child === 'object') visit(child, next);
    }
  };
  visit(value, path);
  return result;
}
export async function validateLayerComponentPlan(input: unknown, sourceSha256: string, pack: LayerPackage): Promise<LayerComponentPlan> {
  const hasEvidence = !!input && typeof input === 'object' && Object.hasOwn(input, 'planningEvidence');
  const hasAdaptations = !!input && typeof input === 'object' && Object.hasOwn(input, 'adaptations');
  const hasLayoutChecks = !!input && typeof input === 'object' && Object.hasOwn(input, 'layoutChecks');
  const hasSemanticInputs = !!input && typeof input === 'object' && Object.hasOwn(input, 'semanticInputs');
  const data = object(input, ['kind', 'version', 'archiveSha256', 'basis', 'requirements', 'document', 'bindings', 'unusedLayers', ...(hasEvidence ? ['planningEvidence'] : []), ...(hasAdaptations ? ['adaptations'] : []), ...(hasLayoutChecks ? ['layoutChecks'] : []), ...(hasSemanticInputs ? ['semanticInputs'] : [])], 'LAYER_PLAN_FIELDS');
  if (data.kind !== 'ui-layer-component-plan' || data.version !== LAYER_COMPONENT_PLAN_VERSION) fail('LAYER_PLAN_VERSION');
  if (data.archiveSha256 !== sourceSha256) fail('LAYER_PLAN_SOURCE_STALE');
  if (!['agent-reviewed', 'vision-proposed', 'model-proposed', 'programmatic-fixture'].includes(String(data.basis))) fail('LAYER_PLAN_BASIS');
  text(data.requirements, 'LAYER_PLAN_REQUIREMENTS', 500);
  if (data.basis === 'model-proposed' && !isPortableLayerPlanningNote(data.requirements, 500)) fail('LAYER_PLAN_REQUIREMENTS');
  const document = validateDocument(data.document);
  const layoutChecks = hasLayoutChecks ? validateLayerLayoutChecks(data.layoutChecks, document) : undefined;
  const semanticInputs = hasSemanticInputs ? await validateBoundLayerSemanticInputs(data.semanticInputs) : undefined;
  if (semanticInputs) assertLayerSemanticInputs(semanticInputs, document);
  if (data.basis === 'model-proposed' && !hasEvidence) fail('LAYER_PLAN_EVIDENCE_REQUIRED');
  const planningEvidence = hasEvidence ? validateLayerPlanningEvidence(data.planningEvidence, document) : undefined;
  const layers = new Map(pack.composition.layers.map(layer => [layer.id, layer]));
  const paths = new Set(pack.composition.layers.map(layer => layer.path));
  const { imageSources, fontSources } = treeResourceReferences(document);
  const pointers = resourcePointers(document);
  const imagePointers = new Map([...pointers].filter(([, source]) => imageSources.has(source)));
  const pathIssues = [...imagePointers].filter(([, source]) => !paths.has(source)).map(([pointer, source]) => {
    const layer = layers.get(source);
    return { path: `/document${pointer}`, code: 'LAYER_PLAN_RESOURCE_PATH_REQUIRED',
      message: `${layer ? `Use the authenticated resource path "${layer.path}" for this image field.` : 'Use an exact authenticated layers[].path for this image field.'} Layer IDs belong in bindings[].layerId and adaptations[].sourceLayerId.` };
  });
  let adaptations: LayerAdaptation[] | undefined;
  try { adaptations = hasAdaptations ? validateLayerAdaptations(data.adaptations, document, pack, planningEvidence) : undefined; }
  catch (error) {
    if (error instanceof Error && error.message === 'LAYER_PLAN_ADAPTATION_INVALID' && pathIssues.length) {
      throw new LayerPlanResourcePathError(error.message, pathIssues);
    }
    throw error;
  }
  if (planningEvidence && planningEvidence.referenceSha256 !== await layerSha256(pack.files.get('reference.png')!)) fail('LAYER_PLAN_REFERENCE_STALE');
  if (document.canvas.width !== pack.composition.canvas.width || document.canvas.height !== pack.composition.canvas.height) fail('LAYER_PLAN_CANVAS_MISMATCH');
  if (!Array.isArray(data.bindings) || !Array.isArray(data.unusedLayers)) fail('LAYER_PLAN_MAPPINGS');
  if (fontSources.size) fail('LAYER_PLAN_FONT_RESOURCE_UNAVAILABLE');
  if (pathIssues.length) throw new LayerPlanResourcePathError('LAYER_PLAN_EXTERNAL_IMAGE', pathIssues);
  const boundPointers = new Set<string>(), accounted = new Set<string>();
  const bindings = data.bindings.map((raw, index) => {
    const binding = object(raw, ['layerId', 'pointer'], `LAYER_PLAN_BINDING_${index}`);
    const layerId = text(binding.layerId, 'LAYER_PLAN_LAYER_ID', 128);
    const pointer = text(binding.pointer, 'LAYER_PLAN_POINTER', 500);
    const layer = layers.get(layerId);
    if (!layer || !imagePointers.has(pointer) || imagePointers.get(pointer) !== layer.path || boundPointers.has(pointer)) fail('LAYER_PLAN_BINDING_MISMATCH');
    boundPointers.add(pointer); accounted.add(layerId);
    return { layerId, pointer };
  });
  if (!bindings.length) fail('LAYER_PLAN_NO_BOUND_LAYER');
  if (boundPointers.size !== imagePointers.size) fail('LAYER_PLAN_UNBOUND_RESOURCE');
  const unusedLayers = data.unusedLayers.map((raw, index) => {
    const row = object(raw, ['layerId', 'reason'], `LAYER_PLAN_UNUSED_${index}`);
    const layerId = text(row.layerId, 'LAYER_PLAN_LAYER_ID', 128);
    const reason = text(row.reason, 'LAYER_PLAN_UNUSED_REASON', 500);
    if (!layers.has(layerId) || accounted.has(layerId)) fail('LAYER_PLAN_UNUSED_CONFLICT');
    accounted.add(layerId); return { layerId, reason };
  });
  if (accounted.size !== layers.size) fail('LAYER_PLAN_UNACCOUNTED_LAYER');
  return { kind: 'ui-layer-component-plan', version: LAYER_COMPONENT_PLAN_VERSION,
    archiveSha256: sourceSha256, basis: data.basis as LayerComponentPlan['basis'], requirements: data.requirements as string,
    document, bindings, unusedLayers, ...(planningEvidence ? { planningEvidence } : {}), ...(adaptations ? { adaptations } : {}), ...(layoutChecks ? { layoutChecks } : {}), ...(semanticInputs ? { semanticInputs } : {}) };
}

export async function intakeLayerComponents(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_LAYER_SOURCE_BYTES) fail('LAYER_SOURCE_SIZE_LIMIT');
  const pack = await importLayerPackage(bytes), archiveSha256 = await layerSha256(bytes);
  return { kind: 'ui-layer-component-intake' as const, version: LAYER_COMPONENT_PLAN_VERSION,
    archiveSha256, canvas: pack.composition.canvas, textPolicy: pack.composition.textPolicy,
    layers: pack.composition.layers, reviewIssues: pack.issues, packageIntegrity: 'verified', imageDecode: 'not_run',
    componentStatus: 'needs_input', humanVisualAcceptance: false,
    requiredInputs: ['reviewed v0.2 component document', 'explicit text and style', 'layer resource bindings'] };
}

/** Compile all sixteen contract types without inferring a type, label, state or action from pixels or names. */
async function compile(bytes: Uint8Array, input: unknown, persist: boolean): Promise<UiBundle> {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_LAYER_SOURCE_BYTES) fail('LAYER_SOURCE_SIZE_LIMIT');
  const archive = new Uint8Array(bytes), pack = await importLayerPackage(archive);
  const sourceSha256 = await layerSha256(archive), plan = await validateLayerComponentPlan(input, sourceSha256, pack);
  const planSha256 = await layerSha256(new TextEncoder().encode(canonical(plan)));
  const { imageSources } = treeResourceReferences(plan.document);
  const resources = pack.composition.layers.filter(layer => imageSources.has(layer.path)).map(layer => ({
    path: layer.path, mime: 'image/png', bytes: new Uint8Array(pack.files.get(layer.path)!),
  }));
  const bundle = await createBundle(plan.document, resources, {
    kind: plan.basis === 'programmatic-fixture' ? 'programmatic-fixture' : 'user-provided',
    description: `Explicit component plan for ui-layers.zip SHA-256 ${sourceSha256}; plan SHA-256 ${planSha256}. ${plan.basis === 'model-proposed' ? 'Model proposal with portable decision evidence; human review required.' : plan.basis === 'vision-proposed' ? 'Automatic draft with provisional typography and layer matching; human review required.' : 'Human visual acceptance not run.'}`,
  });
  if (!persist) return bundle;
  const source: PersistedLayerSource = { sha256: sourceSha256, base64: encode(archive), planSha256, plan };
  const { validateBundle } = await import('./bundle.ts');
  return validateBundle({ ...bundle, bundleVersion: '0.4', layerSource: source });
}

/** Public build always retains the authenticated source ZIP and explicit plan. */
export async function compileLayerComponents(bytes: Uint8Array, input: unknown): Promise<UiBundle> {
  return compile(bytes, input, true);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
}
const mutable: Record<string, string[]> = {
  Tabs: ['activeId'], CheckBox: ['checked'], Switch: ['checked'], RadioGroup: ['selectedId'],
  List: ['selectedId'], Select: ['selectedId'], ScrollView: ['scrollX', 'scrollY'],
  Input: ['value'], Slider: ['value'], ProgressBar: ['value'], Dialog: ['open'],
};
function structure(document: UiDocument): string {
  const copy = structuredClone(document) as UiDocument & { linkageState?: unknown };
  delete copy.linkageState;
  delete copy.interactionState;
  const visit = (node: UiDocument['root']): void => {
    for (const key of mutable[node.type] ?? []) delete (node.props as unknown as Record<string, unknown>)[key];
    if ('children' in node) node.children.forEach(visit);
  };
  visit(copy.root);
  return canonical(copy);
}

/** Rebuild from the exact source and plan on every load; only existing runtime values may differ. */
export async function validatePersistedLayerSource(input: unknown, bundle: UiBundle): Promise<void> {
  const data = object(input, ['sha256', 'base64', 'planSha256', 'plan'], 'LAYER_SOURCE_ATTACHMENT');
  if (typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) fail('LAYER_SOURCE_DIGEST');
  if (typeof data.planSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.planSha256)
    || await layerSha256(new TextEncoder().encode(canonical(data.plan))) !== data.planSha256) fail('LAYER_PLAN_DIGEST');
  const archive = decode(data.base64);
  if (await layerSha256(archive) !== data.sha256) fail('LAYER_SOURCE_DIGEST');
  const original = await compile(archive, data.plan, false);
  if (bundle.document.schemaVersion !== '0.2' || structure(bundle.document) !== structure(original.document as UiDocument)
    || canonical([...bundle.resources].sort((a,b) => a.path.localeCompare(b.path))) !== canonical([...original.resources].sort((a,b) => a.path.localeCompare(b.path)))
    || canonical(bundle.provenance) !== canonical(original.provenance)) fail('LAYER_SOURCE_STALE');
}
