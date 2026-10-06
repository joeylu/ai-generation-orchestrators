"""Regression fixtures for independent diagnostic export; no model/provider calls."""
import _bootstrap
import hashlib
from pathlib import Path
import unittest
import zipfile
from PIL import Image, ImageDraw

from ai_ui_layers import received_diagnostic_delivery as diagnostic
from ai_ui_layers import experimental_executor as exchange, material_reuse as reuse, host_delivery as host
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.host_material_review import files
from ai_ui_layers.viewport_geometry_revision import validate_viewport_archive, transform
import test_protected_background_host_delivery as protected_fixtures


class ReceivedDiagnosticTests(unittest.TestCase):
    def setUp(self):
        protected_fixtures.ProtectedHostDeliveryTests.setUp(self)
        for obj in self.plan['objects']:
            if obj['materialId'] in ('asset-coin-a','asset-coin-b'):
                obj.update(kind='badge',bboxNorm=None)
        protected_fixtures.fixtures.save(self.candidate,self.plan)
        self.reuse_doc = dict(kind=reuse.KIND,referenceSha256=digest(self.reference),
            sourcePlanSha256=digest(self.candidate),groups=[dict(prototypeMaterialId='asset-coin-a',
                instanceMaterialIds=['asset-coin-b'],evidence='Explicit offline fixture same-state badge.')])
        reuse_path=self.base/'reuse.json';save(reuse_path,self.reuse_doc)
        config=read(self.config_path);config['materialReuse']=str(reuse_path);protected_fixtures.fixtures.save(self.config_path,config)
        self.run=self.base/'diagnostic-fixture-host';host.prepare(self.config_path,self.run)
        self.root=self.run/'planning'
        protected_fixtures.ProtectedHostDeliveryTests.planning(self)
        self.job=self.run/'images';self.job_digest=read(self.job/'job.json')['digest']
        exchange.authorize(self.job,self.job_digest,'Offline PNG fixtures only.')
        while exchange.status(self.job)['status']!='raw_complete':
            request=exchange.next_request(self.job)
            if request['asset']=='asset-scene':
                image=Image.new('RGB',(500,500),(40,50,60))
            elif request.get('materialIds'):
                cols,rows=request['grid'];image=Image.new('RGBA',(cols*160,rows*160))
                draw=ImageDraw.Draw(image)
                for i,mid in enumerate(request['materialIds']):
                    x=i%cols*160;y=i//cols*160
                    draw.rectangle((x+25,y+25,x+135,y+135),fill=(50,100,150,255))
                # Real faint pixels in a seam and an unused cell may not be erased.
                if cols>1:image.putpixel((159,40),(1,2,3,4))
                if cols*rows>len(request['materialIds']):image.putpixel((image.width-4,image.height-4),(1,2,3,4))
            else:
                image=Image.new('RGBA',(160,160));ImageDraw.Draw(image).rectangle((20,0,139,139),fill=(80,90,100,255))
            raw=self.base/'fixture-raw.png';image.save(raw)
            exchange.receive(self.job,request['submissionDigest'],raw)
        self.viewer=self.base/'viewer'

    def test_complete_reuse_protection_wrapper_and_no_original_mutation(self):
        before=files(self.run)
        contract=self.base/'diagnostic-contract';prepared=diagnostic.prepare(self.job,self.job_digest,contract,
            'Fixture approval of complete storage and unchanged original viewport.')
        exported=self.base/'diagnostic-export'
        result=diagnostic.deliver(contract,prepared['diagnosticDigest'],exported,self.viewer)
        self.assertEqual(result['status'],'diagnostic-pending-human-review')
        for key in ('fullAutomaticDagPassed','humanVisualAcceptance','originalDagPromoted',
                    'strictBodyRegistrationPassed','materialReviewPassed','sourceCompletenessAccepted','alphaQualityAccepted'):
            self.assertFalse(result[key])
        self.assertEqual(result['modelCalls'],0);self.assertEqual(result['generationCalls'],0)
        self.assertEqual(result['layerCount'],len(self.plan['materials']))
        self.assertEqual(result['backgroundProtection']['protectedChangedPixels'],0)
        self.assertEqual((exported/'materials/asset-scene.png').read_bytes(),
                         (exported/'protected-background/candidate.png').read_bytes())
        self.assertEqual(len(result['reuseDerivations']),1)
        self.assertEqual(result['reuseDerivations'][0]['prototypeMaterialId'],'asset-coin-a')
        self.assertEqual(files(self.run),before)
        validated=validate_viewport_archive(exported/'delivery/viewport-ui-layers.zip')
        self.assertEqual(validated['sha256'],result['viewportArchive']['sha256'])
        with zipfile.ZipFile(exported/'diagnostic-sources.zip') as z:
            for row in read(self.job/'snapshot/requests.json')['requests']:
                key=row['asset'];raw=(self.job/'attempts'/key/'raw.png').read_bytes()
                self.assertEqual(z.read('raw/'+key+'.png'),raw)
        for split in result['sheetPartitions']:
            rebuilt=None
            with Image.open(self.job/'attempts'/split['requestId']/'raw.png') as image:
                original=image.convert('RGBA');rebuilt=Image.new('RGBA',original.size)
                for i,box in enumerate(split['partitionBoxes']):
                    path=exported/'source-evidence/cells'/(split['requestId']+'-cell-'+str(i)+'.png')
                    with Image.open(path) as cell:rebuilt.paste(cell,box[:2])
                self.assertEqual(original.tobytes(),rebuilt.tobytes())

    def test_bound_raw_tamper_rejected_before_creating_export(self):
        contract=self.base/'bound-contract';prepared=diagnostic.prepare(self.job,self.job_digest,contract,'Fixture viewport approval.')
        raw=self.job/'attempts'/read(self.job/'job.json')['assets'][0]/'raw.png'
        raw.write_bytes(raw.read_bytes()+b'changed fixture')
        with self.assertRaisesRegex(ValueError,'CHANGED'):
            diagnostic.deliver(contract,prepared['diagnosticDigest'],self.base/'must-not-exist',self.viewer)
        self.assertFalse((self.base/'must-not-exist').exists())

    def cleanup_fixture(self,received=True):
        from ai_ui_layers.material_cleanup import prepare_cleanup
        mid='asset-panel';job=self.base/'cleanup-source'
        config=prepare_cleanup(self.job/'snapshot',read(self.job/'job.json')['snapshotDigest'],job,mid,self.job)
        exchange.authorize(job,config['digest'],'Offline cleanup fixture only.')
        request=exchange.next_request(job)
        if received:
            image=Image.new('RGBA',(160,160));ImageDraw.Draw(image).rectangle((20,15,139,139),fill=(170,80,40,240))
            raw=self.base/'fixture-cleanup.png';image.save(raw)
            exchange.receive(job,request['submissionDigest'],raw)
        return dict(materialId=mid,cleanupJob=str(job),cleanupJobDigest=config['digest'])

    def test_genuine_cleanup_override_keeps_all_sources_protection_reuse_and_false_flags(self):
        selection=self.cleanup_fixture();cleanup_job=Path(selection['cleanupJob'])
        before=files(self.run);cleanup_before=files(cleanup_job)
        contract=self.base/'cleanup-contract'
        frozen=diagnostic.prepare(self.job,self.job_digest,contract,'Fixture original viewport.',[selection])
        with self.assertRaisesRegex(ValueError,'DIAGNOSTIC_CLEANUP_FOREGROUND_SINGLETON_REQUIRED'):
            diagnostic._cleanup_checked(diagnostic._checked(self.job,self.job_digest),[selection,selection])
        self.assertEqual(read(contract/'diagnostic.json')['kind'],'ui_received_diagnostic_delivery_v2')
        output=self.base/'cleanup-export'
        result=diagnostic.deliver(contract,frozen['diagnosticDigest'],output,self.viewer)
        self.assertEqual(result['layerCount'],len(self.plan['materials']))
        self.assertEqual(len(result['reuseDerivations']),1)
        self.assertEqual(result['backgroundProtection']['protectedChangedPixels'],0)
        self.assertEqual((output/'materials/asset-scene.png').read_bytes(),(output/'protected-background/candidate.png').read_bytes())
        self.assertEqual(result['cleanupReplacements'][0]['cleanupRawSha256'],digest(cleanup_job/'attempts/asset-panel/raw.png'))
        geometry=next(g for g in result['geometry'] if g['materialId']=='asset-panel')
        self.assertEqual(geometry['sourceSha256'],result['cleanupReplacements'][0]['cleanupRawSha256'])
        for k,v in diagnostic.FLAGS.items():self.assertEqual(result[k],v)
        validate_viewport_archive(output/'delivery/viewport-ui-layers.zip')
        with zipfile.ZipFile(output/'diagnostic-sources.zip') as z:
            self.assertEqual(z.read('cleanup-raw/asset-panel.png'),(cleanup_job/'attempts/asset-panel/raw.png').read_bytes())
            self.assertEqual(z.read('raw/asset-panel.png'),(self.job/'attempts/asset-panel/raw.png').read_bytes())
        self.assertEqual(before,files(self.run));self.assertEqual(cleanup_before,files(cleanup_job))

    def test_unreceived_ordinary_background_and_reused_overrides_rejected_before_output(self):
        pending=self.cleanup_fixture(received=False)
        with self.assertRaisesRegex(ValueError,'RECEIVED_REQUEST_REQUIRED'):
            diagnostic.prepare(self.job,self.job_digest,self.base/'pending-contract','Fixture viewport.',[pending])
        self.assertFalse((self.base/'pending-contract').exists())
        checked=diagnostic._checked(self.job,self.job_digest)
        ordinary=dict(materialId='asset-panel',cleanupJob=str(self.job),cleanupJobDigest=self.job_digest)
        with self.assertRaisesRegex(ValueError,'DIAGNOSTIC_CLEANUP_SOURCE_MISMATCH'):
            diagnostic._cleanup_checked(checked,[ordinary])
        for mid in ('asset-scene','asset-coin-a','asset-coin-b'):
            with self.assertRaisesRegex(ValueError,'DIAGNOSTIC_CLEANUP_FOREGROUND_SINGLETON_REQUIRED'):
                diagnostic._cleanup_checked(checked,[{**ordinary,'materialId':mid}])
        exchange.fail(Path(pending['cleanupJob']),exchange.verified(Path(pending['cleanupJob'])/'attempts/asset-panel/submission.json')['digest'],'Offline unknown fixture result')
        with self.assertRaisesRegex(ValueError,'RECEIVED_REQUEST_REQUIRED'):
            diagnostic._cleanup_checked(checked,[pending])

    def test_cleanup_override_tamper_and_other_origin_cannot_create_export(self):
        selection=self.cleanup_fixture();contract=self.base/'tamper-cleanup-contract'
        import shutil
        other=self.base/'copied-fixture-origin'
        # Copy only synthetic temporary receipt fixtures, never a production tree.
        shutil.copytree(self.job,other)
        with self.assertRaisesRegex(ValueError,'DIAGNOSTIC_CLEANUP_SOURCE_MISMATCH'):
            diagnostic.prepare(other,self.job_digest,self.base/'wrong-origin-contract','Fixture viewport.',[selection])
        self.assertFalse((self.base/'wrong-origin-contract').exists())
        frozen=diagnostic.prepare(self.job,self.job_digest,contract,'Fixture viewport.',[selection])
        raw=Path(selection['cleanupJob'])/'attempts/asset-panel/raw.png'
        raw.write_bytes(raw.read_bytes()+b'changed fixture')
        with self.assertRaisesRegex(ValueError,'CHANGED'):
            diagnostic.deliver(contract,frozen['diagnosticDigest'],self.base/'no-tamper-export',self.viewer)
        self.assertFalse((self.base/'no-tamper-export').exists())

    def test_cleanup_resolved_path_escape_rejected_before_contract_directory(self):
        selection=self.cleanup_fixture();job=Path(selection['cleanupJob'])
        linked=job/'extra-proof.txt';external=self.base/'external-proof.txt'
        linked.write_bytes(b'identical fixture bytes');external.write_bytes(linked.read_bytes())
        original=Path.resolve
        def escaped(path,*args,**kwargs):
            return original(external,*args,**kwargs) if path==linked else original(path,*args,**kwargs)
        # Model an outside symlink's resolved path without requiring Windows
        # developer mode or elevated symlink privileges in a regression test.
        from unittest.mock import patch
        contract=self.base/'must-not-freeze-escape'
        with patch.object(Path,'resolve',escaped):
            with self.assertRaisesRegex(ValueError,'HOST_EVIDENCE_PATH_ESCAPE'):
                diagnostic.prepare(self.job,self.job_digest,contract,'Fixture viewport.',[selection])
        self.assertFalse(contract.exists())


class ExpandedProxyTests(unittest.TestCase):
    def test_storage_retains_support_without_relocating_proxy_or_claiming_completeness(self):
        import tempfile
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'source.png'
            image=Image.new('RGBA',(200,100));draw=ImageDraw.Draw(image)
            draw.rectangle((40,20,159,39),fill=(60,70,80,230))
            draw.rectangle((40,40,159,99),fill=(60,70,80,1));image.save(path)
            before=path.read_bytes();owner=[100,150,220,170]
            fit=diagnostic.proxy_geometry(image,owner);rendered,geometry=transform(path,fit)
            self.assertEqual(fit['uniformScale'],1)
            self.assertEqual(fit['translation'],[60,130])
            self.assertGreater(geometry['layerCanvasRegion'][3],200)
            self.assertEqual(fit['sourceOuterBoundaryMaximumAlpha'],1)
            self.assertFalse(fit['observedBody']);self.assertFalse(fit['sourceCompletenessAccepted'])
            self.assertFalse(fit['sourceBoundaryPaddingProvesCompleteness'])
            self.assertEqual(path.read_bytes(),before)
            self.assertGreater(rendered.getchannel('A').getbbox()[3],20)


if __name__=='__main__':unittest.main()
