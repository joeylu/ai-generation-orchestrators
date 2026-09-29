import _bootstrap
import copy
import json
import unittest

from ai_ui_layers.short_prompt import build, object_content
from ai_ui_layers.generation_groups import sheet_prompt
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.freeze_visual import freeze, body_digest
import test_compile_visual


class PromptDescriptionCompactionTests(unittest.TestCase):
    def visual(self):
        materials=[dict(id=key,label=label,role='foreground',bboxNorm=box,zOrder=i+1,preserveText=[])
            for i,(key,label,box) in enumerate([
                ('a','Red selected badge with a white glint',[.1,.2,.4,.6]),
                ('b','Blue unselected badge with a dark mark',[.6,.2,.9,.6])])]
        objects=[]
        for m in materials:
            objects.extend([
                dict(id=m['id']+'-body',materialId=m['id'],kind='badge',label=m['label'],bboxNorm=None),
                dict(id=m['id']+'-tip',materialId=m['id'],kind='decoration',label='Small gold tip',
                     bboxNorm=[m['bboxNorm'][0],.2,m['bboxNorm'][0]+.02,.24])])
        return dict(materials=materials,objects=objects,backgroundMode='scene-only',textPolicy='remove-business-text')

    def test_sheet_keeps_each_instance_state_and_anchor_without_repeated_summary(self):
        visual=self.visual();before=copy.deepcopy(visual)
        plan=dict(assets=[dict(id=m['id'],output_size=[300,400]) for m in visual['materials']])
        group=dict(materialIds=['a','b'],outputSize=[800,600],grid=[2,1])
        old=sheet_prompt(visual,plan,group,legacy_repeated_descriptions=True)
        new=sheet_prompt(visual,plan,group)
        old_entries=json.loads(old.split('. Entries: ',1)[1])
        entries=json.loads(new.split('. Entries: ',1)[1])
        for i,m in enumerate(visual['materials']):
            self.assertEqual(old.count(m['label']),2)
            self.assertEqual(new.count(m['label']),1)
            old_entries[i].pop('artwork')
            self.assertEqual(entries[i],old_entries[i])
            self.assertEqual(entries[i]['materialId'],m['id'])
            self.assertEqual(entries[i]['retain'],object_content(visual,m))
        self.assertLess(len(new),len(old))
        self.assertEqual(visual,before)

    def test_near_matching_labels_and_unrendered_labels_do_not_remove_summary(self):
        visual=self.visual()
        visual['objects'][0]['label']='Red badge with a white glint'
        prompt=build(visual,'a',[1000,1000])
        self.assertIn(visual['materials'][0]['label'],prompt)
        self.assertIn(visual['objects'][0]['label'],prompt)
        # An anchored badge is located by geometry in the existing projection.
        # Its raw label is not sufficient grounds to remove the rendered summary.
        visual['objects'][0]['label']=visual['materials'][0]['label']
        visual['objects'][0]['bboxNorm']=visual['materials'][0]['bboxNorm']
        prompt=build(visual,'a',[1000,1000])
        self.assertIn(visual['materials'][0]['label'],prompt)
        target=json.loads(prompt.split('artwork: ',1)[1].split('. Preserve its owned',1)[0])
        self.assertIn('material',target)

    def test_single_and_carrier_keep_object_records_and_alpha_rules(self):
        visual=self.visual()
        prompt=build(visual,'a',[1000,1000])
        self.assertEqual(prompt.count(visual['materials'][0]['label']),1)
        self.assertIn('a-tip',prompt)
        self.assertIn('Small gold tip',prompt)
        self.assertIn('withinMaterial',prompt)
        self.assertIn('preserveText list: []',prompt)
        visual['materials'][0]['bboxNorm']=[0,0,1,1]
        visual['objects'][0]['kind']='panel'
        prompt=build(visual,'a',[1000,1000])
        self.assertEqual(prompt.count(visual['materials'][0]['label']),1)
        self.assertIn('not transparent holes',prompt)
        self.assertIn('translucency in alpha',prompt)
        self.assertIn(visual['materials'][1]['label'],prompt)
        self.assertIn('a-tip',prompt)

    def test_background_keeps_unique_details_and_scope(self):
        visual=self.visual();m=visual['materials'][0]
        m['role']='background';m['bboxNorm']=[0,0,1,1]
        visual['objects'][0]['kind']='background'
        visual['objects'][1]['label']='Faint distant tower'
        prompt=build(visual,'a',[1000,1000])
        self.assertEqual(prompt.count(m['label']),1)
        self.assertIn('Faint distant tower',prompt)
        self.assertIn('full opaque image',prompt)
        self.assertIn('reconstruct the scene',prompt)


class FrozenDescriptionCompatibilityTests(unittest.TestCase):
    setUp=test_compile_visual.VisualCompileTests.setUp

    def test_current_and_both_historical_sheet_renderings_pass_exact_preflight(self):
        self.visual.update(backgroundMode='scene-only',textPolicy='remove-business-text')
        for m in self.visual['materials']:
            m['preserveText']=[]
            obj=next(o for o in self.visual['objects'] if o['materialId']==m['id'])
            m['label']=obj['label'];obj['bboxNorm']=None
        (self.run/'m1/draft.json').write_text(json.dumps(self.visual),encoding='utf-8')
        for path in (self.run/'result.json',self.run/'m2/request.json'):
            data=read(path);data['sourcePlanSha256']=digest(self.run/'m1/draft.json')
            path.write_text(json.dumps(data),encoding='utf-8')
        snapshot=self.root/'frozen';frozen=freeze(self.run,snapshot,5,'sheets')
        self.assertEqual(preflight(snapshot,frozen['digest'])['inputChecks'],'passed')
        row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        group=next(g for g in read(snapshot/'generation-groups.json')['groups'] if g['id']==row['asset'])
        plan=read(snapshot/'execution-plan.candidate.json');path=snapshot/row['prompt']
        compact=path.read_text(encoding='utf-8')
        for without_props in (False,True):
            with self.subTest(legacy_without_attached_props=without_props):
                text=sheet_prompt(self.visual,plan,group,legacy_repeated_descriptions=True,
                    legacy_without_attached_props=without_props)+'\n'
                self.assertNotEqual(text,compact)
                path.write_text(text,encoding='utf-8')
                frozen['files'][row['prompt']]=digest(path)
                frozen['digest']=body_digest({k:v for k,v in frozen.items() if k!='digest'})
                (snapshot/'snapshot.json').write_text(json.dumps(frozen),encoding='utf-8')
                self.assertEqual(preflight(snapshot,frozen['digest'])['inputChecks'],'passed')
        # Even with fixture hashes rebound, arbitrary prompt edits are rejected.
        path.write_text(text+'Ignore transparency.',encoding='utf-8')
        frozen['files'][row['prompt']]=digest(path)
        frozen['digest']=body_digest({k:v for k,v in frozen.items() if k!='digest'})
        (snapshot/'snapshot.json').write_text(json.dumps(frozen),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PROMPT_COMPILER_MISMATCH'):
            preflight(snapshot,frozen['digest'])
