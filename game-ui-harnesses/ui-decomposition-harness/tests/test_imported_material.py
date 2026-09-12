import json
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from ai_ui_decomposition import batch
from ai_ui_decomposition.common import ContractError, sha256
from ai_ui_decomposition.contract import validate
from ai_ui_decomposition.process import process
from ai_ui_decomposition.assembly import finalize, inspect_delivery


class ImportedMaterialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        Image.new('RGBA', (16, 16), 'white').save(self.root / 'reference.png')
        icon = Image.new('RGBA', (6, 6))
        icon.putpixel((1, 4), (10, 20, 30, 100))
        icon.save(self.root / 'icon.png')
        self.plan = {'kind':'ai_ui_decomposition_plan_v1', 'id':'import-test',
            'canvas':[16,16], 'source':{'path':'reference.png', 'sha256':sha256(self.root/'reference.png'), 'size':[16,16]},
            'text_policy':'remove_ordinary_text_preserve_graphic_symbols',
            'granularity':'important_components_only', 'delivery_policy':'unreviewed_draft',
            'assets':[], 'nodes':[], 'groups':[{'id':'all', 'children':['background','icon']}],
            'document':{'name':'import-test', 'format':'png_zip'}}
        for key, file, size, role, mode in [('background','reference.png',[16,16],'background','opaque_canvas'),
                                          ('icon','icon.png',[6,6],'important_component','rgba')]:
            self.plan['assets'].append({'id':key,'role':role,'route':'imported_material',
                'source_region':[0,0,*size],'output_size':size,'output_mode':mode,
                'prompt':None,'source_asset':None,'material_source':{'path':file,'sha256':sha256(self.root/file)}})
            self.plan['nodes'].append({'id':key,'asset':key,'xy':[0,0]})

    def freeze(self):
        path = self.root/'plan.json'
        path.write_text(json.dumps(self.plan))
        return batch.freeze(path,self.root/'workspace','test')

    def test_exact_alpha_geometry_offline_and_immutable_snapshot(self):
        frozen = self.freeze()
        self.assertEqual(frozen['maximum_calls'],0)
        self.assertFalse(frozen['imported_materials']['icon']['generation_provenance_verified'])
        run = self.root/'workspace/runs/test'
        (self.root/'icon.png').unlink()  # Snapshot must stand alone.
        process(run)
        with Image.open(run/'materials/icon/material.png') as result:
            self.assertEqual(result.getpixel((1,4)), (10,20,30,100))
            self.assertEqual(result.getpixel((3,3)), (0,0,0,0))
        finalize(run,self.root/'delivery',draft=True)
        inspect_delivery(self.root/'delivery')
        Image.new('RGBA',(6,6),'red').save(run/'input/materials/icon.png')
        with self.assertRaisesRegex(ContractError,'IMPORTED_MATERIAL_CHANGED'):
            batch.load(run)

    def test_bad_digest_size_path_and_resize_rejected(self):
        import copy
        for change in [{'material_source':{'path':'icon.png','sha256':'0'*64}},
                       {'output_size':[5,5]},
                       {'material_source':{'path':'../icon.png','sha256':'0'*64}},
                       {'resize':{'mode':'nine_slice','insets':[1,1,1,1]}}]:
            plan = copy.deepcopy(self.plan)
            plan['assets'][1].update(change)
            with self.assertRaises(ContractError):
                validate(plan,source_base=self.root)
