import { PanelSpecError, snapshotJson } from './spec.mjs';
import { searchCatalog, validateCatalog } from './catalog.mjs';
import { canonicalJson, digestJson } from './canonical.mjs';
import { validateAssetRetrieval } from './asset-retrieval.mjs';

const fail = (code, path, message) => { throw new PanelSpecError(code, path, message); };
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function exactObject(value, fields, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object', path, 'must be an object');
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) fail('unknown-key', `${path}.${key}`, 'unknown field');
  }
  for (const key of fields) {
    if (!Object.hasOwn(value, key)) fail('required', `${path}.${key}`, 'required field is missing');
  }
}

/** Keep the original prose intact. Validation neither interprets it nor fills defaults. */
export function validatePanelRequest(input) {
  const request = snapshotJson(input);
  exactObject(request, ['requestVersion', 'id', 'text', 'target'], '$');
  if (request.requestVersion !== '0.1') fail('request-version', '$.requestVersion', 'only request 0.1 is supported');
  if (typeof request.id !== 'string' || request.id.length > 64 || !/^[A-Za-z][A-Za-z0-9_-]*$(?![\s\S])/.test(request.id)) {
    fail('identifier', '$.id', 'must be an ASCII identifier of at most 64 characters');
  }
  // CR/LF and tabs are useful in user prose; other controls and lone surrogates are not.
  if (typeof request.text !== 'string' || !request.text.trim() || [...request.text].length > 8000
      || /[\p{Cc}\p{Cs}]/u.test(request.text.replace(/[\r\n\t]/gu, ''))) {
    fail('request-text', '$.text', 'must be nonempty text of at most 8000 Unicode characters; only newline and tab controls are allowed');
  }
  if (request.target !== 'pixi') fail('request-target', '$.target', 'only the pixi target is supported');
  return request;
}

// searchCatalog accepts <=512 UTF-16 units without controls. Overlapping windows
// retain catalog tags (at most 80 units) straddling a boundary, including long prose.
// These are retrieval hints only; the complete untouched request remains authoritative.
function* queryWindows(text) {
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + 480, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end -= 1;
    // Prefer punctuation/whitespace boundaries, so a clipped word does not become
    // a new search term. Unbroken long prose still uses bounded overlapping windows.
    if (end < text.length && /[\p{L}\p{N}]$/u.test(text.slice(start, end))
        && /^[\p{L}\p{N}]/u.test(text.slice(end))) {
      let boundary = start;
      for (const separator of text.slice(start, end).matchAll(/[^\p{L}\p{N}]/gu)) {
        boundary = start + separator.index + separator[0].length;
      }
      if (boundary > start + 160) end = boundary;
    }
    yield text.slice(start, end).replace(/\s+/gu, ' ');
    if (end === text.length) break;
    start = end - 160;
    if (/[\uDC00-\uDFFF]/u.test(text[start])) start += 1;
  }
}

/** Program-generated context for an external Agent; it does not parse natural language. */
export async function createPlanningContext(requestInput, catalogInput, assetRetrievalInput) {
  const request = validatePanelRequest(requestInput);
  const catalog = validateCatalog(snapshotJson(catalogInput));
  const supportsProgress = catalog.recipes.some(recipe => recipe.kind === 'progress-row');
  const supportsLayout = supportsProgress || catalog.recipes.some(recipe => recipe.kind === 'text-row');
  const supportsControls = supportsLayout || catalog.recipes.some(recipe => ['select-row', 'button-row'].includes(recipe.kind));
  const assetRetrieval = assetRetrievalInput === undefined || (supportsControls && assetRetrievalInput === null)
    ? undefined : validateAssetRetrieval(request.text, assetRetrievalInput);
  const matches = new Map();
  for (const query of queryWindows(request.text)) {
    for (const { recipe, score } of searchCatalog(catalog, { query, target: request.target })) {
      const key = `${recipe.id}@${recipe.version}`;
      if (!matches.has(key) || score > matches.get(key).score) {
        matches.set(key, { id: recipe.id, version: recipe.version, kind: recipe.kind, score });
      }
    }
  }
  const candidates = [...matches.values()].sort((left, right) => right.score - left.score
    || compare(left.id, right.id) || compare(left.version, right.version));
  const [requestSha256, catalogSha256] = await Promise.all([digestJson(request), digestJson(catalog)]);
  const payload = {
    planningContextVersion: supportsProgress ? '0.5' : supportsLayout ? '0.4' : supportsControls ? '0.3' : assetRetrieval ? '0.2' : '0.1', request, requestSha256, catalog, catalogSha256, candidates,
    ...(supportsControls ? { assetRetrieval: assetRetrieval ?? null } : assetRetrieval ? { assetRetrieval } : {}),
    capabilities: {
      rowKinds: supportsProgress ? ['slider', 'switch', 'select', 'button', 'text', 'progress'] : supportsLayout ? ['slider', 'switch', 'select', 'button', 'text'] : supportsControls ? ['slider', 'switch', 'select', 'button'] : ['slider', 'switch'],
      layout: supportsLayout ? 'flow-containers-v1' : 'fixed-viewport-stacks', target: 'pixi',
      naturalLanguageInterpreter: 'external-agent', semanticReview: 'NOT_RUN',
      ...(supportsControls ? { panelSpecVersions: supportsProgress ? ['0.1', '0.2', '0.3', '0.4', '0.5'] : supportsLayout ? ['0.1', '0.2', '0.3', '0.4'] : ['0.1', '0.2', '0.3'], actions: ['emit', 'reset-initial'] } : {}),
    },
  };
  return { ...payload, sha256: await digestJson(payload) };
}

/** Recompute embedded evidence. External library membership requires build-time revalidation. */
export async function validatePlanningContext(input) {
  const context = snapshotJson(input);
  if (!context || typeof context !== 'object' || Array.isArray(context)) fail('object', '$', 'must be an object');
  if (!['0.1', '0.2', '0.3', '0.4', '0.5'].includes(context?.planningContextVersion)) fail('context-version', '$.planningContextVersion', 'only planning context 0.1 through 0.5 are supported');
  exactObject(context, ['planningContextVersion', 'request', 'requestSha256', 'catalog', 'catalogSha256', 'candidates', 'capabilities', 'sha256', ...(context.planningContextVersion !== '0.1' ? ['assetRetrieval'] : [])], '$');
  const expected = await createPlanningContext(context.request, context.catalog, context.assetRetrieval);
  if (canonicalJson(context) !== canonicalJson(expected)) fail('context-mismatch', '$', 'PLANNING_CONTEXT_MISMATCH: generated fields do not match the request and catalog');
  return expected;
}
