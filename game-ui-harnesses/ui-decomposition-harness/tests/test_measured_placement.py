import unittest
from ai_ui_decomposition.measured_placement import center_visible_in_row
from ai_ui_decomposition.common import ContractError

class PlacementTests(unittest.TestCase):
    def test_prepare_binds_materials_and_rejects_changed_spec(self):
        from pathlib import Path
        import tempfile
        from PIL import Image
        from ai_ui_decomposition import planning,batch
        from ai_ui_decomposition.process import process,read_materials
        from ai_ui_decomposition.common import read_json,write_json,sha256,digest
        from ai_ui_decomposition.measured_placement import prepare_alignment
        from test_assets_cli import FixtureProvider
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);Image.new('RGB',(64,48),'blue').save(p/'reference.png')
            planning.materialize(FixtureProvider().plan(),p,[64,48],2,output_format='png_zip')
            plan=read_json(p/'plan.json')
            for a in plan['assets']:
                f=p/(a['id']+'.png');Image.new('RGBA',tuple(a['output_size']),(20,30,40,255)).save(f)
                a.update(route='imported_material',prompt='',output_mode='opaque_canvas' if a['role']=='background' else 'rgba',material_source=dict(path=f.name,sha256=sha256(f)))
            write_json(p/'import.json',plan);batch.freeze(p/'import.json',p/'ws','source');run=p/'ws/runs/source';process(run)
            node=next(n for n in plan['nodes'] if next(a for a in plan['assets'] if a['id']==n['asset'])['role']=='important_component')
            surface=plan['nodes'][0]
            s=dict(kind='ui_assets_measured_alignment_v1',planDigest=digest(plan),materialsDigest=read_materials(run)['digest'],basis='Fixture layout accepted',alignments=[dict(node=node['id'],surfaceNode=surface['id'],row=[0,0,64,48],visibleLeft=0)])
            r=prepare_alignment(run,s,p/'good');self.assertEqual(r['generationCalls'],0)
            new=read_json(p/'good/plan.json');self.assertTrue(all(a['route']=='imported_material' for a in new['assets']))
            s['materialsDigest']='0'*64
            with self.assertRaisesRegex(ContractError,'ALIGNMENT_BINDING'):prepare_alignment(run,s,p/'bad')
            self.assertFalse((p/'bad').exists())
    def test_asymmetric_padding_uses_visible_center(self):
        self.assertEqual(center_visible_in_row([100,200,300,100],[2,10,62,70],120),[118,210])
    def test_rejects_non_fitting_and_nonfinite(self):
        for row in ([100,200,300,20],[100,float('nan'),300,100]):
            with self.assertRaises(ContractError):
                center_visible_in_row(row,[2,10,62,70],120)
