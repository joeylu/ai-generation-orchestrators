"""Required audit IDs cannot be replaced by duplicate or unrelated entries."""
import _bootstrap
import copy
import json
import unittest
from PIL import Image
from jsonschema import Draft202012Validator, ValidationError

from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.codex_call import transport_schema
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.planning_review_policy import split, audit_rows
from test_planning_dag import FakeModel
import test_planning_dag


class KeyedPlanningAuditTests(unittest.TestCase):
    def setUp(self):
        test_planning_dag.DagTests.setUp(self)

    def test_schema_requires_each_detailed_and_overflow_id(self):
        model=FakeModel();dag=Dag(self.root,model);dag.m1()
        plan=read(self.root/'m1/draft.json')
        for index in range(14):
            x=50+index*60
            plan['materials'].append(dict(id=f'extra-{index}',label=f'Symbol {index}',
                role='foreground',zOrder=30,bboxNorm=[x/1000,.1,(x+24)/1000,.124],preserveText=[]))
        source=self.root/'m1/draft.json';source.write_text(json.dumps(plan),encoding='utf-8')
        overlay=self.root/'overlay.png';Image.new('RGB',(1000,1000)).save(overlay)
        dag.review('m2',source,overlay)
        folder=self.root/'m2';schema=read(folder/'schema.json');answer=read(folder/'draft.json')
        focus=read(folder/'coverage-small-materials.json')
        validator=Draft202012Validator(schema);validator.validate(answer)
        # Reuse entry definitions instead of repeating the full evidence schema
        # for every ID; the optional structured-output adapter keeps the refs.
        adapted=transport_schema(schema)
        Draft202012Validator(adapted).validate(answer)
        self.assertEqual(adapted['properties'],schema['properties'])
        for field,items in [('smallMaterialAudit',focus['items']),('smallBoundaryAudit',focus['boundaryOnlyItems'])]:
            with self.subTest(field=field):
                expected={row['materialId'] for row in items}
                self.assertEqual(set(schema['properties'][field]['required']),expected)
                self.assertEqual(set(answer[field]),expected)
                missing=copy.deepcopy(answer);del missing[field][next(iter(expected))]
                with self.assertRaises(ValidationError):validator.validate(missing)
                extra=copy.deepcopy(answer);extra[field]['unrelated-id']=next(iter(extra[field].values()))
                with self.assertRaises(ValidationError):validator.validate(extra)
                legacy=copy.deepcopy(answer);legacy[field]=audit_rows(answer,field)
                with self.assertRaises(ValidationError):validator.validate(legacy)
        self.assertEqual(read(folder/'transport.json')['responseSha256'],digest(folder/'draft.json'))
        self.assertEqual(read(folder/'request.json')['inputs']['schema.json'],digest(folder/'schema.json'))

    def corrupted_model(self,duplicate):
        base=FakeModel()
        def call(folder,sid,first):
            base(folder,sid,first)
            if folder.name!='m2':return
            answer=read(folder/'draft.json');owner=next(iter(answer['smallMaterialAudit']))
            if duplicate:
                text=json.dumps(answer)
                token=json.dumps(owner)+':'
                text=text.replace(token,token+json.dumps(answer['smallMaterialAudit'][owner])+','+token,1)
            else:
                del answer['smallMaterialAudit'][owner];text=json.dumps(answer)
            (folder/'draft.json').write_text(text,encoding='utf-8')
            receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
            (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        return base,call

    def test_duplicate_json_key_stops_without_repair_or_replay(self):
        base,call=self.corrupted_model(True);dag=Dag(self.root,call)
        with self.assertRaisesRegex(ValueError,'DUPLICATE_JSON_KEY'):dag.execute()
        with self.assertRaisesRegex(ValueError,'NODE_INCOMPLETE_NO_RESUBMIT:m2'):dag.execute()
        self.assertEqual([name for name,_ in base.calls],['m1','m2'])
        self.assertFalse(read(self.root/'.dag/m2/failed.json')['automaticRetry'])
        self.assertFalse((self.root/'repair').exists());self.assertFalse((self.root/'frozen').exists())

    def test_missing_key_stops_without_repair_or_replay(self):
        base,call=self.corrupted_model(False);dag=Dag(self.root,call)
        with self.assertRaises(ValidationError):dag.execute()
        with self.assertRaisesRegex(ValueError,'NODE_INCOMPLETE_NO_RESUBMIT:m2'):dag.execute()
        self.assertEqual([name for name,_ in base.calls],['m1','m2'])
        self.assertFalse((self.root/'m2/assessment.json').exists())
        self.assertFalse((self.root/'frozen').exists())

    def test_keyed_evidence_has_same_blockers_and_retains_raw_response(self):
        plan=dict(materials=[dict(id='symbol',label='Blue loop')],objects=[])
        detailed=dict(parts=[dict(visiblePart='White glint',observedAppearance='Pale top pixels',
            planEvidenceQuote='',suggestedChange='Describe the pale glint.')],
            boundary=dict(status='clipped',evidence='Upper contour crosses candidate.'))
        boundary=dict(boundary=dict(status='uncertain',evidence='Lower contour needs source review.'))
        keyed=dict(issues=[],smallMaterialAudit={'symbol':detailed},smallBoundaryAudit={'other':boundary})
        before=copy.deepcopy(keyed)
        legacy=dict(issues=[],smallMaterialAudit=[dict(detailed,materialId='symbol')],
                    smallBoundaryAudit=[dict(boundary,materialId='other')])
        self.assertEqual(split(keyed,plan),split(legacy,plan))
        self.assertEqual(keyed,before)
        self.assertEqual([row['code'] for row in split(keyed,plan)[0]],
            ['SMALL_MATERIAL_BOUNDARY_REVIEW','UNDESCRIBED_SMALL_MATERIAL_PART','SMALL_MATERIAL_BOUNDARY_REVIEW'])

    def test_legacy_duplicate_rows_and_cross_audit_collision_still_fail(self):
        row=dict(materialId='last-symbol',boundary=dict(status='complete',evidence='Inside candidate.'))
        rows=[dict(row,materialId=f'symbol-{i}') for i in range(33)]+[row,row]
        with self.assertRaisesRegex(ValueError,'DUPLICATE_SMALL_BOUNDARY_AUDIT'):
            split(dict(issues=[],smallBoundaryAudit=rows))
        with self.assertRaisesRegex(ValueError,'DUPLICATE_SMALL_BOUNDARY_AUDIT'):
            split(dict(issues=[],smallMaterialAudit={'symbol':dict(parts=[])},
                       smallBoundaryAudit={'symbol':dict(boundary=row['boundary'])}))
        with self.assertRaisesRegex(ValueError,'KEYED_AUDIT_ID_MUST_BE_KEY'):
            split(dict(issues=[],smallBoundaryAudit={'symbol':row}))


if __name__=='__main__':unittest.main()
