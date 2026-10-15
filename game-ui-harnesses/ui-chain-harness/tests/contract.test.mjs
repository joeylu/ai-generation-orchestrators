import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplate } from '../src/templates/contract.mjs';
import { deriveCatalog, deriveModelProjection, deriveOverview } from '../src/templates/catalog.mjs';
import { clone, small, extended } from './helpers.mjs';

test('baseline and content extensions are valid without implementation changes', () => {
  for (const spec of [clone(),small(),extended()]) assert.deepEqual(validateTemplate(spec),[]);
});

const cases = [
  ['duplicate stable asset ID', s => { s.sheets[0].parts[1].assetId = 'surface.panel'; }, '/sheets/0/parts/1/assetId', 'identity.duplicate'],
  ['duplicate sheet ID', s => { s.sheets[1].id = 'S01'; }, '/sheets/1/id', 'identity.duplicate'],
  ['duplicate filename prefix', s => { s.sheets[1].filePrefix = s.sheets[0].filePrefix; }, '/sheets/1/filePrefix', 'identity.duplicate'],
  ['unsafe filename', s => { s.sheets[0].filePrefix = '../bad'; }, '/sheets/0/filePrefix', 'schema.pattern'],
  ['unknown field', s => { s.sheets[0].parts[0].raduis = 10; }, '/sheets/0/parts/0/raduis', 'schema.additionalProperties'],
  ['unknown primitive', s => { s.sheets[0].parts[0].primitive = { type: 'star' }; }, '/sheets/0/parts/0/primitive', 'schema.oneOf'],
  ['non-square canvas', s => { s.coordinates.height = 1025; }, '/coordinates/height', 'canvas.square'],
  ['excessive pixel dimensions', s => { s.coordinates.width = s.coordinates.height = 2048; s.coordinates.outputScale = 4; }, '/coordinates/outputScale', 'canvas.limit'],
  ['out-of-bounds slot', s => { s.sheets[0].parts[0].slotRect[0] = 31; }, '/sheets/0/parts/0/slotRect', 'geometry.bounds'],
  ['overlapping slots', s => { s.sheets[0].parts[1].slotRect = [...s.sheets[0].parts[0].slotRect]; }, '/sheets/0/parts/1/slotRect', 'geometry.overlap'],
  ['insufficient body padding', s => { s.sheets[0].parts[0].bodyRect[0] = 33; }, '/sheets/0/parts/0/bodyRect', 'geometry.padding'],
  ['unknown consumer', s => { s.sheets[0].parts[0].consumers = ['Missing']; }, '/sheets/0/parts/0/consumers/0', 'reference.consumer'],
  ['unknown color', s => { s.sheets[0].parts[0].paint = 'missing'; }, '/sheets/0/parts/0/paint', 'reference.paint'],
  ['missing state member', s => { s.sheets[1].parts.splice(1,1); }, '/stateGroups/0/assetIds/1', 'reference.asset'],
  ['state geometry mismatch', s => { s.sheets[1].parts[1].bodyRect[2] -= 8; }, '/stateGroups/0/assetIds/1', 'state.geometry'],
  ['state alignment mismatch', s => { s.sheets[1].parts[1].bodyRect[0] += 2; }, '/stateGroups/0/assetIds/1', 'state.geometry'],
  ['repeated state', s => { s.sheets[1].parts[1].state = 'normal'; }, '/stateGroups/0/assetIds/1', 'state.duplicate'],
  ['polygon point outside body', s => { s.sheets[3].parts[3].primitive.points[0][0] = 999; }, '/sheets/3/parts/3/primitive/points/0', 'geometry.point'],
  ['degenerate polygon', s => { s.sheets[3].parts[3].primitive.points = [[0,0],[1,1],[2,2]]; }, '/sheets/3/parts/3/primitive/points', 'geometry.area'],
  ['empty ring', s => { s.sheets[3].parts[4].strokeWidth = 0; }, '/sheets/3/parts/4/strokeWidth', 'geometry.stroke'],
  ['collapsed content area', s => { s.sheets[0].parts[0].contentInsets = [448,0,0,0]; }, '/sheets/0/parts/0/contentInsets', 'geometry.insets'],
];
for (const [title, change, path, code] of cases) test(title, () => {
  const spec = clone(); change(spec);
  const issues = validateTemplate(spec);
  assert.ok(issues.some(e => e.path === path && e.code === code),JSON.stringify(issues));
});

test('one JSON extension reaches catalog, tables, model projection and consumer index', () => {
  const spec = extended(), catalog = deriveCatalog(spec,'example-digest');
  assert.equal(catalog.sheetCount,5); assert.equal(catalog.partCount,31);
  assert.ok(catalog.consumerIndex.Panel.includes('surface.extra'));
  assert.ok(deriveOverview(catalog).includes('| E01 | surface.extra |'));
  assert.equal(deriveModelProjection(spec,'example-digest').sheets[4].parts[0].assetId,'surface.extra');
  assert.equal(catalog.unresolvedPolicyCount,3);
  assert.equal(catalog.assets[0].sliceInsets,null);
});
