import copy
import unittest
from PIL import Image,ImageDraw
import test_compile_visual
from evaluate import read,save,digest
from freeze_visual import freeze
from automatic_registration import run,validate_answer,refine_source_bounds,BASE


class AutomaticRegistrationTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        self.visual['objects'].append(dict(id='second-button',label='Second button',kind='button',
                                          bboxNorm=None,materialId='asset-buy-button'))
        # Rebind the local fixture plan; no model or media service in tests.
        import json
        (self.run/'m1/draft.json').write_text(json.dumps(self.visual),encoding='utf-8')
        for path in (self.run/'result.json',self.run/'m2/request.json'):
            data=read(path);data['sourcePlanSha256']=digest(self.run/'m1/draft.json')
            path.write_text(json.dumps(data),encoding='utf-8')
        snapshot=self.root/'frozen';frozen=freeze(self.run,snapshot,5)
        self.raw=self.root/'raw.png';im=Image.new('RGBA',(100,100))
        draw=ImageDraw.Draw(im)
        draw.rectangle((10,10,29,29),fill=(70,80,90,128));draw.rectangle((60,10,79,29),fill=(70,80,90,128));im.save(self.raw)
        self.config=self.root/'auto.json'
        save(self.config,dict(snapshot=str(snapshot),snapshotDigest=frozen['digest'],materials={'asset-buy-button':str(self.raw)}))
        self.answer=dict(issues=[],parts=[
            dict(objectId='buy-button',fitMode='contain',fragments=[dict(sourceBox=[5,5,35,35],targetBox=[510,760,530,780])]),
            dict(objectId='second-button',fitMode='contain',fragments=[dict(sourceBox=[55,5,85,35],targetBox=[750,760,770,780])])])
        self.calls=0

    def model(self,folder):
        self.calls+=1;save(folder/'draft.json',self.answer)
        return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],responseSha256=digest(folder/'draft.json'),elapsedSeconds=.01)

    def test_complete_group_detection_model_contract_and_real_composite(self):
        output=self.root/'output';result=run(self.config,output,self.model)
        self.assertEqual(self.calls,1);self.assertEqual(result['status'],'awaiting_visual_review')
        self.assertFalse(result['humanVisualAcceptance'])
        with Image.open(output/'preview/partial-transparent.png') as im:
            self.assertEqual(im.getpixel((520,770))[3],128)
            self.assertEqual(im.getpixel((760,770))[3],128)
            self.assertEqual(im.getpixel((650,770))[3],0)
        with self.assertRaises(FileExistsError):run(self.config,output,self.model)
        self.assertEqual(self.calls,1)

    def test_missing_or_duplicate_ownership_stops_without_preview(self):
        self.answer['parts'].pop()
        with self.assertRaisesRegex(ValueError,'OWNERSHIP'):run(self.config,self.root/'output',self.model)
        self.assertEqual(read(self.root/'output/result.json')['status'],'blocked_no_retry')
        self.assertFalse((self.root/'output/preview').exists())

    def test_model_uncertainty_stops_without_guessing(self):
        self.answer['issues']=['Second control not present in generated image.']
        with self.assertRaisesRegex(ValueError,'MODEL_REPORTED'):run(self.config,self.root/'output',self.model)
        self.assertEqual(self.calls,1)

    def test_omitted_pixels_and_overlaps_rejected(self):
        objects=[o for o in self.visual['objects'] if o['materialId']=='asset-buy-button']
        schema=read(BASE/'schemas/material-registration.schema.json')
        with Image.open(self.raw) as im:
            for code,box in [('GENERATED_ARTWORK_OMITTED',[60,10,65,15]),('OVERLAPPING_FRAGMENTS',[5,5,35,35])]:
                answer=copy.deepcopy(self.answer);answer['parts'][1]['fragments'][0]['sourceBox']=box
                with self.assertRaisesRegex(ValueError,code):validate_answer(answer,schema,objects,[500,750,800,850],im,(1000,1000))

    def test_tampered_input_and_failed_transport_stop(self):
        def tamper(folder):
            transport=self.model(folder);(folder/'prompt.md').write_text('changed');return transport
        with self.assertRaisesRegex(ValueError,'INPUT_CHANGED'):run(self.config,self.root/'tampered',tamper)
        with self.assertRaisesRegex(ValueError,'TRANSPORT_FAILED'):
            run(self.config,self.root/'failed',lambda _:dict(exitCode=1,turnCompleted=False))

    def test_manual_placements_not_silently_presented_as_automatic(self):
        config=read(self.config);config['partPlacements']={'asset-buy-button':'manual.json'}
        path=self.root/'manual.json';save(path,config)
        with self.assertRaisesRegex(ValueError,'REJECTS_MANUAL'):run(path,self.root/'out',self.model)
        self.assertEqual(self.calls,0)

    def test_alpha_refinement_restores_small_clipped_edge_without_changing_target(self):
        answer=copy.deepcopy(self.answer)
        answer['parts'][0]['fragments'][0]['sourceBox']=[10,10,30,25]
        with Image.open(self.raw) as im:refined,changes=refine_source_bounds(answer,im)
        first=refined['parts'][0]['fragments'][0]
        self.assertEqual(first['sourceBox'],[10,10,30,30])
        self.assertEqual(first['targetBox'],[510,760,530,780])
        self.assertTrue(changes)
        self.assertEqual(answer['parts'][0]['fragments'][0]['sourceBox'],[10,10,30,25])

    def test_refinement_cannot_search_arbitrarily_beyond_local_box(self):
        im=Image.new('RGBA',(100,100));ImageDraw.Draw(im).rectangle((10,10,90,90),fill='white')
        answer=copy.deepcopy(self.answer);answer['parts']=answer['parts'][:1]
        answer['parts'][0]['fragments'][0]['sourceBox']=[40,40,60,60]
        with self.assertRaisesRegex(ValueError,'EXCEEDS_LOCAL_SEARCH'):refine_source_bounds(answer,im)

    def test_refinement_stays_on_its_side_of_neighbour_gap(self):
        im=Image.new('RGBA',(240,70));draw=ImageDraw.Draw(im)
        draw.rectangle((10,10,109,59),fill='white');draw.rectangle((130,10,229,59),fill='white')
        answer=copy.deepcopy(self.answer)
        answer['parts'][0]['fragments'][0]['sourceBox']=[5,10,110,55]
        answer['parts'][1]['fragments'][0]['sourceBox']=[118,10,230,55]
        refined,_=refine_source_bounds(answer,im)
        self.assertEqual(refined['parts'][0]['fragments'][0]['sourceBox'],[10,10,110,60])
        self.assertEqual(refined['parts'][1]['fragments'][0]['sourceBox'],[130,10,230,60])
