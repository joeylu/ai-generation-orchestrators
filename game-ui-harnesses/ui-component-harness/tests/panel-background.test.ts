import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../src/tree-contract.ts';
import { requiredLayerDecisionFields, validateLayerPlanningEvidence } from '../src/layer-planning-evidence.ts';

const style = { backgroundColor: '#2589E3', borderColor: '#123456', borderWidth: 4, cornerRadius: 24,
  textColor: '#FFFFFF', fontFamily: 'Arial', fontSize: 16, fontWeight: 'normal', opacity: 1 };
function fixture(type: 'Container' | 'Panel' | 'Dialog', flag?: unknown) {
  return { schemaVersion: '0.2', id: 'panel-background', canvas: { width: 320, height: 260 }, root: {
    id: 'surface', type, layout: { x: 20, y: 20, width: 280, height: 220 }, children: [],
    props: { style, ...(type === 'Container' ? {} : { title: 'Surface' }),
      ...(type === 'Dialog' ? { open: true, modal: false } : {}), ...(flag === undefined ? {} : { drawBackground: flag }) },
  } };
}
for (const type of ['Container', 'Panel', 'Dialog'] as const) {
  test(`${type}: background policy is optional, strict boolean and clone-preserving`, () => {
    for (const flag of [undefined, true, false]) {
      const source = fixture(type, flag), before = JSON.stringify(source), validated = validateDocument(source);
      assert.deepEqual(validated, source); assert.notEqual(validated, source); assert.equal(JSON.stringify(source), before);
      assert.equal(Object.hasOwn(validated.root.props, 'drawBackground'), flag !== undefined);
    }
    for (const flag of ['false', 0, 1, null, {}, []]) assert.throws(() => validateDocument(fixture(type, flag)),
      (e: any) => e.issues?.some((issue: any) => issue.path === '$.root.props.drawBackground' && issue.code === 'BOOLEAN_REQUIRED'));
  });
  test(`${type}: explicit background decisions require explicit-policy evidence`, () => {
    for (const flag of [true, false]) {
      const document = validateDocument(fixture(type, flag));
      const evidence = { version: '1.0', referenceSha256: 'a'.repeat(64), responseSha256: 'b'.repeat(64), issues: [],
        findings: requiredLayerDecisionFields(document).map(field => ({ ...field,
          basis: field.pointer === '/props/drawBackground' ? 'explicit-policy' : 'observed', note: 'Programmatic policy fixture.' })) };
      assert.doesNotThrow(() => validateLayerPlanningEvidence(evidence, document));
      for (const basis of ['observed', 'inferred']) {
        const bad = structuredClone(evidence); bad.findings.find(f => f.pointer === '/props/drawBackground')!.basis = basis;
        assert.throws(() => validateLayerPlanningEvidence(bad, document), /EVIDENCE_INVALID/);
      }
      evidence.findings = evidence.findings.filter(f => f.pointer !== '/props/drawBackground');
      assert.throws(() => validateLayerPlanningEvidence(evidence, document), /EVIDENCE_INVALID/);
    }
    assert.equal(requiredLayerDecisionFields(validateDocument(fixture(type))).some(f => f.pointer === '/props/drawBackground'), false);
  });
}
