/** Explicit fixed-coordinate, read-only reference input. No game runtime or layout inference. */
import { snapshotJson } from './spec.mjs';
import { canonicalJson, digestJson } from './canonical.mjs';

const fail = code => { throw new Error(code); };
const exact = (value, keys) => {
  if (!value || Array.isArray(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) fail('FIXED_REFERENCE_FIELDS');
};
export const FIXED_REFERENCE_VERSION = 'fixed-reference-1';
export async function createFixedReferenceBundle(input, core) {
  const spec = snapshotJson(input);
  exact(spec, ['panelSpecVersion', 'id', 'title', 'canvas', 'document', 'provenance']);
  if (spec.panelSpecVersion !== FIXED_REFERENCE_VERSION || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(spec.id)
      || typeof spec.title !== 'string' || !spec.title.trim() || spec.title.length > 128) fail('FIXED_REFERENCE_ID');
  exact(spec.provenance, ['kind', 'description', 'assumptions']);
  if (!['programmatic-fixture', 'agent-authored', 'user-authored'].includes(spec.provenance.kind)
      || typeof spec.provenance.description !== 'string' || !spec.provenance.description.trim()
      || spec.provenance.description.length > 2048 || !Array.isArray(spec.provenance.assumptions)
      || spec.provenance.assumptions.length > 32 || spec.provenance.assumptions.some(value => typeof value !== 'string' || value.length > 2048)) fail('FIXED_REFERENCE_PROVENANCE');
  const document = core.validateDocument(spec.document);
  if (document.id !== spec.id || canonicalJson(document.canvas) !== canonicalJson(spec.canvas)
      || Object.keys(document).some(key => !['schemaVersion', 'id', 'canvas', 'root'].includes(key))) fail('FIXED_REFERENCE_DOCUMENT');
  function visit(node, x = 0, y = 0) {
    if (!['Container', 'Text', 'Button', 'Select', 'ProgressBar'].includes(node.type)
        || Object.keys(node.props).some(key => ['appearance', 'source', 'fontSource', 'backgroundImage', 'interaction'].includes(key))) fail('FIXED_REFERENCE_NODE');
    const box = node.layout, left = x + box.x, top = y + box.y;
    if (left < 0 || top < 0 || left + box.width > spec.canvas.width + 1e-6 || top + box.height > spec.canvas.height + 1e-6) fail('FIXED_REFERENCE_BOUNDS');
    for (const child of node.children ?? []) visit(child, left, top);
  }
  visit(document.root);
  const componentBundle = await core.createBundle(document, [], {
    kind: spec.provenance.kind === 'programmatic-fixture' ? 'programmatic-fixture' : 'user-provided',
    description: 'Explicit fixed-coordinate reference; no interactive panel session or SDK behavior. Authorship is preserved in the enclosing spec.',
  });
  const payload = { panelBundleVersion: FIXED_REFERENCE_VERSION, compilerVersion: 'fixed-reference-1.0.0', spec,
    catalog: null, state: {}, bindings: [], actions: [], selection: null, componentBundle,
    capabilities: { componentSchema: '0.2', target: 'reference-only', layout: 'explicit-fixed-coordinates', sessionRequired: false },
    verification: { contract: 'PASS', browser: 'NOT_RUN', humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' } };
  return { ...payload, sha256: await digestJson(payload) };
}
export async function validateFixedReferenceBundle(input, core) {
  const value = snapshotJson(input);
  const expected = await createFixedReferenceBundle(value.spec, core);
  if (canonicalJson(value) !== canonicalJson(expected)) fail('FIXED_REFERENCE_REPLAY_MISMATCH');
  return expected;
}
