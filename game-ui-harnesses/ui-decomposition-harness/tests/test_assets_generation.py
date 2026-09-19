from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import base64
import json
from PIL import Image
from test_assets_cli import FixtureProvider
from ai_ui_decomposition import batch, planning, assets_generation as generation
from ai_ui_decomposition.common import digest, read_json, write_json, ContractError
from ai_ui_decomposition.material_preflight import check_batch
from ai_ui_decomposition.process import process


class AssetsGenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        Image.new('RGB',(64,48),'blue').save(self.root/'reference.png')
        self.provider=FixtureProvider()
        planning.materialize(self.provider.plan(),self.root,[64,48],2,output_format='png_zip')
        self.plan=read_json(self.root/'plan.json')
        batch.freeze(self.root/'plan.json',self.root/'workspace','test',material_preflight='after-generation-v1')
        self.run=self.root/'workspace/runs/test'

    def tearDown(self):self.temp.cleanup()

    def authorize(self):return generation.authorize(self.run,digest(self.plan),'Explicit offline fixture approval')

    def receive_all(self,bad_first=False):
        response=generation.exchange(self.run);index=0
        while response['nextRequest']:
            request=response['nextRequest'];directory=self.run/'assets-exchange'/request['asset']
            raw=self.provider.generate(directory,state_dir=self.root/f'fixture-{index}',timeout=60)
            if bad_first and index==0:Image.new('RGB',(3,3),'blue').save(raw)
            response=generation.exchange(self.run,request['requestDigest'],raw);index+=1
        return response

    def test_authorization_and_single_use_pending_request(self):
        with self.assertRaisesRegex(ContractError,'NOT_AUTHORIZED'):generation.exchange(self.run)
        with self.assertRaisesRegex(ContractError,'PLAN_CHANGED'):generation.authorize(self.run,'0'*64,'fixture')
        self.authorize();request=generation.exchange(self.run)['nextRequest']
        with self.assertRaisesRegex(ContractError,'NO_RESUBMIT'):generation.exchange(self.run)
        with self.assertRaisesRegex(ContractError,'REQUEST_MISMATCH'):generation.exchange(self.run,'0'*64,self.root/'reference.png')
        batch.indeterminate(self.run,request['asset'],'fixture interruption')
        self.assertEqual(generation.status(self.run)['status'],'failed_no_resubmit')
        with self.assertRaisesRegex(ContractError,'NO_RESUBMIT'):generation.exchange(self.run)

    def test_complete_batch_stops_before_processing_and_review(self):
        self.authorize();result=self.receive_all()
        self.assertEqual(result['status']['status'],'generation_complete')
        self.assertEqual(self.provider.calls,2)
        self.assertFalse((self.run/'materials').exists())
        with self.assertRaises(ContractError):process(self.run)
        self.assertEqual(check_batch(None,self.run,self.root/'quality.json')['status'],'passed')
        self.assertEqual(process(self.run)['count'],2)
        self.assertFalse((self.run/'review.json').exists())
        with self.assertRaises(ContractError):generation.authorize(self.run,digest(self.plan),'again')
        self.assertIsNone(generation.exchange(self.run)['nextRequest'])

    def test_quality_is_reported_after_all_images_without_bypass(self):
        self.authorize();self.receive_all(bad_first=True)
        self.assertEqual(self.provider.calls,2)
        report=check_batch(None,self.run,self.root/'quality.json')
        self.assertEqual((report['checked'],report['failed']),(2,1))
        with self.assertRaises(ContractError):process(self.run)
        self.assertFalse((self.run/'materials').exists())

    def test_changed_source_blocks_further_dispatch(self):
        self.authorize();self.receive_all()
        frozen,_=batch.load(self.run);key=frozen['dispatch_order'][0]
        (self.run/'requests'/frozen['requests'][key]['id']/'raw.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ContractError,'RESULT_CHANGED'):generation.status(self.run)

    def test_export_rejects_nonexistent_provider_source_root_before_writing(self):
        self.authorize()
        entry=self.root/'entry/run.js'
        with self.assertRaisesRegex(ContractError,'LOOP_EXPORT_SOURCE_ROOT_MISSING'):
            generation.export_loop(self.run,entry,self.root/'imaginary-provider-output')
        self.assertFalse(entry.parent.exists())
        self.assertFalse((self.run/'assets-exchange').exists())

    @unittest.skipUnless(shutil.which('powershell') and shutil.which('node'),'Windows host fixture')
    def test_returned_response_recovery_does_not_regenerate_pending_asset(self):
        self.authorize();request=generation.exchange(self.run)['nextRequest']
        session=self.root/'agent-session';session.mkdir()
        raw=session/'reference.png';shutil.copyfile(self.root/'reference.png',raw)
        Image.new('RGB',(1024,1024),'blue').save(raw,compress_level=0)
        response=self.root/'returned.json'
        event=dict(event='tool-returned',requestDigest=request['requestDigest'],response=dict(
            image_url='data:image/png;base64,'+base64.b64encode(raw.read_bytes()).decode(),
            output_hint=f'Fixture saved as {raw} by default.'))
        write_json(response,event)
        self.assertGreater(response.stat().st_size,2_097_152)
        entry=self.root/'recovery'
        generation.export_loop(self.run,entry/'run.js',self.root,returned_response=response,output_root_mode='session-child')
        # A changed response after export cannot receive or dispatch any request.
        event['toolMs']=1;response.write_text(json.dumps(event),encoding='utf-8')
        result=subprocess.run([shutil.which('node'),str(Path(__file__).with_name('generation-loop-entry-fixture.mjs')),
            str(entry/'run.js'),str(raw),str(entry)],capture_output=True,text=True,timeout=120)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('LOOP_RECOVERY_RESPONSE_CHANGED',result.stderr)
        self.assertEqual(generation.status(self.run)['assignedCalls'],1)
        self.assertFalse((entry/'journal').exists())
        fresh=self.root/'recovery-verified'
        generation.export_loop(self.run,fresh/'run.js',self.root,returned_response=response,output_root_mode='session-child')
        result=subprocess.run([shutil.which('node'),str(Path(__file__).with_name('generation-loop-entry-fixture.mjs')),
            str(fresh/'run.js'),str(raw),str(fresh)],capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(read_json(fresh/'entry-result.json')['simulatedCalls'],1)
        self.assertEqual(generation.status(self.run)['status'],'generation_complete')
        with self.assertRaisesRegex(ContractError,'LOOP_RECOVERY_NOT_WAITING'):
            generation.export_loop(self.run,self.root/'again/run.js',self.root,returned_response=response)

    @unittest.skipUnless(shutil.which('powershell') and shutil.which('node'),'Windows host fixture')
    def test_exported_loop_runs_unchanged_without_component_workflow(self):
        self.authorize();entry=self.root/'entry';entry.mkdir()
        result=generation.export_loop(self.run,entry/'run.js',self.root)
        self.assertEqual(result['generationCalls'],0)
        self.assertFalse((self.run/'assets-exchange').exists())
        source=(entry/'run.js').read_text(encoding='utf-8')
        self.assertIn('"product": "assets"',source)
        # Same raw fixture returned twice; deferred QA, not the loop, decides quality.
        result=subprocess.run([shutil.which('node'),str(Path(__file__).with_name('generation-loop-entry-fixture.mjs')),
            str(entry/'run.js'),str(self.root/'reference.png'),str(entry)],capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        report=read_json(entry/'entry-result.json')
        self.assertEqual(report['simulatedCalls'],2)
        self.assertEqual(report['providerCalls'],0)
        self.assertEqual(generation.status(self.run)['status'],'generation_complete')
        self.assertFalse((self.run/'materials').exists())
        with self.assertRaises(ContractError):generation.export_loop(self.run,entry/'again.js',self.root)


if __name__=='__main__':unittest.main()
