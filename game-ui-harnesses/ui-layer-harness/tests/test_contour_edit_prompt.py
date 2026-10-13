"""A contour-only prompt comparison must preserve source and ownership evidence."""
import _bootstrap
import unittest
from ai_ui_layers import experimental_executor as exchange,sheet_layout_reference as board
from ai_ui_layers.evaluate import read,digest
from ai_ui_layers.local_edit_prompt import CONTOUR_SCOPE
import test_context_references as fixtures

class ContourEditPromptTests(unittest.TestCase):
    setUp=fixtures.ContextReferencesTests.setUp
    bind=fixtures.ContextReferencesTests.bind
    frozen=fixtures.ContextReferencesTests.frozen

    def test_only_contour_paragraph_changes_and_job_has_fresh_authorization(self):
        snapshot,manifest=self.frozen(version='v16')
        before={str(p.relative_to(snapshot)):digest(p) for p in snapshot.rglob('*') if p.is_file()}
        row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        meta,png,old=board.build(snapshot,row,prompt_version='v10')
        new_meta,new_png,new=board.build(snapshot,row,prompt_version='v11')
        self.assertEqual((meta,png),(new_meta,new_png))
        self.assertEqual(new.replace(CONTOUR_SCOPE+'\n\n',''),old)
        job=self.root/'contour'
        config=exchange.prepare(snapshot,manifest['digest'],job,assets=[row['asset']],
            local_edit_comparison=True,contour_edit_comparison=True)
        self.assertEqual(config['maximumCalls'],1)
        self.assertEqual(exchange.status(job)['status'],'awaiting_authorization')
        _,index=exchange.load_job(job)
        self.assertEqual(exchange.frozen_request_arguments(job,config,index[row['asset']])['prompt'],new.rstrip('\n'))
        self.assertEqual(before,{str(p.relative_to(snapshot)):digest(p) for p in snapshot.rglob('*') if p.is_file()})

    def test_contour_option_requires_explicit_isolated_comparison(self):
        with self.assertRaisesRegex(ValueError,'CONTOUR_EDIT_REQUIRES'):
            exchange.prepare(self.root/'missing','a'*64,self.root/'invalid',contour_edit_comparison=True)
        self.assertFalse((self.root/'invalid').exists())

if __name__=='__main__':unittest.main()
