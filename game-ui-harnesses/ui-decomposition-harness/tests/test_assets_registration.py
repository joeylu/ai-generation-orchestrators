import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from ai_ui_decomposition.common import read_json,write_json,sha256,digest,ContractError
from ai_ui_decomposition.assets_brief import compile_brief
from ai_ui_decomposition import batch
from ai_ui_decomposition.process import process
from ai_ui_decomposition.assets_registration import review
from ai_ui_decomposition.assets_cli import main
from test_assets_brief import fixture


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.p=Path(self.tmp.name)
        ref=self.p/'reference.png';Image.new('RGBA',(128,128),'blue').save(ref)
        plan,_,_=compile_brief(fixture(),dict(path='reference.png',sha256=sha256(ref),size=[128,128]))
        for a in plan['assets']:
            f=self.p/(a['id']+'.png');Image.new('RGBA',tuple(a['output_size']),'blue').save(f)
            a.update(route='imported_material',output_mode='opaque_canvas' if a['role']=='background' else 'rgba',
                     prompt='',material_source=dict(path=f.name,sha256=sha256(f)))
        write_json(self.p/'plan.json',plan);b=batch.freeze(self.p/'plan.json',self.p/'ws','test')
        self.run=self.p/'ws/runs/test';m=process(self.run)
        material=next(a for a in m['assets'] if a['asset']=='panel')
        self.s=dict(kind='ui_assets_registration_v1',planDigest=digest(plan),materialsDigest=m['digest'],
                    referenceSha256=b['source_sha256'],materialSha256=material['sha256'],node='layer-2',
                    basis='Measured synthetic row borders',landmarks=[dict(id=str(i),
                    reference=[20,20+i*25,70,10],observed=[10,10+i*25,70,10]) for i in range(3)])

    def tearDown(self):self.tmp.cleanup()

    def test_identity_and_uniform_translation_are_distinct(self):
        self.assertEqual(review(self.run,self.s)['status'],'passed')
        for r in self.s['landmarks']:r['observed'][0]+=5
        r=review(self.run,self.s)
        self.assertEqual(r['status'],'blocked');self.assertEqual(r['classification'],'uniform-transform-candidate')
        self.assertAlmostEqual(r['uniformFit']['translation'][0],-5)

    def test_internal_drift_and_unknown_fail(self):
        self.s['landmarks'][1]['observed'][1]+=10
        r=review(self.run,self.s);self.assertEqual(r['classification'],'internal-layout-drift')
        self.s['landmarks'][1]['observed']=None
        self.assertEqual(review(self.run,self.s)['classification'],'unknown-landmarks')

    def test_binding_and_invalid_measurements_reject(self):
        from copy import deepcopy
        for key in ('referenceSha256','materialSha256','planDigest','materialsDigest'):
            s=deepcopy(self.s);s[key]='0'*64
            with self.assertRaises(ContractError):review(self.run,s)
        for rect in ([0,0,-1,4],[0,0,float('nan'),4],[True,0,4,4],[99,0,4,4]):
            s=deepcopy(self.s);s['landmarks'][0]['observed']=rect
            with self.assertRaises(ContractError):review(self.run,s)

    def test_cli_check_and_finalize_gate_keep_failed_output_absent(self):
        self.s['landmarks'][1]['observed'][1]+=10
        path=self.p/'spec.json';write_json(path,self.s)
        with contextlib.redirect_stdout(io.StringIO()):
            code=main(['registration-check','--run-dir',str(self.run),'--specification',str(path),
                       '--output',str(self.p/'report.json')])
            gate=main(['finalize','--run-dir',str(self.run),'--output',str(self.p/'delivery'),
                       '--draft','--registration',str(path)])
        self.assertEqual((code,gate),(2,2));self.assertFalse((self.p/'delivery').exists())
        self.assertEqual(read_json(self.p/'report.json')['status'],'blocked')

    def test_aligned_finalize_and_changed_material(self):
        path=self.p/'spec.json';write_json(path,self.s)
        with contextlib.redirect_stdout(io.StringIO()):
            code=main(['finalize','--run-dir',str(self.run),'--output',str(self.p/'delivery'),
                       '--draft','--registration',str(path)])
        self.assertEqual(code,0)
        self.assertFalse(read_json(self.p/'delivery/delivery.json')['human_visual_acceptance'])
        from ai_ui_decomposition.process import read_materials
        material=next(a for a in read_materials(self.run)['assets'] if a['asset']=='panel')
        Image.new('RGBA',(100,100),'red').save(self.run/material['path'])
        with self.assertRaises(ContractError):review(self.run,self.s)
