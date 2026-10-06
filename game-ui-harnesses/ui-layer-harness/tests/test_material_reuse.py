"""Fixture-only reuse contracts; no models or external services."""
import _bootstrap
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from jsonschema import ValidationError
from ai_ui_layers import material_reuse as reuse


class MaterialReuseTests(unittest.TestCase):
    def setUp(self):
        self.doc = dict(kind=reuse.KIND, referenceSha256='a'*64, sourcePlanSha256='b'*64,
            groups=[dict(prototypeMaterialId='p', instanceMaterialIds=['i', 'j'], evidence='Explicit user reuse declaration; review required.')])
        self.visual = dict(materials=[dict(id=k, role='foreground', preserveText=[]) for k in ('p', 'i', 'j', 'x')],
            objects=[dict(id=k+'-whole', materialId=k, kind='card', bboxNorm=None) for k in ('p', 'i', 'j', 'x')])

    def test_filter_keeps_geometry_and_all_visual_materials(self):
        plan = dict(assets=[dict(id=k) for k in ('p', 'i', 'j', 'x')], nodes=['p', 'i', 'j', 'x'], placements=[{'id':'i'}])
        result = reuse.selected_plan(self.visual, plan, reuse.validate(self.doc, self.visual, 'a'*64, 'b'*64))
        self.assertEqual([a['id'] for a in result['assets']], ['p', 'x'])
        self.assertEqual(result['nodes'], plan['nodes']); self.assertEqual(result['placements'], plan['placements'])
        self.assertEqual(reuse.expanded_ids(self.doc, ['p', 'x']), ['p', 'i', 'j', 'x'])
        self.assertEqual(len(self.visual['materials']), 4)

    def test_singleton_raw_gate_precedes_instance_review(self):
        from ai_ui_layers import reuse_image_review
        from ai_ui_layers.evaluate import digest,read
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            base=Path(temporary);raw=base/'clipped.png'
            image=Image.new('RGBA',(20,20));image.putpixel((0,10),(80,90,100,255));image.save(raw)
            with patch.object(reuse_image_review,'prepare_sheet_review') as reviewer:
                with self.assertRaisesRegex(ValueError,'MATERIAL_GATE_FAILED'):
                    reuse_image_review.prepare(base,{'materialReuseSha256':'a'*64},
                        {'asset':'p','outputSize':[10,10]},self.visual,raw,{'rawSha256':digest(raw)},
                        {'digest':'b'*64},base/'prepared',self.doc)
                reviewer.assert_not_called()
            self.assertIn('POSSIBLY_CLIPPED_SOURCE',read(base/'prepared/processed/report.json')['issues'])

    def test_reject_source_binding_and_unknown(self):
        with self.assertRaises(ValueError): reuse.validate(self.doc, self.visual, 'c'*64, 'b'*64)
        self.doc['groups'][0]['instanceMaterialIds'] = ['unknown']
        with self.assertRaises(ValueError): reuse.validate(self.doc, self.visual, 'a'*64, 'b'*64)

    def test_reject_chains_duplicates_and_geometry(self):
        for ids in (['p'], ['i', 'i']):
            doc = deepcopy(self.doc); doc['groups'][0]['instanceMaterialIds'] = ids
            with self.assertRaises(ValueError): reuse.validate(doc, self.visual, 'a'*64, 'b'*64)
        doc = deepcopy(self.doc); doc['groups'].append(dict(prototypeMaterialId='i', instanceMaterialIds=['x'], evidence='chain'))
        with self.assertRaises(ValueError): reuse.validate(doc, self.visual, 'a'*64, 'b'*64)
        doc = deepcopy(self.doc); doc['groups'][0]['transform'] = 'scale'
        with self.assertRaises(ValueError): reuse.validate(doc, self.visual, 'a'*64, 'b'*64)

    def test_reject_unsupported_material_contracts(self):
        for field, value in [('role', 'background'), ('adaptationPolicy', 'simple-strip'), ('preserveText', ['logo'])]:
            visual = deepcopy(self.visual); visual['materials'][1][field] = value
            with self.assertRaises(ValueError): reuse.validate(self.doc, visual, 'a'*64, 'b'*64)
        for field, value in [('kind', 'badge'), ('bboxNorm', [0,0,1,1])]:
            visual = deepcopy(self.visual); visual['objects'][1][field] = value
            with self.assertRaises(ValueError): reuse.validate(self.doc, visual, 'a'*64, 'b'*64)

    def test_independent_reuse_audit_required(self):
        answer = dict(reuseAudit=[dict(prototypeMaterialId='p', instanceMaterialIds=['i','j'], equivalent=True, evidence='Fixture independent comparison confirms both instances.')])
        reuse.validate_review(answer, self.doc)
        for rows in ([], answer['reuseAudit']*2):
            with self.assertRaises(ValidationError): reuse.validate_review(dict(reuseAudit=rows), self.doc)
        with self.assertRaises(ValidationError): reuse.validate_review({}, self.doc)
        answer['reuseAudit'][0]['equivalent'] = False
        with self.assertRaises(ValueError): reuse.validate_review(answer, self.doc)

    def test_identity_copy_preserves_png_bytes_and_alpha(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); prototype = root/'prototype.png'
            image = Image.new('RGBA', (2,2), (8,16,24,0)); image.putpixel((1,1), (30,50,70,97)); image.save(prototype)
            original = prototype.read_bytes(); lineage = {'p': {'rawSha256':'c'*64, 'sourceBox':[0,0,2,2]}}
            result = reuse.derive(self.doc, {'p':str(prototype)}, root/'derived', lineage)
            for mid in ('i','j'):
                self.assertEqual(Path(result['materials'][mid]).read_bytes(), original)
                with Image.open(result['materials'][mid]) as copied: self.assertEqual(copied.getpixel((1,1))[3],97)
            self.assertNotEqual(result['materials']['i'], result['materials']['j'])
            self.assertEqual(result['records'][0]['lineage'], lineage['p'])
            self.assertNotIn('receipt', result['records'][0])
            self.assertEqual(result['records'][0]['outputSha256'], result['records'][0]['prototypeSourceSha256'])
            with self.assertRaises(ValueError): reuse.derive(self.doc, {'p':str(prototype)}, root/'derived', lineage)

    def test_invalid_png_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root/'source.gif'; Image.new('RGB',(2,2)).save(source)
            with self.assertRaises(ValueError): reuse.derive(self.doc, {'p':str(source)}, root/'output', {'p':{}})
            self.assertFalse((root/'output').exists())

    def test_reject_empty_groups_extra_fields_and_unsafe_ids(self):
        for groups in ([], [dict(self.doc['groups'][0], instanceMaterialIds=[])],
                       [dict(self.doc['groups'][0], instanceMaterialIds=['../escape'])],
                       [dict(self.doc['groups'][0], instanceMaterialIds=['i:stream'])]):
            doc = deepcopy(self.doc); doc['groups'] = groups
            with self.assertRaises(ValueError): reuse.validate(doc, self.visual, 'a'*64, 'b'*64)
        doc = dict(self.doc, geometry='stretch')
        with self.assertRaises(ValueError): reuse.validate(doc, self.visual, 'a'*64, 'b'*64)

    def test_reject_missing_whole_bbox_and_duplicate_assets(self):
        visual = deepcopy(self.visual); del visual['objects'][1]['bboxNorm']
        with self.assertRaises(ValueError): reuse.validate(self.doc, visual, 'a'*64, 'b'*64)
        plan = dict(assets=[dict(id=k) for k in ('p','i','j','x','p')])
        with self.assertRaises(ValueError): reuse.selected_plan(self.visual, plan, self.doc)

    def test_reject_opaque_empty_alpha_and_existing_instance_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root/'source.png'
            for mode, color in [('RGB',(1,2,3)), ('RGBA',(1,2,3,255)), ('RGBA',(0,0,0,0))]:
                Image.new(mode,(2,2),color).save(source)
                with self.assertRaises(ValueError): reuse.derive(self.doc, {'p':str(source)}, root/'output', {'p':{}})
                self.assertFalse((root/'output').exists())
            image = Image.new('RGBA',(2,2)); image.putpixel((1,1),(1,2,3,100)); image.save(source)
            with self.assertRaises(ValueError): reuse.derive(self.doc, {'p':str(source),'i':str(source)}, root/'output', {'p':{}})
            self.assertFalse((root/'output').exists())


if __name__ == '__main__':
    unittest.main()
