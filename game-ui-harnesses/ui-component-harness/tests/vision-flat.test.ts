import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDocument, fixtureStyle } from '../src/fixtures.ts';
import { compileVisionResult } from '../src/studio-vision.ts';
import { FLAT_LAYOUT_DESCRIPTION, normalizeFlatVisionResult } from '../src/vision-flat.ts';
import { walkNodes, type UiNode } from '../src/tree-contract.ts';

const source = { path: 'assets/reference.png', sha256: 'a'.repeat(64), width: 1024, height: 768 };
const style = { id: 'base', ...fixtureStyle };

function flatNode(id: string, parentId: string | null, componentType: string, props: Record<string, unknown>, layout = { x: 0, y: 0, width: 100, height: 40 }) {
  return { id, parentId, componentType, styleId: 'base', props, layout };
}

function basic() {
  return {
    version: '0.2', sourceSha256: source.sha256, status: 'Ready',
    summary: 'A supplied flat layout contains an image and a caption.',
    classification: 'composite', observedTypes: ['Container', 'Image', 'Text'],
    documentId: 'flat-reference', canvas: { width: 320, height: 180 }, styles: [style], nodes: [
      flatNode('root', null, 'Container', {}, { x: 0, y: 0, width: 320, height: 180 }),
      flatNode('image', 'root', 'Image', { source: source.path, fit: 'contain' }, { x: 8, y: 8, width: 128, height: 128 }),
      flatNode('caption', 'root', 'Text', { text: 'Reference', wrap: 'none', overflow: 'clip', lineHeight: 20 }, { x: 144, y: 8, width: 168, height: 24 }),
    ],
  };
}

function flattenAllTypes() {
  const document = fixtureDocument('gallery');
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (node: UiNode, parentId: string | null) => {
    const props = structuredClone(node.props) as Record<string, unknown>;
    delete props.style;
    if (node.type === 'Image') props.source = source.path;
    nodes.push(flatNode(node.id, parentId, node.type, props, structuredClone(node.layout)));
    if ('children' in node) node.children.forEach(child => visit(child, node.id));
  };
  visit(document.root, null);
  const observedTypes = [...new Set(nodes.map(node => node.componentType))];
  return {
    version: '0.2', sourceSha256: source.sha256, status: 'Ready', summary: 'A procedural all-component flat fixture.',
    classification: 'composite', observedTypes, documentId: 'flat-gallery', canvas: structuredClone(document.canvas), styles: [style], nodes,
  };
}

test('flat responses expand explicit reused styles and preserve wire sibling order', () => {
  const value = basic();
  const normalized = normalizeFlatVisionResult(value, source);
  assert.equal(normalized.status, 'Ready');
  if (normalized.status !== 'Ready') return;
  assert.equal(normalized.policy.layoutSource.kind, 'measured');
  assert.equal(normalized.policy.layoutSource.description, FLAT_LAYOUT_DESCRIPTION);
  assert.deepEqual(normalized.intent.root.children.map(node => node.id), ['image', 'caption']);
  assert.deepEqual(normalized.intent.root.children[0].props.style, fixtureStyle);
  assert.equal(normalized.intent.root.children[0].props.source, source.path);
  assert.equal(value.nodes[1].props.style, undefined);
  const result = compileVisionResult(normalized, source);
  assert.equal(result.status, 'Ready');
});

test('a flat gallery compiles every supported semantic component type', () => {
  const normalized = normalizeFlatVisionResult(flattenAllTypes(), source);
  const result = compileVisionResult(normalized, source);
  assert.equal(result.status, 'Ready');
  if (result.status !== 'Ready') return;
  assert.equal(new Set(walkNodes(result.document).map(node => node.type)).size, 16);
});

test('missing props are rejected instead of being filled from defaults', () => {
  const value = basic();
  value.classification = 'control'; value.observedTypes = ['Button'];
  value.nodes = [flatNode('submit', null, 'Button', { label: 'Submit' })];
  assert.throws(() => normalizeFlatVisionResult(value, source));
});

test('hierarchy and style references expose stable failure codes', () => {
  const unknownParent = basic(); unknownParent.nodes[1].parentId = 'missing';
  assert.throws(() => normalizeFlatVisionResult(unknownParent, source), /VISION_UNKNOWN_PARENT/);
  const unknownStyle = basic(); unknownStyle.nodes[1].styleId = 'missing';
  assert.throws(() => normalizeFlatVisionResult(unknownStyle, source), /VISION_UNKNOWN_STYLE/);
  const cycle = basic();
  cycle.nodes = [
    flatNode('root', null, 'Container', {}),
    flatNode('first', 'second', 'Container', {}),
    flatNode('second', 'first', 'Container', {}),
  ];
  cycle.observedTypes = ['Container'];
  assert.throws(() => normalizeFlatVisionResult(cycle, source), /VISION_TREE_CYCLE/);
  const multipleRoots = basic(); multipleRoots.nodes[1].parentId = null;
  assert.throws(() => normalizeFlatVisionResult(multipleRoots, source), /VISION_MULTIPLE_ROOTS/);
  const leafParent = basic(); leafParent.nodes[2].parentId = 'image';
  assert.throws(() => normalizeFlatVisionResult(leafParent, source), /VISION_PARENT_NOT_COMPOSITE/);
});

test('flat envelopes reject malformed fields and hidden style or child channels', () => {
  const extra = { ...basic(), providerSecret: 'forbidden' };
  assert.throws(() => normalizeFlatVisionResult(extra, source));
  const hiddenStyle = basic(); hiddenStyle.nodes[1].props.style = fixtureStyle;
  assert.throws(() => normalizeFlatVisionResult(hiddenStyle, source));
  const extraNodeField = basic(); (extraNodeField.nodes[1] as Record<string, unknown>).children = [];
  assert.throws(() => normalizeFlatVisionResult(extraNodeField, source));
});

test('image sources bind to decoded facts and text cannot introduce a font resource', () => {
  const wrongImage = basic(); wrongImage.nodes[1].props.source = 'assets/other.png';
  assert.throws(() => normalizeFlatVisionResult(wrongImage, source), /VISION_UNAVAILABLE_RESOURCE/);
  const font = basic(); font.nodes[2].props.fontSource = 'assets/font.woff2';
  assert.throws(() => normalizeFlatVisionResult(font, source), /VISION_UNAVAILABLE_RESOURCE/);
});

test('observations and classifications must agree with the provided nodes', () => {
  const mismatch = basic(); mismatch.observedTypes = ['Button'];
  assert.throws(() => normalizeFlatVisionResult(mismatch, source), /VISION_SEMANTIC_COVERAGE_MISMATCH/);
  const omitted = basic(); omitted.observedTypes = ['Container', 'Image'];
  assert.throws(() => normalizeFlatVisionResult(omitted, source), /VISION_SEMANTIC_COVERAGE_MISMATCH/);
  const allImage = basic(); allImage.classification = 'text'; allImage.observedTypes = ['Image'];
  allImage.nodes = [flatNode('image', null, 'Image', { source: source.path, fit: 'contain' })];
  assert.throws(() => normalizeFlatVisionResult(allImage, source), /VISION_IMAGE_FALLBACK/);
});

test('a standalone composite node is valid without invented child nodes', () => {
  const value = basic();
  value.observedTypes = ['Panel']; value.nodes = [flatNode('panel', null, 'Panel', { title: 'Settings' })];
  const normalized = normalizeFlatVisionResult(value, source);
  assert.equal(normalized.status, 'Ready');
  if (normalized.status === 'Ready') assert.deepEqual(normalized.intent.root.children, []);
});

test('every declared style is referenced and therefore receives strict style validation', () => {
  const value = basic();
  value.styles = [style, { ...style, id: 'unused', opacity: 2 }];
  assert.throws(() => normalizeFlatVisionResult(value, source), /VISION_UNUSED_STYLE/);
});

test('observed semantics cannot be supplied only by an invisible overlay control', () => {
  const value = basic();
  value.observedTypes = ['Container', 'Image', 'Text', 'Button'];
  value.styles = [style, { ...style, id: 'hidden', opacity: 0 }];
  value.nodes.push({ ...flatNode('overlay', 'root', 'Button', { label: 'Hidden action', enabled: true }, { x: 0, y: 0, width: 320, height: 180 }), styleId: 'hidden' });
  assert.throws(() => normalizeFlatVisionResult(value, source), /VISION_HIDDEN_SEMANTIC_NODE/);
});

test('an invisible ancestor prevents its observed descendant from establishing semantics', () => {
  const value = basic();
  value.observedTypes = ['Container', 'Image', 'Text', 'Switch'];
  value.styles = [style, { ...style, id: 'hidden', opacity: 0 }];
  value.nodes.push(
    { ...flatNode('hidden-group', 'root', 'Container', {}), styleId: 'hidden' },
    flatNode('hidden-switch', 'hidden-group', 'Switch', { label: 'Hidden setting', checked: false, enabled: true }),
  );
  assert.throws(() => normalizeFlatVisionResult(value, source), /VISION_HIDDEN_SEMANTIC_NODE/);
});

test('opaque observed controls and standalone artwork remain valid', () => {
  const control = basic();
  control.classification = 'control'; control.observedTypes = ['Button'];
  control.nodes = [flatNode('button', null, 'Button', { label: 'Continue', enabled: true })];
  assert.equal(normalizeFlatVisionResult(control, source).status, 'Ready');

  const artwork = basic();
  artwork.classification = 'artwork'; artwork.observedTypes = ['Image'];
  artwork.nodes = [flatNode('image', null, 'Image', { source: source.path, fit: 'contain' })];
  assert.equal(normalizeFlatVisionResult(artwork, source).status, 'Ready');
});

test('non-ready outcomes normalize without an intent, policy, or rendering path', () => {
  const value = { version: '0.2', sourceSha256: source.sha256, status: 'Unresolved', summary: 'The reference does not establish the component semantics.' };
  assert.deepEqual(normalizeFlatVisionResult(value, source), { ...value, version: '0.1' });
  assert.throws(() => normalizeFlatVisionResult({ ...value, nodes: [] }, source));
});

test('flat hierarchy rejects depth and total-node overflows before tree assembly', () => {
  const tooDeep = basic();
  tooDeep.nodes = Array.from({ length: 33 }, (_, index) => flatNode(`depth${index}`, index === 0 ? null : `depth${index - 1}`, 'Container', {}));
  tooDeep.observedTypes = ['Container'];
  assert.throws(() => normalizeFlatVisionResult(tooDeep, source));

  const tooMany = basic();
  tooMany.nodes = [
    flatNode('root', null, 'Container', {}),
    ...Array.from({ length: 1000 }, (_, index) => flatNode(`image${index}`, 'root', 'Image', { source: source.path, fit: 'contain' })),
  ];
  tooMany.observedTypes = ['Container', 'Image'];
  assert.throws(() => normalizeFlatVisionResult(tooMany, source));
});
