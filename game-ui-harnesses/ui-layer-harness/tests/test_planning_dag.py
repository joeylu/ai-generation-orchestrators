import _bootstrap  # Enable source-layout imports for unittest discovery.
import copy
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from ai_ui_layers.planning_dag import init,Dag
from ai_ui_layers.compile_visual import HARNESS
from ai_ui_layers.evaluate import read,save,digest
from ai_ui_layers.planning_review_policy import REGIONS, split

SID='12345678-1234-1234-1234-123456789abc'


def coverage():
    return [dict(region=region,observedArtwork='Fixture scene and controls',missingFromPlan=[])
            for region in REGIONS]


def small_audit(folder):
    metadata=folder/'coverage-small-materials.json'
    if not metadata.exists():return []
    source=folder.parent/'m1/draft.json'
    if not source.exists():source=folder.parent/'source-plan.json'
    materials={row['id']:row for row in read(source)['materials']}
    return [dict(materialId=item['materialId'],
        boundary=dict(status='complete',evidence='Fixture contour is inside the candidate.'),parts=[dict(
        visiblePart=materials[item['materialId']]['label'],
        observedAppearance='Fixture shape and color, no distinct surface marks',
        planEvidenceQuote=materials[item['materialId']]['label'],
        suggestedChange='Clarify this visible part in the owner description.')])
        for item in read(metadata)['items']]

class FakeModel:
    def __init__(self,repair=False,unresolved=False,mismatch=False):
        self.calls=[];self.repair=repair;self.unresolved=unresolved;self.mismatch=mismatch
    def __call__(self,folder,sid,first):
        self.calls.append((folder.name,sid))
        if first:
            answer=read(HARNESS/'planning-harness/examples/visual-plan-scoped.json');answer['unknowns']=[]
        elif folder.name in ('m2','rereview'):
            issue={'code':'missing_detail','category':'semantic','ids':['asset-panel'],
                   'description':'fixture finding','suggestedChange':'clarify panel label'}
            answer={'issues':[issue] if (folder.name=='m2' and self.repair) or (folder.name=='rereview' and self.unresolved) else [],
                    'coverageAudit':coverage(),'smallMaterialAudit':small_audit(folder)}
        else:
            source=read(folder.parent/'m1/draft.json');panel=copy.deepcopy(next(m for m in source['materials'] if m['id']=='asset-panel'));panel['label']+=' fixed'
            answer={'sourcePlanSha256':digest(folder.parent/'m1/draft.json'),'materials':{'upsert':[panel],'remove':[]},
                    'objects':{'upsert':[],'remove':[]},'unknowns':None,'backgroundMode':None,'textPolicy':None,'unresolvedIssues':[]}
        save(folder/'draft.json',answer)
        observed='12345678-1234-1234-1234-123456789abd' if self.mismatch and not first else SID
        (folder/'events.jsonl').write_text(json.dumps({'type':'thread.started','thread_id':observed}))
        save(folder/'transport.json',{'exitCode':0,'turnCompleted':True,'unexpectedEvents':[],
             'responseSha256':digest(folder/'draft.json'),'elapsedSeconds':.01})

class DagTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name);source=root/'source.png';Image.new('RGB',(1000,1000)).save(source)
        self.root=init(source,root/'run',8)

    def test_small_material_part_without_matching_description_blocks(self):
        plan=read(HARNESS/'planning-harness/examples/visual-plan-scoped.json')
        owner=plan['materials'][1]
        row=dict(materialId=owner['id'],parts=[dict(
            visiblePart='small attached drawing tool',
            observedAppearance='Pale shape with several colored spots',planEvidenceQuote='',
            suggestedChange='Name the attached tool in this material or its object.')])
        blockers,_=split(dict(issues=[],smallMaterialAudit=[row]),plan)
        self.assertEqual(blockers[0]['code'],'UNDESCRIBED_SMALL_MATERIAL_PART')
        row['parts'][0]['planEvidenceQuote']='not a literal plan quote'
        self.assertEqual(split(dict(issues=[],smallMaterialAudit=[row]),plan)[0][0]['code'],
                         'UNDESCRIBED_SMALL_MATERIAL_PART')
        row['parts'][0]['planEvidenceQuote']=owner['label']
        self.assertEqual(split(dict(issues=[],smallMaterialAudit=[row]),plan)[0],[])

    def test_portrait_canvas_context_uses_source_dimensions_and_is_bound(self):
        source=Path(self.tmp.name)/'portrait.png'
        Image.new('RGB',(320,480)).save(source)
        root=init(source,Path(self.tmp.name)/'portrait-run',8)
        Dag(root,FakeModel()).m1()
        prompt=(root/'m1/prompt.md').read_text(encoding='utf-8')
        self.assertIn('width=320, height=480',prompt)
        self.assertEqual(read(root/'request.json')['inputs']['prompt.md'],digest(root/'m1/prompt.md'))
        self.assertEqual(digest(source),digest(root/'m1/reference.png'))

    def test_direct_freeze_and_resume_never_replays_calls(self):
        self.assertEqual((read(self.root/'.dag/config.json')['model'],
                          read(self.root/'.dag/config.json')['effort']),('gpt-6-luna','xhigh'))
        model=FakeModel();dag=Dag(self.root,model);result=dag.execute()
        self.assertEqual(result['status'],'frozen');self.assertEqual(result['nodes']['repair'],'skipped')
        self.assertEqual(model.calls,[('m1',None),('m2',SID)])
        focus=read(self.root/'m2/focus-meta.json')
        self.assertTrue(any(row['materialId']=='asset-panel' for row in focus))
        request=read(self.root/'m2/request.json')
        self.assertEqual(request['inputs']['focus-meta.json'],digest(self.root/'m2/focus-meta.json'))
        self.assertEqual(request['inputs'][focus[0]['file']],digest(self.root/'m2'/focus[0]['file']))
        self.assertEqual(request['inputs']['coverage-small-materials.png'],
                         digest(self.root/'m2/coverage-small-materials.png'))
        self.assertEqual(len(read(self.root/'m2/draft.json')['coverageAudit']),9)
        Dag(self.root,model).execute();self.assertEqual(len(model.calls),2)
        self.assertEqual(result['mediaGenerationCalls'],0)

    def test_one_repair_same_session_then_real_program_freeze(self):
        model=FakeModel(repair=True);result=Dag(self.root,model).execute()
        self.assertEqual(result['status'],'frozen')
        self.assertEqual(model.calls,[('m1',None),('m2',SID),('repair',SID),('rereview',SID)])
        self.assertTrue((self.root/'frozen/evidence/revised-visual-plan.json').exists())

    def test_renderable_first_repair_structure_error_uses_second_repair(self):
        fake=FakeModel(repair=True)
        def model(folder,sid,first):
            fake(folder,sid,first)
            if folder.name=='repair':
                answer=read(folder/'draft.json')
                source=read(folder.parent/'m1/draft.json')
                background=next(m for m in source['materials'] if m['role']=='background')
                answer['objects']['upsert'].append(dict(id='rocky-scar',label='Rocky clearing',
                    kind='background',materialId=background['id'],bboxNorm=[.2,.2,.3,.3]))
            elif folder.name=='repair2':
                source=folder.parent/'repair/candidate.json'
                answer=dict(sourcePlanSha256=digest(source),materials=dict(upsert=[],remove=[]),
                    objects=dict(upsert=[dict(id='rocky-scar',label='Rocky clearing',
                        kind='decoration',materialId=next(m['id'] for m in read(source)['materials']
                        if m['role']=='background'),bboxNorm=[.2,.2,.3,.3])],remove=[]),
                    unknowns=None,backgroundMode=None,textPolicy=None,unresolvedIssues=[])
            elif folder.name=='rereview2':
                answer=dict(issues=[],coverageAudit=coverage(),smallMaterialAudit=small_audit(folder))
            else:return
            (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
            receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
            (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        result=Dag(self.root,model).execute()
        self.assertEqual(result['status'],'frozen')
        self.assertEqual([name for name,_ in fake.calls],
                         ['m1','m2','repair','rereview','repair2','rereview2'])
        self.assertEqual([i['code'] for i in read(self.root/'repair/report.json')['programIssues']],
                         ['BACKGROUND_OBJECT'])
        self.assertEqual(read(self.root/'repair2/report.json')['programIssues'],[])
        self.assertFalse(read(self.root/'frozen/evidence/revised-visual-plan.json')['unknowns'])

    def test_coverage_finding_triggers_bounded_repair_even_with_empty_issues(self):
        fake=FakeModel();seen={}
        def model(folder,sid,first):
            fake(folder,sid,first)
            if folder.name=='m2':
                answer=read(folder/'draft.json')
                answer['coverageAudit'][2]['missingFromPlan']=[dict(
                    artwork='Visible flying character and star trail absent from scene description',
                    suggestedOwnerId='asset-scene',
                    suggestedChange='Add the flying character and trail to the scene material and object descriptions.')]
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
            elif folder.name=='repair':
                seen['context']=read(folder/'source-context.json')
                patch=read(folder/'draft.json')
                source=read(folder.parent/'m1/draft.json')
                scene=copy.deepcopy(next(m for m in source['materials'] if m['id']=='asset-scene'))
                scene['label']+=' and a flying character with star trail'
                patch['materials']['upsert']=[scene]
                (folder/'draft.json').write_text(json.dumps(patch),encoding='utf-8')
            else:return
            receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
            (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        result=Dag(self.root,model).execute()
        self.assertEqual(result['status'],'frozen')
        self.assertEqual([name for name,_ in fake.calls],['m1','m2','repair','rereview'])
        self.assertEqual(read(self.root/'m2/draft.json')['issues'],[])
        self.assertEqual(seen['context']['materials'][0]['id'],'asset-scene')
        self.assertIn('flying character',read(self.root/'repair/candidate.json')['materials'][0]['label'])
        self.assertEqual(read(self.root/'rereview/draft.json')['coverageAudit'][2]['missingFromPlan'],[])

    def test_missing_coverage_audit_cannot_freeze(self):
        fake=FakeModel()
        def model(folder,sid,first):
            fake(folder,sid,first)
            if folder.name=='m2':
                answer=read(folder/'draft.json');answer.pop('coverageAudit')
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        with self.assertRaises(Exception):Dag(self.root,model).execute()
        self.assertFalse((self.root/'frozen').exists())

    def test_empty_m2_cannot_skip_repeated_card_geometry_repair(self):
        fake=FakeModel();seen={}
        def model(folder,sid,first):
            fake(folder,sid,first)
            if first:
                plan=read(folder/'draft.json')
                for index,box in enumerate(((.2,.2,.5,.33),(.2,.38,.5,.48),(.2,.53,.5,.63))):
                    mid=f'card-{index}'
                    plan['materials'].append({'id':mid,'label':mid,'role':'foreground',
                        'zOrder':index+4,'bboxNorm':list(box),'preserveText':[],
                        'adaptationPolicy':'preserve'})
                    plan['objects'].append({'id':f'frame-{index}','label':mid,'kind':'card',
                                            'bboxNorm':None,'materialId':mid})
                (folder/'draft.json').write_text(json.dumps(plan),encoding='utf-8')
            elif folder.name=='repair':
                context=read(folder/'source-context.json')
                seen['owners']={m['id'] for m in context['materials']}
                seen['objects']={o['id'] for o in context['objects']}
                source=read(folder.parent/'m1/draft.json')
                fixed=copy.deepcopy(next(m for m in source['materials'] if m['id']=='card-0'))
                fixed['bboxNorm']=[.2,.23,.5,.33]
                patch=read(folder/'draft.json');patch['materials']['upsert']=[fixed]
                (folder/'draft.json').write_text(json.dumps(patch),encoding='utf-8')
            receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
            (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        result=Dag(self.root,model).execute()
        self.assertEqual(result['status'],'frozen')
        self.assertEqual(read(self.root/'m2/draft.json')['issues'],[])
        self.assertEqual([n for n,_ in fake.calls],['m1','m2','repair','rereview'])
        self.assertEqual(seen['owners'],{'card-0','card-1','card-2'})
        self.assertEqual(seen['objects'],{'frame-0','frame-1','frame-2'})
        focus=read(self.root/'rereview/focus-meta.json')
        self.assertEqual(focus[-1]['kind'],'repeated-card-alignment-comparison')
        self.assertEqual(read(self.root/'rereview/request.json')['inputs'][focus[-1]['file']],
                         digest(self.root/'rereview'/focus[-1]['file']))
        geometry_issue=next(i for i in read(self.root/'m1/program-check.json')['issues']
                            if i['code']=='REPEATED_CARD_HEIGHT_OUTLIER_REVIEW')
        self.assertEqual(geometry_issue['peerHeightEdgeAlternativesNorm'],
                         {'topIfBottomCorrect':.23,'bottomIfTopCorrect':.3})
        self.assertEqual(read(self.root/'repair/report.json')['programIssues'],[])
        from ai_ui_layers.local_patch import merge_patch
        source=self.root/'m1/draft.json'
        empty={'sourcePlanSha256':digest(source),'materials':{'upsert':[],'remove':[]},
               'objects':{'upsert':[],'remove':[]},'unknowns':None,
               'backgroundMode':None,'textPolicy':None,'unresolvedIssues':[]}
        _,report=merge_patch(source,empty,read(self.root/'m1/schema.json'),digest(source))
        self.assertIn('REPEATED_CARD_HEIGHT_OUTLIER_REVIEW',
                      [i['code'] for i in report['programIssues']])

    def test_unresolved_rereview_stops_and_resume_cannot_resubmit(self):
        model=FakeModel(repair=True,unresolved=True);dag=Dag(self.root,model)
        with self.assertRaisesRegex(ValueError,'REREVIEW_UNRESOLVED'):dag.execute()
        self.assertFalse((self.root/'frozen').exists())
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):Dag(self.root,model).execute()
        self.assertEqual(len(model.calls),4)

    def test_repair_receives_owner_and_all_siblings_for_object_issue(self):
        fake=FakeModel(repair=True);observed={}
        def model(folder,sid,first):
            if folder.name=='repair':
                source=read(folder.parent/'m1/draft.json')
                obj=next(o for o in source['objects'] if o['materialId']=='asset-panel')
                context=read(folder/'source-context.json')
                self.assertEqual(context['materials'],[m for m in source['materials'] if m['id']==obj['materialId']])
                self.assertEqual(context['objects'],[o for o in source['objects'] if o['materialId']==obj['materialId']])
                request=read(folder/'request.json')
                self.assertEqual(request['inputs']['source-context.json'],digest(folder/'source-context.json'))
                self.assertEqual(request['originalReferenceSha256'],digest(folder.parent/'m1/reference.png'))
                self.assertIn(json.dumps(context,ensure_ascii=False),(folder/'prompt.md').read_text(encoding='utf-8'))
                self.assertEqual(request['inputs']['coverage-small-materials.png'],
                                 digest(folder/'coverage-small-materials.png'))
                observed['source']=digest(folder.parent/'m1/draft.json')
            fake(folder,sid,first)
            if folder.name=='m2':
                obj=next(o for o in read(folder.parent/'m1/draft.json')['objects'] if o['materialId']=='asset-panel')
                answer=read(folder/'draft.json');answer['issues'][0]['ids']=[obj['id']]
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        self.assertEqual(Dag(self.root,model).execute()['status'],'frozen')
        self.assertEqual(observed['source'],digest(self.root/'m1/draft.json'))
        self.assertEqual(len(fake.calls),4)
        (self.root/'repair/source-context.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'OUTPUT_CHANGED'):Dag(self.root,model).status()

    def test_completed_checkpoint_continues_without_rerunning_m1(self):
        model=FakeModel();dag=Dag(self.root,model)
        dag.node('m1',dag.m1);dag.node('check',dag.check)
        self.assertEqual(Dag(self.root,model).execute()['status'],'frozen')
        self.assertEqual(len(model.calls),2)

    def test_remaining_unknowns_are_reported_and_block_before_rereview(self):
        fake=FakeModel()
        def uncertain(folder,sid,first):
            fake(folder,sid,first)
            if first:
                answer=read(folder/'draft.json')
                answer['unknowns']=['Visible shared ornament ownership is uncertain']
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
                receipt=read(folder/'transport.json')
                receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'REPAIR_UNRESOLVED'):
            Dag(self.root,uncertain).execute()
        report=read(self.root/'repair/report.json')
        self.assertEqual(report['programIssues'],[])
        self.assertEqual(report['remainingUnknowns'],['Visible shared ornament ownership is uncertain'])
        self.assertEqual([n for n,_ in fake.calls],['m1','m2','repair'])
        self.assertFalse((self.root/'frozen').exists())

    def test_uncertain_model_node_does_not_resubmit(self):
        def broken(folder,sid,first):raise TimeoutError('indeterminate fixture')
        with self.assertRaises(TimeoutError):Dag(self.root,broken).execute()
        model=FakeModel()
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):Dag(self.root,model).execute()
        self.assertFalse(model.calls)

    def test_changed_plan_or_session_blocks_freeze(self):
        model=FakeModel(mismatch=True)
        with self.assertRaisesRegex(ValueError,'SESSION_CHANGED'):Dag(self.root,model).execute()
        self.assertFalse((self.root/'frozen').exists())
        (self.root/'m1/draft.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'OUTPUT_CHANGED'):Dag(self.root,model).execute()

    def test_changed_runtime_blocks_resume_before_model(self):
        from unittest.mock import patch
        model=FakeModel()
        with patch('ai_ui_layers.planning_dag.runtime_files',return_value={}):
            with self.assertRaisesRegex(ValueError,'RUNTIME_CHANGED'):Dag(self.root,model).execute()
        self.assertFalse(model.calls)

if __name__=='__main__':unittest.main()
