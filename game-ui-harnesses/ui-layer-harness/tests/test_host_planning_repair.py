"""Official host planning closure: offline JSON fixtures, no external dispatch."""
import _bootstrap
from copy import deepcopy
from pathlib import Path
import unittest
from unittest.mock import patch

from ai_ui_layers import host_delivery as host, host_planning as planning, host_review, host_m1
from ai_ui_layers import host_layout_registration as layout, host_timing
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.freeze_visual import inspect, body_digest
from ai_ui_layers.experimental_executor import record
import test_host_delivery as fixtures
import test_host_m1 as m1_fixtures

save=fixtures.review_fixtures.save


class PlanningPreflightTests(unittest.TestCase):
    def test_snapshot_continuation_strips_only_complete_disabled_defaults(self):
        base=dict(seed='offline-seed.json',reviewedSnapshot='reviewed-snapshot')
        passive=dict(planningPreflightPolicy=planning.PREFLIGHT,planningRepairPolicy=planning.DISABLED,
                     maximumPlanningRepairCalls=0)
        carried=dict(base,**passive);planning.configure(carried,False)
        self.assertEqual(carried,base)
        unchanged=deepcopy(base);planning.configure(unchanged,False);self.assertEqual(unchanged,base)
        for change in (dict(planningRepairPolicy=planning.REPAIR),dict(maximumPlanningRepairCalls=2),
                dict(maximumPlanningRepairCalls=False),dict(planningRepairer='fixture-author'),
                dict(planningPreflightPolicy='unknown')):
            config=dict(base,**passive);config.update(change);before=deepcopy(config)
            with self.assertRaisesRegex(ValueError,'REQUIRES_FRESH_HOST_M1'):planning.configure(config,False)
            self.assertEqual(config,before)
        with self.assertRaisesRegex(ValueError,'REQUIRES_FRESH_HOST_M1'):
            planning.configure(dict(base,planningRepairPolicy=planning.DISABLED),False)

    def setUp(self):
        fixtures.review_fixtures.HostReviewTests.setUp(self)
        # The original fixture also owns a protruding crest at y=.05. Keep its
        # optional locator absent when constructing a different parent envelope.
        next(o for o in self.plan['objects'] if o['id']=='crest')['bboxNorm']=None

    def bound(self):
        return dict(canvas=[1000,1000],referenceSha256=digest(self.reference),layoutRequired=False,internalTargetsPolicy=None)

    def normalize(self, plan=None):
        return planning.normalize(plan or self.plan,read(self.contract/'schemas/visual-plan.schema.json'),self.bound())

    def errors(self, plan=None):
        return planning.assess(plan or self.plan,read(self.contract/'schemas/visual-plan.schema.json'),self.bound())['technicalErrors']

    def owner(self):
        return next(m for m in self.plan['materials'] if m['id']=='asset-panel')

    def child(self):
        return next(o for o in self.plan['objects'] if o['id']=='panel')

    def test_four_directions_expand_owner_only_and_keep_every_object(self):
        for edge in range(4):
            with self.subTest(edge=edge):
                owner=self.owner();owner['bboxNorm']=[.1,.1,.9,.9]
                box=list(owner['bboxNorm']);box[edge]+=(-.001 if edge<2 else .001)
                self.child()['bboxNorm']=box
                normalized,changes,refusals=self.normalize()
                self.assertEqual(normalized['objects'],self.plan['objects'])
                self.assertEqual(normalized['materials'][1]['bboxNorm'],box)
                self.assertEqual(len(changes),1);self.assertFalse(refusals)
                self.assertFalse(self.errors(normalized))

    def test_given_parent_child_example_is_a_generic_small_union(self):
        self.owner()['bboxNorm']=[.0451,.0716,.9549,.8996]
        self.child()['bboxNorm']=[.808,.0700,.951,.263]
        result,changes,refusals=self.normalize()
        self.assertEqual(result['materials'][1]['bboxNorm'],[.0451,.0700,.9549,.8996])
        self.assertEqual(result['objects'],self.plan['objects']);self.assertFalse(self.errors(result))
        self.assertEqual(changes[0]['rule'],planning.RULE);self.assertFalse(refusals)

    def test_multiple_objects_share_one_union_without_changing_ownership(self):
        self.owner()['bboxNorm']=[.1,.1,.9,.9];self.child()['bboxNorm']=[.099,.2,.3,.4]
        second=deepcopy(self.child());second.update(id='other-owned-part',bboxNorm=[.5,.6,.901,.8])
        self.plan['objects'].append(second)
        result,changes,_=self.normalize()
        self.assertEqual(result['materials'][1]['bboxNorm'],[.099,.1,.901,.9])
        self.assertEqual(result['objects'],self.plan['objects']);self.assertEqual(len(changes),1)
        self.assertEqual(changes[0]['objectIds'],['panel','crest','other-owned-part'])

    def test_invalid_coordinates_are_hard_errors_and_never_clamped(self):
        for box in ([-.1,.1,.2,.2],[.2,.1,1.1,.2],[.2,.2,.1,.3],[.1,.2,.2,.2],[.1,.2,.3]):
            with self.subTest(box=box):
                self.child()['bboxNorm']=box
                self.assertTrue(self.errors());result,changes,_=self.normalize()
                self.assertEqual(result,self.plan);self.assertFalse(changes)

    def test_duplicate_ids_and_missing_owner_are_hard_errors(self):
        for field in ('materials','objects'):
            plan=deepcopy(self.plan);plan[field].append(deepcopy(plan[field][-1]))
            self.assertIn('DUPLICATE_ID',[e['code'] for e in self.errors(plan)])
        self.child()['materialId']='undeclared-owner'
        self.assertIn('MISSING_MATERIAL',[e['code'] for e in self.errors()])
        result,changes,_=self.normalize();self.assertEqual(result,self.plan);self.assertFalse(changes)

    def test_background_region_order_and_object_are_hard_errors(self):
        for mutate,code in ((lambda p:p['materials'][0].update(bboxNorm=[0,0,1,.9]),'BACKGROUND_REGION'),
                (lambda p:p['materials'][0].update(zOrder=255),'BACKGROUND_ORDER'),
                (lambda p:p['objects'][0].update(materialId='asset-panel'),'BACKGROUND_OBJECT')):
            plan=deepcopy(self.plan);mutate(plan)
            self.assertIn(code,[e['code'] for e in self.errors(plan)])

    def test_large_changes_unknowns_and_disjoint_objects_refuse_normalization(self):
        for box,unknowns in (([.01,.01,.95,.95],[]),([.099,.1,.3,.3],['Uncertain contour']),([0,0,.01,.01],[])):
            self.owner()['bboxNorm']=[.1,.1,.9,.9];self.child()['bboxNorm']=box;self.plan['unknowns']=unknowns
            result,changes,refusals=self.normalize()
            self.assertEqual(result,self.plan);self.assertFalse(changes);self.assertTrue(refusals)
            self.assertTrue(self.errors(result))

    def test_foreign_owner_in_new_strip_refuses_expansion(self):
        self.owner()['bboxNorm']=[.1,.1,.9,.9];self.child()['bboxNorm']=[.099,.2,.3,.4]
        foreign=next(o for o in self.plan['objects'] if o['materialId']=='asset-coin-a')
        foreign['bboxNorm']=[.099,.2,.1,.3]
        # Isolate the expansion ambiguity without adding another containment defect.
        next(m for m in self.plan['materials'] if m['id']=='asset-coin-a')['bboxNorm']=[.099,.2,.1,.3]
        result,changes,refusals=self.normalize()
        self.assertEqual(result,self.plan);self.assertFalse(changes)
        self.assertEqual(refusals[0]['reason'],'FOREIGN_OWNERSHIP_IN_EXPANSION')

    def test_invalid_constraints_and_declared_owner_refs_are_hard_errors(self):
        self.plan['layoutRegistration']=dict(kind=layout.KIND,referenceSha256=digest(self.reference),
            materials=[dict(materialId=m['id'],mode='frame',measurementAlphaThreshold=128)
                for m in self.plan['materials'] if m['role']=='foreground'],constraints=[],knownDifferences=[])
        constraint=dict(id='relation-a',a=dict(materialId='asset-panel',edge='left'),
            b=dict(materialId='asset-buy-button',edge='top'),expectedDelta=0,tolerancePixels=1)
        self.plan['layoutRegistration']['constraints']=[constraint]
        self.assertIn('LAYOUT_CONSTRAINT_AXES_MISMATCH',[e['code'] for e in self.errors()])
        constraint['b']['edge']='right';constraint['b']['materialId']='missing'
        self.assertIn('HOST_LAYOUT_CONSTRAINT_MATERIAL_REQUIRED',[e['code'] for e in self.errors()])
        constraint['b']=deepcopy(constraint['a']);constraint['expectedDelta']=10
        self.assertIn('LAYOUT_SELF_CONSTRAINT_CONTRADICTION',[e['code'] for e in self.errors()])
        constraint['b']=dict(materialId='asset-buy-button',edge='right');constraint['expectedDelta']=0
        other=deepcopy(constraint);other.update(id='relation-b',expectedDelta=20)
        self.plan['layoutRegistration']['constraints'].append(other)
        self.assertIn('LAYOUT_CONSTRAINT_INTERVAL_CONTRADICTION',[e['code'] for e in self.errors()])

    def test_wrong_existing_owner_never_changes_assignment_or_blindly_expands(self):
        self.child()['materialId']='asset-coin-a';self.child()['bboxNorm']=[.1,.1,.9,.9]
        self.assertIn('OBJECT_OUTSIDE_MATERIAL',[e['code'] for e in self.errors()])
        result,changes,_=self.normalize()
        self.assertEqual(result,self.plan);self.assertFalse(changes)
        self.assertEqual(result['objects'][1]['materialId'],'asset-coin-a')

    def test_constrained_parent_requires_model_instead_of_normalization(self):
        self.plan['layoutRegistration']=dict(kind=layout.KIND,referenceSha256=digest(self.reference),
            materials=[dict(materialId=m['id'],mode='frame',measurementAlphaThreshold=128)
                for m in self.plan['materials'] if m['role']=='foreground'],knownDifferences=[],constraints=[dict(
                id='relation-a',a=dict(materialId='asset-panel',edge='left'),
                b=dict(materialId='asset-buy-button',edge='right'),expectedDelta=0,tolerancePixels=1)])
        self.owner()['bboxNorm']=[.1,.1,.9,.9];self.child()['bboxNorm']=[.099,.2,.3,.4]
        result,changes,refusals=self.normalize()
        self.assertEqual(result,self.plan);self.assertFalse(changes)
        self.assertEqual(refusals[0]['reason'],'CONSTRAINED_OWNER_REQUIRES_MODEL_REPAIR')

    def test_visual_overlap_warning_does_not_disable_technical_checks(self):
        material=deepcopy(self.plan['materials'][1]);material['id']='overlap';self.plan['materials'].append(material)
        obj=deepcopy(self.plan['objects'][1]);obj.update(id='overlap-object',materialId='overlap');self.plan['objects'].append(obj)
        report=planning.assess(self.plan,read(self.contract/'schemas/visual-plan.schema.json'),self.bound())
        self.assertFalse(report['technicalErrors']);self.assertTrue(report['visualWarnings'])
        self.child()['bboxNorm']=[.05,.05,.9,.9]
        self.assertIn('OBJECT_OUTSIDE_MATERIAL',[e['code'] for e in self.errors()])

    def test_model_change_report_retains_json_types_and_exact_changed_paths(self):
        before=dict(flag=True,box=[0,.1,.2,.3],removed='old')
        after=dict(flag=1,box=[0,.1,.2,.4],added='new')
        rows=planning.model_changes(before,after)
        self.assertEqual({r['path'] for r in rows},{'/flag','/box/3','/removed','/added'})
        self.assertNotEqual(next(r for r in rows if r['path']=='/flag')['beforeDigest'],
                            next(r for r in rows if r['path']=='/flag')['afterDigest'])

    def test_model_repair_cannot_shrink_drop_or_hide_original_contours(self):
        self.child()['bboxNorm']=[.099,.1,.9,.9]
        for change,code in ((lambda p:p['objects'][1].update(bboxNorm=[.1,.1,.9,.9]),'PLANNING_REPAIR_OBJECT_CONTOUR_SHRUNK'),
                (lambda p:p['objects'][1].update(bboxNorm=None),'PLANNING_REPAIR_OBJECT_CONTOUR_REMOVED'),
                (lambda p:p['objects'].pop(1),'PLANNING_REPAIR_OBJECT_REMOVED')):
            result=deepcopy(self.plan);change(result)
            self.assertIn(code,[r['code'] for r in planning.transition_errors(self.plan,result)])
        expanded=deepcopy(self.plan);expanded['objects'][1]['bboxNorm']=[.09,.09,.91,.91]
        self.assertFalse(planning.transition_errors(self.plan,expanded))


class HostPlanningRepairTests(unittest.TestCase):
    setUp=fixtures.HostDeliveryTests.setUp
    generate=m1_fixtures.FreshHostM1Tests.generate

    def start(self, enabled=True, **changes):
        config=read(self.config_path);config.pop('seed')
        config.update(planningMode=host_m1.MODE,m1Planner='fixture-author',visualReviewMode='warning')
        if enabled:config.update(planningRepairPolicy=planning.REPAIR,maximumPlanningRepairCalls=2,
            planningRepairer='fixture-repairer',planningRepairReviewer='fixture-reviewer')
        config.update(changes);path=self.base/'repair-config.json';save(path,config)
        self.run=self.base/'fresh-repair-run';host.prepare(path,self.run);self.root=self.run/'planning'
        self.plan['layoutRegistration']=dict(kind=layout.KIND,referenceSha256=digest(self.reference),
            materials=[dict(materialId=m['id'],mode='frame',measurementAlphaThreshold=128)
                for m in self.plan['materials'] if m['role']=='foreground'],constraints=[],knownDifferences=[])

    def malformed(self):
        next(o for o in self.plan['objects'] if o['id']=='panel')['materialId']='missing-owner'

    def original_plan(self):
        result=deepcopy(self.plan)
        next(o for o in result['objects'] if o['id']=='panel')['materialId']='asset-panel'
        return result

    def repair(self, answer=None, wrong_actor=False):
        current=host.status(self.run);self.assertEqual(current['stage'],'planning_repair')
        self.assertEqual(current['status'],'ready')
        request=host.next_request(self.run)
        response=self.base/'repair-response.json';save(response,self.original_plan() if answer is None else answer)
        att=self.base/'repair-attestation.json'
        raw=read(Path(request['requestPath']))
        save(att,dict(kind='ui_host_planning_repair_attestation_v1',requestSha256=request['requestSha256'],
            responseSha256=digest(response),parentCandidateSha256=raw['parentCandidateSha256'],
            repairerId='imposter' if wrong_actor else 'fixture-repairer',model=raw['model'],effort=raw['effort'],
            hostAssertedModelResponse=True,notProviderReceipt=True,notCryptographicallyPlatformVerified=True,
            dispatchEvidenceSha256=digest(self.dispatch),returnEvidenceSha256=digest(response)))
        return host.receive(self.run,request['submissionDigest'],response,host_attestation=att,
            dispatch_evidence=self.dispatch,return_evidence=response)

    def review(self, blocked=False, ownership_confirmed=True):
        current=host.status(self.run);stage=current['stage']
        self.root=self.run/('planning-rereview' if stage=='planning_rereview' else 'planning')
        if current['status']=='awaiting_authorization':host.authorize(self.run,current['scopeDigest'],'Offline M2 fixture')
        request=host.next_request(self.run)
        self.plan=read(self.root/'m1/draft.json')
        answer=fixtures.review_fixtures.HostReviewTests.response_doc(self)
        catalog_path=self.root/'m2/planning-repair-catalog.json'
        if catalog_path.exists():
            catalog=read(catalog_path)
            answer['planningRepairAudit']=dict(catalogDigest=catalog['digest'],ownershipChanges={row['objectId']:dict(
                status='confirmed' if ownership_confirmed else 'uncertain',
                sourceEvidence='Offline source fixture identifies this complete contour.',
                ownershipEvidence='Offline fixture independently confirms the revised owner.') for row in catalog['changes']})
        if read(self.run/'config.json').get('visualReviewMode')=='warning':
            for row in answer['smallMaterialAudit'].values():
                for part in row['parts']:part['deferredAppearance']=None
        # In a strict profile this typed semantic finding is a planning blocker.
        if blocked:
            from ai_ui_layers.relation_review import catalog
            bound=catalog(self.plan,digest(self.reference))
            if not bound['pairs']:raise AssertionError('Blocked fixture needs an overlap pair')
            answer['relationReview']=dict(catalogDigest=bound['digest'],candidateDigest=bound['candidateDigest'],
                referenceSha256=bound['referenceSha256'],pairs={r['pairId']:dict(disposition='ownership-conflict',
                sourceEvidence='Offline fixture has overlapping surfaces.',ownershipEvidence='Source ownership needs repair.')
                for r in bound['pairs']})
        elif read(self.root/'m2/relation-catalog.json')['pairs']:
            bound=read(self.root/'m2/relation-catalog.json')
            answer['relationReview']=dict(catalogDigest=bound['digest'],candidateDigest=bound['candidateDigest'],
                referenceSha256=bound['referenceSha256'],pairs={r['pairId']:dict(disposition='non-occluding',
                sourceEvidence='Offline fixture has distinct contours.',ownershipEvidence='Each contour is independently owned.')
                for r in bound['pairs']})
        response=self.base/(stage+'-answer.json');save(response,answer)
        self.prepared={'requestSha256':request['requestSha256']};self.response=response
        fixtures.review_fixtures.HostReviewTests.write_attestation(self)
        att=read(self.attestation);att['candidateAuthors']=read(self.root/'m2/request.json')['candidateAuthors'];save(self.attestation,att)
        return host.receive(self.run,request['submissionDigest'],response,host_attestation=self.attestation,
            dispatch_evidence=self.dispatch,return_evidence=response)

    def test_normal_path_keeps_one_m1_one_m2_and_no_repair_calls(self):
        self.start();self.generate();current=self.review()
        self.assertEqual(current['stage'],'images');self.assertEqual(current['planningModelCallsUsed'],2)
        self.assertEqual(current['planningRepairCallsUsed'],0);self.assertEqual(current['planningRereviewCallsUsed'],0)
        self.assertFalse((self.run/'planning-repair').exists())
        self.assertFalse(list((self.run/'images/attempts').rglob('submission.json')))
        self.assertEqual(current['perRequestMaterialReviewCalls'],0)

    def test_safe_union_is_reviewed_and_frozen_as_actual_candidate(self):
        self.start(enabled=False)
        owner=next(m for m in self.plan['materials'] if m['id']=='asset-panel')
        owner['bboxNorm']=[.0451,.0716,.9549,.8996]
        next(o for o in self.plan['objects'] if o['id']=='panel')['bboxNorm']=[.808,.07,.951,.263]
        next(o for o in self.plan['objects'] if o['id']=='crest')['bboxNorm']=None
        raw=deepcopy(self.plan);current=self.generate()
        self.assertEqual(current['stage'],'planning_review')
        self.assertEqual(read(self.run/'planning-m1/draft.json'),raw)
        actual=read(self.root/'m1/draft.json');self.assertEqual(actual['materials'][1]['bboxNorm'][1],.07)
        self.assertEqual(actual['objects'],raw['objects'])
        self.assertIn('0.07',(self.root/'m2/prompt.md').read_text('utf-8'))
        self.review();snapshot=inspect(self.run/'frozen')
        self.assertEqual(snapshot['sourcePlanSha256'],digest(self.root/'m1/draft.json'))
        self.assertTrue(snapshot['m1ModelExecuted']);self.assertFalse(snapshot['offlineCandidateSeed'])
        host_review.verify_frozen(self.run/'frozen',snapshot,actual)
        self.assertEqual(host.status(self.run)['planningModelCallsUsed'],2)

    def test_missing_owner_repairs_once_and_independently_rereviews(self):
        self.start();self.malformed();raw=deepcopy(self.plan)
        current=self.generate();self.assertEqual(current['stage'],'planning_repair')
        self.assertFalse((self.run/'planning').exists());self.assertFalse((self.run/'images').exists())
        self.assertEqual(current['maximumPlanningRepairCalls'],2)
        original=digest(self.run/'planning-m1/draft.json')
        current=self.repair();self.assertEqual(current['stage'],'planning_rereview')
        self.assertFalse((self.run/'images').exists());self.assertEqual(current['planningRepairCallsUsed'],1)
        auth=read(self.run/'scopes/planning_rereview/authorization.json')
        self.assertEqual(auth['parentAuthorizationDigest'],read(self.run/'scopes/planning_generate/authorization.json')['digest'])
        current=self.review();self.assertEqual(current['stage'],'images')
        self.assertEqual(current['planningModelCallsUsed'],3)
        self.assertEqual(current['planningRereviewCallsUsed'],1)
        self.assertIn('/objects/1/materialId',[c['path'] for c in read(self.run/'planning-candidates/repaired/report.json')['modelChanges']])
        self.assertEqual(digest(self.run/'planning-m1/draft.json'),original)
        self.assertEqual(read(self.run/'planning-m1/draft.json'),raw)
        snapshot=inspect(self.run/'frozen');actual=read(self.root/'m1/draft.json')
        host_review.verify_frozen(self.run/'frozen',snapshot,actual)
        self.assertEqual(read(self.root/'m2/request.json')['candidateAuthors'],['fixture-author','fixture-repairer'])
        self.assertFalse(list((self.run/'images/attempts').rglob('submission.json')))
        timing=host_timing.report(self.run)
        self.assertGreaterEqual(timing['stages']['planning_repair']['localSeconds'],0)

    def test_schema_invalid_coordinates_can_use_preapproved_repair(self):
        self.start();next(m for m in self.plan['materials'] if m['id']=='asset-panel')['bboxNorm']=[-.1,.05,.9,.9]
        current=self.generate();self.assertEqual(current['stage'],'planning_repair')
        fixed=deepcopy(self.plan);fixed['materials'][1]['bboxNorm']=[.1,.05,.9,.9]
        self.repair(fixed);self.assertEqual(self.review()['stage'],'images')

    def test_disabled_repair_stops_before_m2_and_image_work(self):
        self.start(enabled=False);self.malformed()
        with self.assertRaisesRegex(ValueError,'REPAIR_DISABLED'):self.generate()
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse((self.run/'planning').exists());self.assertFalse((self.run/'images').exists())
        before=host._files(self.run);host.resume(self.run);self.assertEqual(host._files(self.run),before)

    def test_repeated_bad_repair_is_terminal_and_never_loops(self):
        self.start();self.malformed();self.generate()
        with self.assertRaisesRegex(ValueError,'REPEATED_BLOCKER'):self.repair(deepcopy(self.plan))
        current=host.status(self.run);self.assertEqual(current['status'],'failed_no_retry')
        self.assertEqual(current['planningRepairCallsUsed'],1);self.assertEqual(current['planningRereviewCallsUsed'],0)
        for _ in range(2):self.assertEqual(host.resume(self.run)['status'],'failed_no_retry')
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):host.next_request(self.run)
        self.assertFalse((self.run/'images').exists())

    def test_wrong_repair_actor_preserves_original_and_stops(self):
        self.start();self.malformed();self.generate()
        with self.assertRaisesRegex(ValueError,'FROZEN_HOST_REVIEWER'):self.repair(wrong_actor=True)
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertEqual(len(list((self.run/'rejected').glob('*/response'))),1)
        self.assertFalse((self.run/'planning-rereview').exists())

    def test_unknown_repair_result_and_interrupted_receive_never_resubmit(self):
        self.start();self.malformed();self.generate();request=host.next_request(self.run)
        before=host._files(self.run);self.assertEqual(host.resume(self.run)['status'],'awaiting_result')
        self.assertEqual(host._files(self.run),before)
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):host.next_request(self.run)
        host.fail(self.run,request['submissionDigest'],'Unknown provider acceptance')
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse((self.run/'planning-rereview').exists());self.assertFalse((self.run/'images').exists())

    def test_interrupted_transaction_is_terminal_without_repair_or_images(self):
        self.start();self.malformed();self.generate();request=host.next_request(self.run)
        record(self.run/'transaction.json',dict(operation='receive',stage='planning_repair',submissionDigest=request['submissionDigest']))
        self.assertEqual(host.resume(self.run)['reason'],'INTERRUPTED_TRANSACTION_NO_RESUBMIT')
        self.assertFalse((self.run/'images').exists())
        self.assertEqual(host.status(self.run)['planningRepairCallsUsed'],1)

    def test_derivation_hash_and_frozen_snapshot_tampering_are_rejected(self):
        self.start();self.malformed();self.generate();self.repair();self.review()
        folder=self.run/'frozen/evidence/prepared/m1/derivation'
        for name in ('candidate.json','report.json','origin/draft.json','repair/response.json','derivation.json'):
            path=folder/name;raw=path.read_bytes();path.write_bytes(raw+b' ')
            with self.assertRaises(ValueError):inspect(self.run/'frozen')
            path.write_bytes(raw)
        # Even after a caller rehashes an internal manifest, a different rule result
        # cannot masquerade as deterministic expansion.
        path=folder/'report.json';raw=path.read_bytes();report=read(path);report['changes']=[dict(rule='invented')];save(path,report)
        manifest=read(folder/'derivation.json');manifest['files']['report.json']=digest(path)
        manifest['digest']=body_digest({k:v for k,v in manifest.items() if k!='digest'});save(folder/'derivation.json',manifest)
        with self.assertRaisesRegex(ValueError,'DERIVATION_CHANGED'):planning.verify_derivation(folder)

    def test_frozen_derivation_verifies_under_archived_runtime_only(self):
        self.start();self.malformed();self.generate();self.repair();self.review()
        snapshot=inspect(self.run/'frozen')
        current=host_review.runtime_files();changed=dict(current);changed[next(iter(changed))]='0'*64
        with patch.object(host_review,'runtime_files',return_value=changed):
            self.assertEqual(inspect(self.run/'frozen')['digest'],snapshot['digest'])
            with self.assertRaisesRegex(ValueError,'RUNTIME_CHANGED'):host.status(self.run)

    def test_explicit_budget_and_independence_are_required_before_output(self):
        config=read(self.config_path);config.pop('seed')
        config.update(planningMode=host_m1.MODE,m1Planner='fixture-author',planningRepairPolicy=planning.REPAIR,
            maximumPlanningRepairCalls=2,planningRepairer='fixture-repairer',planningRepairReviewer='fixture-reviewer')
        for index,changes in enumerate((dict(maximumPlanningRepairCalls=1),dict(maximumPlanningRepairCalls=3),
                dict(planningRepairReviewer='fixture-author'),dict(planningRepairReviewer='fixture-repairer'))):
            path=self.base/f'invalid-{index}.json';save(path,dict(config,**changes))
            output=self.base/f'invalid-run-{index}'
            with self.assertRaises(ValueError):host.prepare(path,output)
            self.assertFalse(output.exists())

    def overlap(self):
        material=deepcopy(self.plan['materials'][1]);material['id']='overlap';self.plan['materials'].append(material)
        obj=deepcopy(self.plan['objects'][1]);obj.update(id='overlap-object',materialId='overlap');self.plan['objects'].append(obj)
        self.plan['layoutRegistration']['materials'].append(dict(materialId='overlap',mode='frame',measurementAlphaThreshold=128))

    def test_verified_m2_blocker_uses_exactly_two_extra_calls_and_preserves_first_review(self):
        self.start(visualReviewMode='bound-policy');self.overlap();self.generate()
        current=self.review(blocked=True);self.assertEqual(current['stage'],'planning_repair')
        before=host_review._files(self.run/'planning')
        current=self.repair();self.assertEqual(current['stage'],'planning_rereview')
        self.assertEqual(host_review._files(self.run/'planning'),before)
        current=self.review();self.assertEqual(current['stage'],'images')
        self.assertEqual(current['planningModelCallsUsed'],4)
        self.assertEqual(current['planningRepairCallsUsed']+current['planningRereviewCallsUsed'],2)
        self.assertEqual(host_review._files(self.run/'planning'),before)
        self.assertEqual(host_review.status(self.run/'planning')['status'],'review_blocked')
        snapshot=inspect(self.run/'frozen')
        self.assertTrue((self.run/'frozen/evidence/prepared/m1/derivation/prior-review/m2/draft.json').exists())
        self.assertEqual(snapshot['reviewSha256'],digest(self.run/'planning-rereview/m2/draft.json'))
        self.assertFalse(list((self.run/'images/attempts').rglob('submission.json')))

    def test_independent_rereview_blocker_exhausts_budget_without_second_repair(self):
        self.start(visualReviewMode='bound-policy');self.overlap();self.generate();self.review(blocked=True);self.repair()
        with self.assertRaisesRegex(ValueError,'REREVIEW_UNRESOLVED_BUDGET_EXHAUSTED'):self.review(blocked=True)
        current=host.status(self.run);self.assertEqual(current['status'],'failed_no_retry')
        self.assertEqual(current['planningModelCallsUsed'],4);self.assertFalse((self.run/'images').exists())
        before=host._files(self.run);host.resume(self.run);self.assertEqual(host._files(self.run),before)

    def test_repair_reservation_cannot_be_consumed_twice_or_reauthorized(self):
        self.start();self.malformed();self.generate();current=host.status(self.run)
        with self.assertRaisesRegex(ValueError,'ALREADY_AUTHORIZED'):host.authorize(self.run,current['scopeDigest'],'fixture')
        host.next_request(self.run)
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):host.next_request(self.run)
        self.assertEqual(host.status(self.run)['planningRepairCallsUsed'],1)

    def test_checkpointed_repair_receipt_resumes_deterministically_without_redispatch(self):
        self.start();self.malformed();self.generate()
        original_resume=host.resume
        with patch.object(host,'resume',side_effect=RuntimeError('Offline process exit after checkpoint')):
            with self.assertRaisesRegex(RuntimeError,'after checkpoint'):self.repair()
        self.assertEqual(host.status(self.run)['stage'],'planning_repair')
        with self.assertRaisesRegex(ValueError,'SCOPE_COMPLETE'):host.next_request(self.run)
        current=original_resume(self.run)
        self.assertEqual(current['stage'],'planning_rereview');self.assertEqual(current['planningRepairCallsUsed'],1)
        before=host._files(self.run);original_resume(self.run);self.assertEqual(host._files(self.run),before)
        self.assertFalse((self.run/'images').exists())

    def test_new_invalid_repair_is_terminal_without_rereview_or_image_dispatch(self):
        self.start();self.malformed();self.generate();answer=self.original_plan()
        answer['materials'][1]['bboxNorm']=[.9,.05,.1,.9]
        with self.assertRaisesRegex(ValueError,'PLANNING_REPAIR_UNRESOLVED'):self.repair(answer)
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse((self.run/'planning-rereview').exists());self.assertFalse((self.run/'images').exists())

    def test_preauthorization_and_repair_receipt_tamper_are_rejected(self):
        self.start();self.malformed();self.generate();self.repair()
        folder=self.run/'planning-candidates/repaired'
        for name in ('repair/preauthorization.json','repair/accepted.json','repair/trigger.json'):
            path=folder/name;raw=path.read_bytes();path.write_bytes(raw+b' ')
            with self.assertRaisesRegex(ValueError,'CHANGED'):planning.verify_derivation(folder)
            path.write_bytes(raw)

    def test_shrinking_object_to_clear_containment_stops_before_rereview(self):
        self.start();obj=next(o for o in self.plan['objects'] if o['id']=='panel')
        obj['bboxNorm']=[.05,.05,.9,.9];self.generate()
        answer=deepcopy(self.plan);answer['objects'][1]['bboxNorm']=[.1,.05,.9,.9]
        with self.assertRaisesRegex(ValueError,'PLANNING_REPAIR_UNRESOLVED'):self.repair(answer)
        current=host.status(self.run);self.assertEqual(current['status'],'failed_no_retry')
        self.assertIn('PLANNING_REPAIR_OBJECT_CONTOUR_SHRUNK',[r['code'] for r in current['planningPreflight']['technicalErrors']])
        self.assertFalse((self.run/'planning-rereview').exists());self.assertFalse((self.run/'images').exists())

    def test_unconfirmed_reassignment_blocks_even_in_visual_warning_mode(self):
        self.start();self.malformed();self.generate();self.repair()
        with self.assertRaisesRegex(ValueError,'REREVIEW_UNRESOLVED_BUDGET_EXHAUSTED'):
            self.review(ownership_confirmed=False)
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry');self.assertFalse((self.run/'images').exists())
        blockers=read(self.run/'planning-rereview/m2/assessment.json')['blockers']
        self.assertIn('PLANNING_REPAIR_OWNERSHIP_NOT_CONFIRMED',[r['code'] for r in blockers])


if __name__=='__main__':unittest.main()
