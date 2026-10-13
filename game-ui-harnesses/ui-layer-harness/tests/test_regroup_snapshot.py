"""Offline source-bound regrouping and explicit new host authorization."""
import _bootstrap
from pathlib import Path
import unittest
from unittest.mock import patch
from PIL import Image, ImageDraw

from ai_ui_layers import host_delivery as host, host_layout_registration as layout
from ai_ui_layers.regroup_snapshot import regroup
from ai_ui_layers.generation_groups import COMPACT_CONTROL_POLICY, COMPACT_CONTROL_V2
from ai_ui_layers.evaluate import read,save,digest
from ai_ui_layers.freeze_visual import inspect
from ai_ui_layers.execution_preflight import preflight
import test_host_m1 as fresh
import test_host_delivery as delivery


class RegroupTests(unittest.TestCase):
    def setUp(self):
        self.f=fresh.FreshHostM1Tests();self.f.setUp();self.addCleanup(self.f.doCleanups)
        config=read(self.f.fresh_config)
        config.update(visualReviewMode='warning',bodyReviewPolicy='final-composite-first-v1',
            contextPromptVersion='v16',
            generationGroupingPolicy=COMPACT_CONTROL_POLICY,layoutPlanningPolicy=layout.PLANNING)
        path=self.f.base/'fresh-warning.json';save(path,config)
        self.f.run=self.f.base/'fresh-warning';host.prepare(path,self.f.run);self.f.root=self.f.run/'planning'
        self.f.plan['layoutRegistration']=dict(kind=layout.KIND,referenceSha256=digest(self.f.reference),
            materials=[dict(materialId=m['id'],mode='uniform',measurementAlphaThreshold=128)
                for m in self.f.plan['materials'] if m['role']=='foreground'],constraints=[],knownDifferences=[])
        self.f.generate()
        original=delivery.review_fixtures.HostReviewTests.response_doc
        def response(owner):
            answer=original(owner)
            for row in answer['smallMaterialAudit'].values():
                for part in row['parts']:part['deferredAppearance']=None
            return answer
        with patch.object(delivery.review_fixtures.HostReviewTests,'response_doc',response):self.f.review()
        self.source=self.f.run/'frozen';self.parent=inspect(self.source)
        self.output=self.f.base/'regrouped'

    def test_regroup_preserves_every_review_byte_and_requires_new_host_authorization(self):
        result=regroup(self.source,self.parent['digest'],self.output,16)
        new=inspect(self.output,result['digest']);preflight(self.output,new['digest'])
        lineage=read(self.output/'grouping-lineage.json')
        for name,sha in lineage['preservedFiles'].items():
            self.assertEqual(digest(self.output/name),sha)
            self.assertEqual((self.output/name).read_bytes(),(self.source/name).read_bytes())
        self.assertFalse(lineage['originalAnswersChanged']);self.assertEqual(result['modelCalls'],0)
        contract=self.f.base/'layout.json';save(contract,self.f.plan['layoutRegistration'])
        config=read(self.f.run/'config.json')
        for key in ('planningMode','m1Planner','layoutPlanningPolicy','planningCapacityPolicy','planningNotes','digest'):config.pop(key,None)
        config.update(seed=str(self.source/'evidence/m1-draft.json'),reviewedSnapshot=str(self.output),
            reviewedSnapshotDigest=new['digest'],reviewedSnapshotPolicy=host.PLANNING_REUSE,
            visualPolicy=str(self.output/'visual-policy.json'),layoutContract=str(contract),
            generationGroupingPolicy=COMPACT_CONTROL_V2)
        path=self.f.base/'continuation.json';save(path,config)
        run=self.f.base/'continued';current=host.prepare(path,run)
        self.assertEqual(current['stage'],'images');self.assertFalse(current['newM2ReviewPerformed'])
        self.assertEqual(current['status'],'awaiting_authorization')
        with self.assertRaisesRegex(ValueError,'NOT_READY_NO_RESUBMIT'):host.next_request(run)
        self.assertTrue((run/'frozen-layout-contract.json').is_file())
        self.assertEqual(read(self.f.run/'state.json')['stage'],'images')
        # A reused reviewed snapshot has no prior planning scopes directory.
        # Receiving the last genuine fixture image must still prepare reviews.
        host.authorize(run,current['scopeDigest'],'Offline image fixtures only')
        sizes={a['id']:a['output_size'] for a in read(run/'frozen/execution-plan.candidate.json')['assets']}
        background={m['id'] for m in self.f.plan['materials'] if m['role']=='background'}
        with Image.open(run/'frozen/reference.png') as source:reference_size=source.size
        while host.status(run)['stage']=='images':
            request=host.next_request(run);raw=self.f.base/'continued-fixture.png'
            if 'materialIds' in request:
                columns,rows=request['grid'];image=Image.new('RGBA',(columns*160,rows*160))
                draw=ImageDraw.Draw(image)
                for i,key in enumerate(request['materialIds']):
                    x=(i%columns)*160;y=(i//columns)*160
                    draw.rectangle((x+30,y+30,x+129,y+129),fill=(60,90,100,255))
            elif request['asset'] in background:image=Image.new('RGB',reference_size,(40,50,60))
            else:
                w,h=sizes[request['asset']];image=Image.new('RGBA',(w+40,h+40))
                ImageDraw.Draw(image).rectangle((20,20,w+19,h+19),fill=(80,90,100,255))
            image.save(raw);host.receive(run,request['submissionDigest'],raw)
        current=host.status(run)
        self.assertEqual(current['stage'],'composite_review')
        self.assertEqual(current['status'],'awaiting_authorization')
        self.assertTrue((run/'scopes/composite_review-composite/scope.json').is_file())
        self.assertTrue((run/'final-review/dispatch.json').is_file())
        self.assertFalse(current['newM2ReviewPerformed'])

    def test_mutated_parent_or_regrouped_prompt_rejected(self):
        result=regroup(self.source,self.parent['digest'],self.output,16)
        path=self.output/'requests.json';path.write_bytes(path.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED'):preflight(self.output,result['digest'])
        path=self.source/'reference.png';path.write_bytes(path.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED'):
            regroup(self.source,self.parent['digest'],self.f.base/'bad',16)
        self.assertFalse((self.f.base/'bad').exists())

    def test_reviewed_board_choices_complete_host_and_source_comparison(self):
        from ai_ui_layers import experimental_executor as exchange
        from test_host_sheet_fallback import HostSheetFallbackTests
        from test_composite_review import finish_composite
        config=read(self.f.run/'config.json')
        for key in ('planningMode','m1Planner','layoutPlanningPolicy','planningCapacityPolicy','planningNotes','digest'):
            config.pop(key,None)
        rows=read(self.source/'requests.json')['requests']
        sheet=next(r for r in rows if r.get('kind')=='sheet')
        choices={sheet['asset']:dict(promptVersion='v11',referencePolicy=None)}
        config.update(seed=str(self.source/'evidence/m1-draft.json'),reviewedSnapshot=str(self.source),
            reviewedSnapshotDigest=self.parent['digest'],reviewedSnapshotPolicy=host.PLANNING_REUSE,
            visualPolicy=str(self.source/'visual-policy.json'),deliveryBoardVariants=choices)
        path=self.f.base/'board-config.json';save(path,config)
        self.base=self.f.base;self.run=self.base/'board-host'
        current=host.prepare(path,self.run)
        self.assertEqual(current['status'],'awaiting_authorization')
        job,_=exchange.load_job(self.run/'images')
        self.assertEqual(job['deliveryBoardVariants'],choices)
        self.assertEqual(job['maximumCalls'],len(rows))
        self.assertEqual(exchange.status(self.run/'images')['assignedCalls'],0)
        HostSheetFallbackTests.acquire(self,False)
        final=finish_composite(self)
        self.assertEqual(final['stage'],'diagnostic_complete')
        self.assertEqual(final['compositeReviewCalls'],1)
        request=read(self.run/'final-review/request.json');folder=self.run/request['diagnosticDelivery']
        with Image.open(folder/'comparison/source-vs-delivery.png') as paired:
            for i,name in enumerate(('original-reference.png','viewport-preview.png')):
                with Image.open(folder/name) as source:
                    w,h=source.size
                    self.assertEqual(paired.crop((i*w,28,(i+1)*w,h+28)).tobytes(),source.convert('RGBA').tobytes())
        config['deliveryBoardVariants']={'unknown':dict(promptVersion='v11',referencePolicy=None)}
        bad=self.base/'bad-board-config.json';save(bad,config)
        with self.assertRaisesRegex(ValueError,'COMPLETE_V16'):
            host.prepare(bad,self.base/'bad-board-host')
        self.assertFalse((self.base/'bad-board-host').exists())


if __name__=='__main__':unittest.main()
