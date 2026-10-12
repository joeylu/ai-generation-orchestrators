"""Ownership-before-grouping and internal-geometry regressions; offline only."""
import _bootstrap
from copy import deepcopy
import json
import unittest

import numpy as np
from PIL import Image, ImageDraw

from ai_ui_layers import host_delivery as host, planning_capacity
from ai_ui_layers import layout_registration_revision as layout
from ai_ui_layers.evaluate import read, digest
import test_host_delivery as delivery
import test_planning_capacity as capacity
import test_host_sheet_fallback as sheets
from test_composite_review import finish_composite


class PlanningGeometryFidelityTests(unittest.TestCase):
    setUp=delivery.HostDeliveryTests.setUp
    start=capacity.FreshCapacityHostTests.start
    generate=capacity.FreshCapacityHostTests.generate

    def test_capacity_never_recombines_a_separate_rigid_content_owner(self):
        # A replaceable illustration inside a carrier is an independent owner;
        # the source plan and original model bytes must survive budget checking.
        parent=next(m for m in self.plan['materials'] if m['id']=='asset-panel')
        l,t,r,b=parent['bboxNorm']
        key='fixture-content'
        self.plan['materials'].append(dict(id=key,label='A separate replaceable illustration.',
            role='foreground',bboxNorm=[l+(r-l)*.1,t+(b-t)*.2,l+(r-l)*.4,t+(b-t)*.7],
            zOrder=parent['zOrder']+1,preserveText=[]))
        self.plan['objects'].append(dict(id='content-object',kind='illustration',materialId=key,
            label='A rigid blue illustration with empty space beside it.',bboxNorm=None))
        self.start()
        next(row for row in self.plan['layoutRegistration']['materials']
             if row['materialId']==key)['mode']='uniform'
        original=deepcopy(self.plan)
        state=self.generate()
        self.assertEqual(state['stage'],'planning_review')
        self.assertEqual(read(self.run/'planning-m1/draft.json'),original)
        self.assertEqual((self.run/'planning/m1/draft.json').read_bytes(),self.response.read_bytes())
        report=read(self.run/planning_capacity.NAME)
        ids=[mid for group in report['groups'] for mid in group['materialIds']]
        self.assertCountEqual(ids,[m['id'] for m in original['materials']])
        self.assertIn(key,ids)
        self.assertNotEqual(key,parent['id'])
        self.assertFalse((self.run/'images').exists())
        self.assertFalse((self.run/'planning/m2/draft.json').exists())
        m1=(self.run/'planning-m1/prompt.md').read_text('utf-8')
        self.assertNotIn('卡片内部插画、卡框和附属图标仍归同一完整素材',m1)
        self.assertIn('合板只是传输与生图分组',m1)
        self.assertIn('固定读数卡和固定附饰仍遵守基础合同',m1)
        m2=(self.run/'planning/m2/prompt.md').read_text('utf-8')
        self.assertIn('Grouping and call limits do not authorize merging material owners',m2)
        self.assertIn('not proof of alpha occlusion',m2)
        request=read(self.run/'planning/m2/request.json')
        self.assertEqual(request['inputs']['prompt.md'],digest(self.run/'planning/m2/prompt.md'))
        self.assertEqual(host.status(self.run)['planningModelCallsUsed'],1)

    def test_whole_frame_fit_does_not_certify_or_correct_internal_artwork(self):
        # Reproduce the actual failure class without production pixels: correct
        # outer bounds conceal an enlarged internal blue body and less whitespace.
        self.start()
        source=self.base/'distorted-card.png'
        image=Image.new('RGBA',(220,160));draw=ImageDraw.Draw(image)
        draw.rectangle((10,10,209,149),fill=(245,230,195,255))
        draw.rectangle((35,25,144,129),fill=(20,70,160,255))
        image.save(source)
        target=[40,30,240,170]
        rendered,geometry=layout.render(source,dict(materialId='synthetic-card',mode='uniform',
            measurementAlphaThreshold=128,targetBox=target))
        self.assertTrue(all(abs(v)<=1 for v in geometry['targetBoxResidualPixels']))
        self.assertFalse(geometry['observedBody'])
        self.assertFalse(geometry['sourceCompletenessAccepted'])
        self.assertFalse(geometry['humanVisualAcceptance'])
        pixels=np.asarray(rendered,dtype=np.int16)
        blue=(pixels[:,:,2]>pixels[:,:,0]+40)&(pixels[:,:,3]>128)
        y,x=np.nonzero(blue)
        # The internal body remains ~110px wide; an outer fit has not restored
        # the intended independent 60px body or its original clearances.
        self.assertGreater(x.max()-x.min()+1,100)

    def test_separate_rigid_owner_can_be_registered_without_internal_warp(self):
        self.start()
        source=self.base/'rigid-content.png'
        image=Image.new('RGBA',(140,180));draw=ImageDraw.Draw(image)
        draw.rectangle((10,10,129,169),fill=(20,70,160,255))
        image.save(source)
        rendered,geometry=layout.render(source,dict(materialId='synthetic-content',mode='uniform',
            measurementAlphaThreshold=128,targetBox=[50,40,110,120]))
        self.assertFalse(geometry['axisStretch'])
        self.assertFalse(geometry['alphaSupportClipped'])
        self.assertTrue(all(abs(v)<=1 for v in geometry['targetBoxResidualPixels']))
        self.assertEqual(geometry['mappedTargetBox'],[50,40,110,120])
        self.assertFalse(geometry['humanVisualAcceptance'])


class CompositeInternalGeometryTests(unittest.TestCase):
    setUp=sheets.HostSheetFallbackTests.setUp
    acquire=sheets.HostSheetFallbackTests.acquire

    def prepare(self, **config):
        sheets.HostSheetFallbackTests.prepare(self,materialReviewPolicy='final-composite-once-v1',**config)

    def test_actual_final_candidate_and_internal_locators_share_one_review_scope(self):
        self.prepare(maximumMaterialReviews=1,maximumBodyCalls=1)
        self.acquire(False)
        packet=read(self.run/'final-review/dispatch.json')
        request=read(self.run/'final-review/request.json')
        visual=read(self.run/'frozen/evidence/m1-draft.json')
        for material in packet['materials']:
            owned=[o for o in visual['objects'] if o['materialId']==material['materialId']]
            self.assertEqual(material['ownedObjects'],[dict(objectId=o['id'],kind=o['kind'],
                referenceBoxNorm=o.get('bboxNorm'),appearance=o['label']) for o in owned])
        self.assertIn('unmeasured reference hints',packet['prompt'])
        self.assertIn('not only outer frame alignment',packet['prompt'])
        self.assertEqual(request['inputs']['dispatch.json'],digest(self.run/'final-review/dispatch.json'))
        self.assertEqual(packet['maximumCalls'],1)
        self.assertEqual(packet['bodyObservationCalls'],0)
        self.assertEqual(packet['perRequestReviewCalls'],0)
        final=finish_composite(self,dict(summary='Offline internal enlargement warning.',findings=[dict(
            category='shape',materialIds=[packet['materials'][1]['materialId']],
            evidence='The internal body is enlarged despite matching outer frame edges.')]))
        self.assertEqual(final['stage'],'diagnostic_complete')
        self.assertEqual(final['compositeReviewCalls'],1)
        self.assertFalse(final['humanVisualAcceptance'])
        self.assertFalse((self.run/'body').exists())

    def test_internal_locator_packet_tampering_is_terminal_before_review_dispatch(self):
        self.prepare(maximumMaterialReviews=1,maximumBodyCalls=1)
        self.acquire(False)
        path=self.run/'final-review/dispatch.json';packet=read(path)
        packet['materials'][0]['ownedObjects'][0]['appearance']='Tampered reference hint'
        path.write_text(json.dumps(packet),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'CHANGED'):
            host.status(self.run)
        self.assertFalse(list((self.run/'scopes/composite_review-composite').glob('*-submission.json')))


if __name__=='__main__':unittest.main()
