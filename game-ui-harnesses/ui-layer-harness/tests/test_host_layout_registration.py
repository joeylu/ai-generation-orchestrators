"""Offline layout integration: no model, GPU or provider requests."""
import _bootstrap
from copy import deepcopy
from pathlib import Path
import shutil
import unittest

from PIL import Image

from ai_ui_layers import host_layout_registration as layout, host_delivery as host
from ai_ui_layers.evaluate import read,save,digest
from ai_ui_layers.viewport_geometry_revision import validate_viewport_archive
import test_layout_registration_revision as fixture
import test_host_sheet_fallback as host_fixture
import test_material_review_dispatch as review_fixture


class HostLayoutTests(unittest.TestCase):
    archive=fixture.LayoutRegistrationTests.archive

    def setUp(self):
        fixture.LayoutRegistrationTests.setUp(self)
        self.archive()
        (self.root/'diagnostic-output').mkdir()
        (self.root/'old').rename(self.root/'diagnostic-output/delivery')
        frozen=self.root/'frozen';(frozen/'evidence').mkdir(parents=True)
        shutil.copyfile(self.reference,frozen/'reference.png')
        save(frozen/'placements.json',dict(materials=[dict(id='panel',sourceRegion=[30,40,110,60])]))
        save(frozen/'evidence/m1-draft.json',dict(materials=[dict(id='panel',role='foreground')]))
        self.contract=dict(kind=layout.KIND,referenceSha256=digest(self.reference),
            materials=[dict(materialId='panel',mode='frame',measurementAlphaThreshold=128)],
            constraints=[],knownDifferences=['Fixture style remains pending.'])
        self.path=self.root/'contract.json';save(self.path,self.contract)
        self.config=dict(layoutRegistrationPolicy=layout.POLICY,layoutContract=str(self.path),
            layoutContractSha256=digest(self.path),viewer=str(self.viewer))
        save(self.root/'diagnostic-output/native-material-sources.json',dict(materials=dict(
            panel=dict(path=str(self.source),sha256=digest(self.source)))))

    def test_config_defaults_strict_legacy_and_invalid_contract_preflight(self):
        for fast,policy in ((True,layout.POLICY),(False,layout.LEGACY)):
            config={};layout.configure(config,fast=fast);self.assertEqual(config['layoutRegistrationPolicy'],policy)
        fresh=dict(planningMode='fresh-host-m1-independent-review')
        layout.configure(fresh,fast=True)
        self.assertEqual(fresh['layoutPlanningPolicy'],layout.PLANNING)
        legacy=dict(planningMode='fresh-host-m1-independent-review',layoutRegistrationPolicy=layout.LEGACY)
        layout.configure(legacy,fast=True)
        self.assertNotIn('layoutPlanningPolicy',legacy)
        with self.assertRaisesRegex(ValueError,'FAST_WARNING'):
            layout.configure(dict(layoutRegistrationPolicy=layout.POLICY),fast=False)
        config=dict(layoutContract=str(self.path),original=str(self.reference))
        layout.configure(config,fast=True)
        self.assertEqual(config['layoutContractSha256'],digest(self.path))
        invalid=deepcopy(self.contract);invalid['constraints']=[dict(id='x',
            a=dict(materialId='unknown',edge='left'),b=dict(materialId='panel',edge='left'),
            expectedDelta=0,tolerancePixels=1)]
        with self.assertRaisesRegex(ValueError,'CONSTRAINT_MATERIAL'):
            layout.validate_contract(invalid,digest(self.reference))

    def test_frozen_contract_automatically_selects_verified_candidate(self):
        layout.freeze(self.root,self.config)
        summary=layout.finish(self.root,self.config)
        self.assertEqual(summary['delivery'],'layout-output/delivery')
        self.assertEqual(summary['generationCalls'],0);self.assertEqual(summary['modelCalls'],0)
        validate_viewport_archive(self.root/summary['delivery']/'viewport-ui-layers.zip')
        result=read(self.root/'layout-output/result.json')
        panel=next(r for r in result['records'] if r['materialId']=='panel')
        self.assertEqual(panel['registeredProxyBox'],[30,40,110,60])
        self.assertFalse(result['humanVisualAcceptance']);self.assertFalse(result['fullAutomaticDagPassed'])
        self.assertTrue((self.root/'diagnostic-output/delivery/viewport-ui-layers.zip').is_file())

    def test_missing_declaration_warns_and_old_config_retains_delivery(self):
        old=layout.finish(self.root,{})
        self.assertEqual(old['status'],'preserved');self.assertEqual(old['warnings'],[])
        current=layout.finish(self.root,dict(layoutRegistrationPolicy=layout.POLICY))
        self.assertEqual(current['warnings'][0]['code'],'LAYOUT_CONTRACT_NOT_DECLARED')
        self.assertEqual(current['delivery'],'diagnostic-output/delivery')

    def test_source_and_frozen_planning_changes_are_blocking(self):
        layout.freeze(self.root,self.config)
        path=self.root/'frozen/placements.json';original=path.read_bytes();path.write_bytes(original+b' ')
        with self.assertRaisesRegex(ValueError,'PLANNING_CHANGED'):layout.finish(self.root,self.config)
        path.write_bytes(original);self.source.write_bytes(self.source.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):layout.finish(self.root,self.config)
        self.assertFalse((self.root/'layout-output').exists())

    def test_ambiguous_dividers_and_constraint_gaps_warn_but_deliver(self):
        self.contract['materials'][0]['horizontalDividerTargets']=[50]
        self.contract['constraints']=[dict(id='width',a=dict(materialId='panel',edge='right'),
            b=dict(materialId='panel',edge='left'),expectedDelta=90,tolerancePixels=1)]
        self.path.unlink();save(self.path,self.contract);self.config['layoutContractSha256']=digest(self.path)
        layout.freeze(self.root,self.config);summary=layout.finish(self.root,self.config)
        self.assertEqual(summary['delivery'],'layout-output/delivery')
        self.assertFalse(summary['layoutConstraintsPassed'])
        codes={row['code'] for row in summary['warnings']}
        self.assertEqual(codes,{'LAYOUT_DIVIDER_CORRESPONDENCE_UNRESOLVED','LAYOUT_CONSTRAINT_RESIDUAL'})
        self.assertFalse(summary['internalDividerChecksPassed'])
        self.assertEqual(summary['internalDividerChecks'][0]['declaredTargetRows'],[50])
        self.assertEqual(summary['internalDividerChecks'][0]['detectedRenderedRows'],[])
        self.assertFalse(summary['humanVisualAcceptance'])
        validate_viewport_archive(self.root/summary['delivery']/'viewport-ui-layers.zip')

    def test_divider_detection_is_count_bound_and_does_not_invent_rows(self):
        image=Image.new('RGBA',(160,160));image.paste((220,220,220,255),(10,10,150,150))
        image.paste((170,170,170,255),(10,49,150,51))
        image.paste((170,170,170,255),(10,109,150,111))
        rows=layout.divider_rows(image,128)
        self.assertEqual(len(rows),2);self.assertLessEqual(abs(rows[0]-50),1);self.assertLessEqual(abs(rows[1]-110),1)
        self.assertEqual(layout.divider_rows(Image.new('RGBA',(160,160)),128),[])

    def test_fresh_m1_contract_freezes_from_reviewed_plan_and_rejects_missing_owners(self):
        config=dict(layoutRegistrationPolicy=layout.POLICY,layoutPlanningPolicy=layout.PLANNING,
            planningMode='fresh-host-m1-independent-review',viewer=str(self.viewer))
        layout.configure(config,fast=True)
        path=self.root/'frozen/evidence/m1-draft.json';plan=read(path)
        plan['layoutRegistration']=self.contract
        path.unlink();save(path,plan)
        layout.freeze(self.root,config)
        self.assertEqual(read(self.root/'frozen-layout-contract.json')['contractOrigin'],'reviewed-visual-plan')
        self.assertEqual(layout.finish(self.root,config)['delivery'],'layout-output/delivery')
        plan['materials'].append(dict(id='other',role='foreground'))
        path.unlink();save(path,plan)
        with self.assertRaisesRegex(ValueError,'ALL_FOREGROUND'):layout.freeze(self.root,config)

    def test_outlined_section_bands_do_not_replace_missing_divider(self):
        image=Image.new('RGBA',(240,260))
        image.paste((245,245,245,255),(10,10,230,250))
        for top,bottom in ((30,65),(185,220)):
            image.paste((220,220,220,255),(10,top,230,bottom))
            image.paste((210,210,210,255),(10,top,230,top+2))
            image.paste((210,210,210,255),(10,bottom-2,230,bottom))
        for y in (105,145):image.paste((215,215,215,255),(10,y,230,y+2))
        rows=layout.divider_rows(image,128)
        self.assertEqual(len(rows),2)
        self.assertTrue(all(abs(a-b)<=1 for a,b in zip(rows,[105,145])))

    def test_fresh_m1_policy_forbids_preplanned_sidecar_and_legacy_modes(self):
        for extra in ({'layoutContract':str(self.path)}, {'planningMode':'offline-agent-seed-independent-host-review'},
                      {'layoutPlanningPolicy':'unknown'}):
            config=dict(layoutRegistrationPolicy=layout.POLICY,layoutPlanningPolicy=layout.PLANNING,
                planningMode='fresh-host-m1-independent-review')
            config.update(extra)
            with self.assertRaisesRegex(ValueError,'FRESH_M1'):layout.configure(config,fast=True)

    def test_section_bands_and_light_gaps_are_remapped_separately_from_dividers(self):
        from ai_ui_layers import layout_registration_revision as revision
        image=Image.new('RGBA',(240,300))
        image.paste((245,245,245,255),(10,10,230,290))
        for top,bottom in ((45,85),(220,260)):
            image.paste((215,220,225,255),(10,top,230,bottom))
        for y in (125,165,195):image.paste((210,210,210,255),(10,y,230,y+2))
        image.save(self.source)
        bands=layout.band_rows(image,128);dividers=layout.divider_rows(image,128)
        self.assertEqual(len(bands),2);self.assertEqual(len(dividers),3)
        targets=[[65,100],[230,270]];line_targets=[140,180,210]
        landmarks=[[a+d,b+d] for actual,target in zip(bands,targets) for a,b in zip(actual,target) for d in (-2,0,2)]
        landmarks.extend([[a+d,b+d/2] for a,b in zip(dividers,line_targets) for d in (-2,0,2)])
        rendered,geometry=revision.render(self.source,dict(materialId='panel',mode='frame',
            targetBox=[10,10,230,290],measurementAlphaThreshold=128,yLandmarks=sorted(landmarks)))
        offset=geometry['layerCanvasRegion'][1]
        actual=[[y+offset for y in pair] for pair in layout.band_rows(rendered,128)]
        self.assertEqual(len(actual),2)
        self.assertTrue(all(abs(a-b)<=2 for pair,target in zip(actual,targets) for a,b in zip(pair,target)),actual)
        self.assertTrue(all(abs(a+offset-b)<=2 for a,b in zip(layout.divider_rows(rendered,128),line_targets)))
        # The visible top strip grows with the band target, rather than disappearing.
        self.assertGreater(actual[0][0]-geometry['registeredProxyBox'][1],50)

    def test_missing_bands_are_not_invented_and_invalid_band_contracts_stop(self):
        plain=Image.new('RGBA',(240,260));plain.paste((245,245,245,255),(10,10,230,250))
        for y in (70,110,150):plain.paste((210,210,210,255),(10,y,230,y+2))
        self.assertEqual(layout.band_rows(plain,128),[])
        for bands in ([[60,50]],[[40,65],[60,80]],[[60,80],[30,50]]):
            contract=deepcopy(self.contract);contract['materials'][0]['horizontalBandTargets']=bands
            with self.assertRaisesRegex(ValueError,'ORDERED_FRAME_BANDS'):
                layout.validate_contract(contract,digest(self.reference))

    def test_uniform_internal_targets_observe_without_warp_and_preserve_legacy_rejection(self):
        self.contract['materials'][0].update(mode='uniform',horizontalDividerTargets=[50])
        with self.assertRaisesRegex(ValueError,'ORDERED_FRAME_DIVIDERS'):
            layout.validate_contract(self.contract,digest(self.reference))
        layout.validate_contract(self.contract,digest(self.reference),layout.UNIFORM_OBSERVATION)
        self.path.unlink();save(self.path,self.contract)
        self.config.update(layoutInternalTargetsPolicy=layout.UNIFORM_OBSERVATION,layoutContractSha256=digest(self.path))
        layout.freeze(self.root,self.config);summary=layout.finish(self.root,self.config)
        selection=read(self.root/'layout-selection.json')['materials'][0]
        self.assertEqual(selection['mode'],'uniform');self.assertNotIn('yLandmarks',selection)
        panel=next(r for r in read(self.root/'layout-output/result.json')['records'] if r['materialId']=='panel')
        self.assertFalse(panel['axisStretch'])
        self.assertEqual(summary['internalDividerChecks'][0]['declaredTargetRows'],[50])
        self.assertFalse(summary['internalDividerChecksPassed'])
        self.assertIn('LAYOUT_RENDERED_DIVIDERS_UNRESOLVED',{r['code'] for r in summary['warnings']})
        validate_viewport_archive(self.root/summary['delivery']/'viewport-ui-layers.zip')
        with self.assertRaisesRegex(ValueError,'INTERNAL_POLICY_CHANGED'):
            layout.finish(self.root,{k:v for k,v in self.config.items() if k!='layoutInternalTargetsPolicy'})


class HostLayoutWorkflowTests(unittest.TestCase):
    setUp=host_fixture.HostSheetFallbackTests.setUp
    prepare=host_fixture.HostSheetFallbackTests.prepare
    acquire=host_fixture.HostSheetFallbackTests.acquire
    receive=review_fixture.HostReviewSchedulingTests.receive

    def test_one_host_workflow_freezes_before_images_and_delivers_layout_candidate(self):
        contract=self.base/'layout-contract.json'
        save(contract,dict(kind=layout.KIND,referenceSha256=digest(self.reference),
            materials=[dict(materialId='asset-panel',mode='frame',measurementAlphaThreshold=128,
                            horizontalDividerTargets=[300,500,700],horizontalBandTargets=[[200,250],[800,850]])],
            constraints=[],knownDifferences=['Offline candidate only.']))
        self.prepare(layoutContract=str(contract))
        frozen=self.run/'frozen-layout-contract.json'
        self.assertTrue(frozen.is_file());self.assertEqual(list((self.run/'images/attempts').rglob('submission.json')),[])
        image_job=read(self.run/'images/job.json')
        self.assertEqual(image_job['layoutGeneration']['materialIds'],['asset-panel'])
        self.assertEqual(image_job['layoutGeneration']['promptPolicy'],'reference-owned-structure-v2')
        self.assertEqual(read(self.run/'config.json')['layoutRegistrationPolicy'],layout.POLICY)
        self.acquire(False);self.root=self.base
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline independent review fixtures only')
        while host.status(self.run)['stage']=='material_review':
            for reservation in host.next_request(self.run,count=3)['reservations']:self.receive(reservation)
        current=host.status(self.run)
        self.assertEqual(current['stage'],'diagnostic_complete')
        self.assertEqual(Path(current['diagnosticDelivery']),self.run/'layout-output/delivery')
        self.assertTrue((self.run/'layout-output/delivery/comparison/three-way-comparison.png').is_file())
        self.assertTrue((self.run/'diagnostic-output/delivery/viewport-ui-layers.zip').is_file())
        self.assertFalse((self.run/'body').exists());self.assertFalse(current['humanVisualAcceptance'])
        summary=read(self.run/'layout-output/host-layout-summary.json')
        self.assertFalse(summary['internalDividerChecksPassed'])
        self.assertFalse(summary['internalBandChecksPassed'])
        self.assertFalse(summary['internalStructureChecksPassed'])
        self.assertEqual(summary['structureMeasurementScope'],'declared-bands-and-dividers-only')
        self.assertFalse(summary['unmodeledGeometryAccepted'])
        self.assertIn('LAYOUT_BAND_CORRESPONDENCE_UNRESOLVED',{w['code'] for w in summary['warnings']})
        self.assertTrue((self.run/'material-repair-plan.json').is_file())
        self.assertEqual(read(self.run/'material-repair-plan.json')['generationCalls'],0)
        self.assertEqual(current['materialRepairPlan']['path'],'material-repair-plan.json')
        validate_viewport_archive(self.run/'layout-output/delivery/viewport-ui-layers.zip')
        before=host._files(self.run);host.resume(self.run);self.assertEqual(before,host._files(self.run))


if __name__=='__main__':unittest.main()
