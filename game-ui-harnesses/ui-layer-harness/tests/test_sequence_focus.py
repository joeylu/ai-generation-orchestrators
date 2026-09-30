import _bootstrap
import copy
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw, ImageOps
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.sequence_focus import make_sequence_focus
from ai_ui_layers.review_image import fit_resampling
from ai_ui_layers.planning_dag import init, Dag
from ai_ui_layers.session_review import resume_command
from ai_ui_layers.planning_review_policy import REGIONS

SID='12345678-1234-1234-1234-123456789abc'


def fixture(root,horizontal=False):
    source=root/'source.png';image=Image.new('RGB',(480,480),(20,30,40));draw=ImageDraw.Draw(image)
    colors=[(80,150,210),(190,80,100),(100,200,90),(180,120,70),(240,180,30)]
    actual=[]
    for index,color in enumerate(colors):
        start=40+index*80
        box=[start,220,start+20,240] if horizontal else [220,start,240,start+20]
        draw.rectangle((box[0],box[1],box[2]-1,box[3]-1),fill=color);actual.append(box)
    image.save(source)
    # Matching counts: one extra record overlaps an existing shape; the last source shape is unplanned.
    declared=actual[:4]+[actual[1]]
    materials=[dict(id=f'unit-{index}',label=f'Fixture colored symbol {index}',role='foreground',
                    zOrder=10,bboxNorm=[value/480 for value in box],preserveText=[],adaptationPolicy='preserve')
               for index,box in enumerate(declared)]
    objects=[dict(id=f'object-{index}',label=row['label'],materialId=row['id'],kind='icon',bboxNorm=None)
             for index,row in enumerate(materials)]
    background=dict(id='scene',label='Plain fixture backdrop',role='background',zOrder=0,
                    bboxNorm=[0,0,1,1],preserveText=[],adaptationPolicy='preserve')
    objects.append(dict(id='backdrop',label=background['label'],materialId='scene',kind='background',bboxNorm=None))
    plan=dict(kind='ui_visual_plan_v5',coordinateSpace='reference-normalized-ltrb',materials=[background,*materials],
              objects=objects,unknowns=[],backgroundMode='scene-only',textPolicy='remove-business-text')
    return source,plan,colors[-1]


class SequenceFocusTests(unittest.TestCase):
    def test_continuous_source_keeps_missing_end_even_when_plan_counts_match(self):
        for horizontal in (False,True):
            with self.subTest(horizontal=horizontal),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);source,plan,missing_color=fixture(root,horizontal);before=copy.deepcopy(plan);original=digest(source)
                metadata=make_sequence_focus(source,plan,root)
                self.assertEqual(plan,before);self.assertEqual(digest(source),original)
                self.assertEqual(len([row for row in plan['materials'] if row['role']=='foreground']),5)
                self.assertEqual(len(metadata['pages']),1);page=metadata['pages'][0]
                self.assertEqual(page['axis'],'horizontal' if horizontal else 'vertical')
                axis=0 if horizontal else 1;self.assertEqual(page['sourceCorridor'][axis],0)
                self.assertEqual(page['sourceCorridor'][axis+2],480)
                self.assertEqual(metadata['referenceSha256'],original)
                self.assertEqual(page['imageSha256'],digest(root/page['file']))
                boxes=[row['sourceBox'] for row in page['segments']]
                self.assertLessEqual(len(boxes),6);self.assertEqual(boxes[0][axis],0);self.assertEqual(boxes[-1][axis+2],480)
                self.assertTrue(all(a[axis+2]>b[axis] for a,b in zip(boxes,boxes[1:])))
                with Image.open(source) as clean,Image.open(root/page['file']) as board:
                    self.assertIn(missing_color,[color for _,color in board.getcolors(board.width*board.height)])
                    for row in page['segments']:
                        crop=clean.crop(row['sourceBox']).convert('RGB')
                        expected=ImageOps.contain(crop,(368,528),fit_resampling(crop.size,(368,528)))
                        self.assertEqual(board.crop(row['displayBox']).tobytes(),expected.tobytes())

    def test_evidence_is_stable_under_plan_reordering_and_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,plan,_=fixture(root)
            first=root/'first';first.mkdir();second=root/'second';second.mkdir()
            a=make_sequence_focus(source,plan,first)
            reversed_plan=dict(plan,materials=list(reversed(plan['materials'])))
            b=make_sequence_focus(source,reversed_plan,second)
            self.assertEqual(a,b)
            self.assertLessEqual(len(a['pages']),2)
            plan['materials']=plan['materials'][:3]
            third=root/'third';third.mkdir();self.assertIsNone(make_sequence_focus(source,plan,third))
            self.assertEqual(list(third.iterdir()),[])
            with self.assertRaisesRegex(ValueError,'SEQUENCE_FOCUS_LIMIT'):make_sequence_focus(source,plan,third,limit=3)

    def test_full_source_axis_is_bounded_for_large_images_and_two_groups(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';Image.new('RGB',(4096,4096),(30,40,50)).save(source)
            materials=[]
            for column in (500,1800,3000):
                for row in range(5):
                    materials.append(dict(id=f'unit-{column}-{row}',role='foreground',
                        bboxNorm=[column/4096,(200+row*500)/4096,(column+24)/4096,(224+row*500)/4096]))
            metadata=make_sequence_focus(source,dict(materials=materials),root)
            self.assertEqual(len(metadata['pages']),2)
            for page in metadata['pages']:
                self.assertLessEqual(len(page['segments']),6)
                with Image.open(root/page['file']) as image:
                    self.assertLessEqual(image.width,1152);self.assertLessEqual(image.height,1152)

    def test_dag_binds_forwards_and_rejects_changed_sequence_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,plan,_=fixture(root);calls=[]
            plan['materials'][-1]['bboxNorm']=[220/480,360/480,240/480,380/480]
            run=init(source,root/'run',16)
            def fake(folder,sid,first):
                calls.append(folder.name)
                if first:answer=plan
                elif folder.name in ('m2','rereview'):
                    metadata=read(folder/'coverage-small-materials.json')
                    issue=dict(code='fixture_detail',category='semantic',ids=['unit-0'],
                        description='Fixture contrast is omitted',suggestedChange='Clarify the color')
                    labels={row['id']:row['label'] for row in plan['materials']}
                    answer=dict(issues=[issue] if folder.name=='m2' else [],coverageAudit=[
                        dict(region=region,observedArtwork='Fixture source artwork',missingFromPlan=[])
                        for region in REGIONS],smallMaterialAudit={row['materialId']:dict(
                            boundary=dict(status='complete',evidence='Fixture owned contour retained'),parts=[dict(
                            visiblePart='Fixture symbol',observedAppearance='Fixture contrast, no distinct marks',
                            planEvidenceQuote=labels[row['materialId']],descriptionStatus='consistent',
                            suggestedChange='No change')]) for row in metadata['items']})
                else:
                    clarified=copy.deepcopy(plan['materials'][1]);clarified['label']+=' with a contrasting edge'
                    answer=dict(sourcePlanSha256=digest(folder.parent/'m1/draft.json'),materials=dict(upsert=[clarified],remove=[]),
                        objects=dict(upsert=[],remove=[]),unknowns=None,backgroundMode=None,textPolicy=None,unresolvedIssues=[])
                save(folder/'draft.json',answer)
                (folder/'events.jsonl').write_text(json.dumps(dict(type='thread.started',thread_id=SID)),encoding='utf-8')
                save(folder/'transport.json',dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],
                    responseSha256=digest(folder/'draft.json'),elapsedSeconds=.01))
            dag=Dag(run,fake);result=dag.execute()
            self.assertEqual(result['status'],'frozen');self.assertEqual(calls,['m1','m2','repair','rereview'])
            original=read(run/'m2/coverage-sequence-source.json')
            for stage in ('m2','repair','rereview'):
                folder=run/stage;request=read(folder/'request.json')
                self.assertEqual(read(folder/'coverage-sequence-source.json'),original)
                for filename in ['coverage-sequence-source.json',*[row['file'] for row in original['pages']]]:
                    self.assertEqual(request['inputs'][filename],digest(folder/filename))
                images=resume_command('fixture-codex',folder,root,SID)
                attached=images[images.index('--image')+1].split(',')
                self.assertTrue(all(str(folder/row['file']) in attached for row in original['pages']))
            altered=run/'m2'/original['pages'][0]['file'];altered.write_bytes(altered.read_bytes()+b'changed')
            with self.assertRaisesRegex(ValueError,'OUTPUT_CHANGED'):dag.status()
            self.assertEqual(calls,['m1','m2','repair','rereview'])


if __name__=='__main__':unittest.main()
