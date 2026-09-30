"""Offline checks for ownership fidelity and immutable board prompt versions."""
import _bootstrap
import copy
import hashlib
import json
import unittest

from ai_ui_layers import context_references as context
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers import sheet_layout_reference as board
from ai_ui_layers.ownership_actions import board_prompt
import test_sheet_layout_reference


class OwnershipActionsTests(unittest.TestCase):
    def test_foreign_unique_ornaments_and_repeated_instances_survive_compilation(self):
        owned = dict(id='card', role='foreground', label='Owned card',
                     bboxNorm=[.1,.1,.9,.5], preserveText=['A'], zOrder=1)
        parent = dict(id='underlay', role='foreground', label='Parent panel',
                      bboxNorm=[0,0,1,1], preserveText=[], zOrder=0)
        foreign = dict(id='badge', role='foreground', label='Foreign badge',
                       bboxNorm=[.6,.2,.8,.4], preserveText=[], zOrder=2)
        visual = dict(materials=[parent,owned,foreign], objects=[
            dict(id='card-body',materialId='card',kind='card',label='Owned card',bboxNorm=None),
            dict(id='owned-icon',materialId='card',kind='icon',label='Owned letter pictogram',bboxNorm=[.2,.2,.3,.3]),
            dict(id='panel',materialId='underlay',kind='panel',label='Parent panel',bboxNorm=None),
            dict(id='badge-body',materialId='badge',kind='icon',label='Foreign badge',bboxNorm=None),
            dict(id='badge-crest',materialId='badge',kind='decoration',label='Three-point purple crest',bboxNorm=None),
            dict(id='badge-dot-1',materialId='badge',kind='decoration',label='Red dot',bboxNorm=None),
            dict(id='badge-dot-2',materialId='badge',kind='decoration',label='Red dot',bboxNorm=None)])
        before=copy.deepcopy(visual)
        asset=dict(id='card',role='important_component',source_region=[100,100,900,500],output_size=[800,400])
        ref=context.geometry(asset,[1000,1000])
        old=context.entry(visual,owned,asset,ref,[1000,1000],0)
        new=context.entry(visual,owned,asset,ref,[1000,1000],0,include_exclusion_details=True)
        self.assertTrue(all('excludeArtwork' not in item for item in old['exclude']))
        self.assertEqual([{k:v for k,v in item.items() if k!='excludeArtwork'} for item in new['exclude']],old['exclude'])
        self.assertEqual(new['exclude'][1]['excludeArtwork'],
                         ['Foreign badge','Three-point purple crest','Red dot','Red dot'])
        self.assertEqual(new['parts'],old['parts'])
        self.assertEqual(visual,before)
        new.update(referenceIndex=1,cropIndex=1,boardCropBox=[.1,.1,.9,.9])
        prompt=board_prompt([new],[1000,1000],[1,1])
        keep=json.loads(prompt.split('KEEP: ',1)[1].split('\n',1)[0])
        removed=json.loads(prompt.split('REMOVE complete foreign units, including backing, frames and ornaments: ',1)[1].split('\n',1)[0])
        self.assertEqual(keep['parts'],old['parts'])
        self.assertEqual(removed,new['exclude'])
        self.assertEqual(keep['surface'],'owned-artwork')
        self.assertIn('preserveText list: ["A"]',prompt)
        self.assertIn('retain genuine openings and translucency',prompt)
        self.assertIn('single-character icon pictograms',prompt)
        self.assertIn('boxes are locators, not masks',prompt)
        self.assertIn("cannot delete another cell's KEEP",prompt)
        self.assertLess(prompt.index('REMOVE overrides'),prompt.index('Preserve KEEP'))


class BoardActionCompatibilityTests(unittest.TestCase):
    def setUp(self):
        test_sheet_layout_reference.SheetLayoutReferenceTests.setUp(self)

    def test_legacy_prompt_fingerprint_and_new_board_pixels_are_identical(self):
        old=board.build(self.snapshot,self.row)
        self.assertEqual(hashlib.sha256(old[2].encode()).hexdigest(),
            'ed7fb67cde99e2beba0b3563c42a3c9b01ddcd1c774dd97ec50b834e170a5bd6')
        new=board.build(self.snapshot,self.row,prompt_version='v2')
        self.assertEqual(old[:2],new[:2])
        self.assertNotEqual(old[2],new[2])
        self.assertEqual(new,board.build(self.snapshot,self.row,prompt_version='v2'))
        sections=new[2].split('\n\n')
        for i,section in enumerate(sections):
            self.assertIn(f'Cell {i} / {self.row["materialIds"][i]}',section)
            self.assertLess(section.index('KEEP: '),section.index('REMOVE complete'))
            self.assertLess(section.index('REMOVE complete'),section.index('AFTER REMOVAL: '))
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_PROMPT_VERSION'):
            board.build(self.snapshot,self.row,prompt_version='unknown')

    def test_old_descriptor_still_rebuilds_and_new_descriptor_cannot_downgrade(self):
        legacy=self.root/'legacy-job';legacy.mkdir()
        old=board.materialize(legacy,self.snapshot,self.row,prompt_version='v1')
        self.assertNotIn('promptVersion',old)
        board.verify(legacy,self.snapshot,self.row,old)
        job=self.root/'new-job';job.mkdir()
        new=board.materialize(job,self.snapshot,self.row)
        self.assertEqual(new['promptVersion'],'v2')
        board.verify(job,self.snapshot,self.row,new)
        changed=copy.deepcopy(new);changed.pop('promptVersion')
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):
            board.verify(job,self.snapshot,self.row,changed)
        changed=copy.deepcopy(new);changed['promptVersion']='v1'
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):
            board.verify(job,self.snapshot,self.row,changed)

    def test_new_exchange_freezes_actions_and_rejects_rehashed_remove_tampering(self):
        snapshot=json.loads((self.snapshot/'snapshot.json').read_text(encoding='utf-8'))
        job=self.root/'exchange'
        config=exchange.prepare(self.snapshot,snapshot['digest'],job,[self.row['asset']],
                                reference_mode='sheet-layout-board')
        self.assertEqual(config['sheetLayoutReference']['promptVersion'],'v2')
        exchange.load_job(job)
        prompt=job/'sheet-layout/prompt.txt'
        prompt.write_text(prompt.read_text(encoding='utf-8').replace('REMOVE complete','KEEP all'),encoding='utf-8')
        descriptor=config['sheetLayoutReference']
        descriptor['sha256']['sheet-layout/prompt.txt']=hashlib.sha256(prompt.read_bytes()).hexdigest()
        # Even a caller rehashing the job cannot substitute the compiler's actions.
        from ai_ui_layers.freeze_visual import body_digest
        config['digest']=body_digest({k:v for k,v in config.items() if k!='digest'})
        (job/'job.json').write_text(json.dumps(config,ensure_ascii=False),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):
            exchange.load_job(job)


if __name__=='__main__':
    unittest.main()
