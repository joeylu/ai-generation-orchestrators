"""Controlled prompt comparison preserves frozen reference and ownership."""
import _bootstrap
import json
import unittest
from ai_ui_layers import experimental_executor as exchange, sheet_layout_reference as board
from ai_ui_layers.evaluate import read,digest
import test_context_references as fixtures


class LocalEditPromptTests(unittest.TestCase):
    setUp=fixtures.ContextReferencesTests.setUp
    bind=fixtures.ContextReferencesTests.bind
    frozen=fixtures.ContextReferencesTests.frozen

    def test_same_snapshot_pixels_and_text_exceptions_in_separate_job(self):
        next(m for m in self.visual['materials'] if m['id']=='asset-coin-b')['preserveText']=['LV.9']
        self.bind()
        snapshot,manifest=self.frozen(version='v16')
        before={str(p.relative_to(snapshot)):digest(p) for p in snapshot.rglob('*') if p.is_file()}
        row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        meta,png,old=board.build(snapshot,row,prompt_version='v9')
        new_meta,new_png,new=board.build(snapshot,row,prompt_version='v10')
        self.assertEqual((meta,png),(new_meta,new_png))
        records=[json.loads(line) for line in new.splitlines() if line.startswith('{')]
        self.assertEqual(len(records),len(row['materialIds']))
        self.assertEqual([r['allowedText'] for r in records],[next(m['preserveText'] for m in self.visual['materials'] if m['id']==mid) for mid in row['materialIds']])
        self.assertLess(len(new),len(old))
        job=self.root/'comparison'
        config=exchange.prepare(snapshot,manifest['digest'],job,assets=[row['asset']],local_edit_comparison=True)
        self.assertEqual(config['maximumCalls'],1)
        self.assertEqual(exchange.status(job)['status'],'awaiting_authorization')
        _,index=exchange.load_job(job)
        self.assertEqual(exchange.frozen_request_arguments(job,config,index[row['asset']])['prompt'],new.rstrip('\n'))
        self.assertEqual(before,{str(p.relative_to(snapshot)):digest(p) for p in snapshot.rglob('*') if p.is_file()})

    def test_reject_full_job_and_old_context_before_creating_output(self):
        for version in ('v15','v16'):
            snapshot,manifest=self.frozen(name='frozen-'+version,version=version)
            job=self.root/('invalid-'+version)
            with self.assertRaisesRegex(ValueError,'LOCAL_EDIT_COMPARISON_SINGLE_V16_SHEET_REQUIRED'):
                exchange.prepare(snapshot,manifest['digest'],job,local_edit_comparison=True)
            self.assertFalse(job.exists())


if __name__=='__main__':unittest.main()
