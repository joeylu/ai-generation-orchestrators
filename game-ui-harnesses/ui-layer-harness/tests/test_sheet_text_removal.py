"""Regressions for CJK labels copied through a KEEP description on a sheet."""
import _bootstrap
from copy import deepcopy
import json
import unittest

from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers import sheet_layout_reference as board
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.freeze_visual import body_digest
from test_reference_edit_prompts import assert_edit_only
import test_context_references as fixtures


class SheetTextRemovalTests(unittest.TestCase):
    setUp=fixtures.ContextReferencesTests.setUp
    bind=fixtures.ContextReferencesTests.bind
    frozen=fixtures.ContextReferencesTests.frozen

    def freeze_labels(self):
        for obj in self.visual['objects']:
            if obj['id']=='coin-a':obj['label']='Green control with 继续 label, outlined text and a leaf icon'
            if obj['id']=='coin-b':obj['label']='Brown control with 菜单 label, text shadow and a star icon'
        next(m for m in self.visual['materials'] if m['id']=='asset-coin-b')['preserveText']=['LV.9','印记']
        self.bind()
        snapshot,manifest=self.frozen(version='v13')
        row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        return snapshot,manifest,row

    def test_native_arguments_prioritize_text_removal_and_scope_exact_exceptions_per_cell(self):
        snapshot,manifest,row=self.freeze_labels()
        job=self.root/'job';config=exchange.prepare(snapshot,manifest['digest'],job)
        descriptor=config['contextBoardReferences'][row['asset']]
        self.assertEqual(descriptor['promptVersion'],'v5')
        args=exchange.frozen_request_arguments(job,config,row)
        self.assertEqual(len(args['referenced_image_paths']),1)
        self.assertEqual(config['automaticRetries'],0)
        self.assertEqual(config['maximumCalls'],len(config['assets']))
        expected={'asset-coin-a':[], 'asset-coin-b':['LV.9','印记']}
        for i,mid in enumerate(row['materialIds']):
            section=args['prompt'].split(f'Cell {i} / {mid}\n',1)[1].split('\n\n',1)[0]
            self.assertLess(section.index('TEXT REMOVE overrides KEEP'),section.index('KEEP: '))
            exceptions=section.split('Exact preserveText exceptions for THIS cell only: ',1)[1].split('. An empty list',1)[0]
            self.assertEqual(json.loads(exceptions),expected[mid])
            self.assertIn('普通中文及其他语言的标签、文字和数字',section)
            self.assertIn('文字的描边、阴影和发光',section)
            self.assertIn('An empty list permits no ordinary text',section)
            self.assertIn('a label is not an icon merely because it has one character',section)
            self.assertIn('Retain owned icon pictograms',section)
            self.assertIn('Do not copy text from another cell',section)
        assert_edit_only(self,args['prompt'])
        self.assertEqual(exchange.load_job(job)[0],config)

    def test_new_text_rule_leaves_reference_pixels_metadata_and_ownership_intact(self):
        snapshot,manifest,row=self.freeze_labels()
        before=digest(snapshot/'snapshot.json')
        old=board.build(snapshot,row,prompt_version='v4')
        new=board.build(snapshot,row,prompt_version='v5')
        self.assertEqual(old[:2],new[:2])
        for i,mid in enumerate(row['materialIds']):
            for prefix in ('KEEP: ', 'REMOVE complete foreign units, including backing, frames and ornaments: ', 'LOCATION: '):
                left=old[2].split(f'Cell {i} / {mid}\n',1)[1].split(prefix,1)[1].split('\n',1)[0]
                right=new[2].split(f'Cell {i} / {mid}\n',1)[1].split(prefix,1)[1].split('\n',1)[0]
                self.assertEqual(json.loads(left),json.loads(right))
        self.assertIn('BACKGROUND OWNERSHIP',new[2])
        self.assertEqual(digest(snapshot/'snapshot.json'),before)

    def test_historical_v4_replays_but_new_descriptor_cannot_be_downgraded(self):
        snapshot,manifest,row=self.freeze_labels()
        old_job=self.root/'historical';old_job.mkdir()
        old=board.materialize(old_job,snapshot,row,prompt_version='v4')
        self.assertIsNone(board.verify(old_job,snapshot,row,old))
        job=self.root/'new';job.mkdir()
        descriptor=board.materialize(job,snapshot,row,prompt_version='v5')
        self.assertIsNone(board.verify(job,snapshot,row,descriptor))
        changed=deepcopy(descriptor);changed['promptVersion']='v4'
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):
            board.verify(job,snapshot,row,changed)
        # Updating stored hashes does not authorize replacing compiler actions.
        prompt=job/board.PROMPT
        prompt.write_text(board.build(snapshot,row,prompt_version='v4')[2],encoding='utf-8')
        changed=deepcopy(descriptor)
        changed['sha256'][board.PROMPT]=digest(prompt)
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):
            board.verify(job,snapshot,row,changed)
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_ARTIFACT_CHANGED'):
            board.verify(job,snapshot,row,descriptor)

    def test_explicit_board_and_default_context_both_freeze_v5_and_reject_prompt_tampering(self):
        snapshot,manifest,row=self.freeze_labels()
        job=self.root/'explicit'
        config=exchange.prepare(snapshot,manifest['digest'],job,[row['asset']],reference_mode='sheet-layout-board')
        self.assertEqual(config['sheetLayoutReference']['promptVersion'],'v5')
        args=exchange.frozen_request_arguments(job,config,row)
        self.assertIn('TEXT REMOVE overrides KEEP',args['prompt'])
        prompt=job/board.PROMPT
        prompt.write_text(prompt.read_text(encoding='utf-8').replace('TEXT REMOVE overrides KEEP','KEEP overrides TEXT REMOVE'),encoding='utf-8')
        config['sheetLayoutReference']['sha256'][board.PROMPT]=digest(prompt)
        config['digest']=body_digest({k:v for k,v in config.items() if k!='digest'})
        (job/'job.json').write_text(json.dumps(config),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):
            exchange.load_job(job)


if __name__=='__main__':unittest.main()
