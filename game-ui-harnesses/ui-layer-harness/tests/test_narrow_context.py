"""Reference-only context reduction preserves target samples and all prompt bytes."""
import _bootstrap
import io
import unittest
from unittest.mock import patch
from PIL import Image
from ai_ui_layers import experimental_executor as exchange,sheet_layout_reference as board
from ai_ui_layers.evaluate import read
import test_context_references as fixtures

class NarrowContextTests(unittest.TestCase):
    setUp=fixtures.ContextReferencesTests.setUp
    bind=fixtures.ContextReferencesTests.bind
    frozen=fixtures.ContextReferencesTests.frozen

    def test_reference_pixels_and_prompt_unchanged_inside_retained_context(self):
        # Test packing independently of role classification (covered separately).
        with patch('ai_ui_layers.output_role_prompt.is_substrate',return_value=True):
            snapshot,manifest=self.frozen(version='v16')
            row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
            old_meta,old_png,old_prompt=board.build(snapshot,row,prompt_version='v10')
            meta,png,prompt=board.build(snapshot,row,prompt_version='v10',reference_policy='target-context-eight-source-pixels-v1')
            self.assertEqual(prompt,old_prompt)
            old=Image.open(io.BytesIO(old_png));new=Image.open(io.BytesIO(png))
            for a,b in zip(old_meta['cells'],meta['cells']):
                self.assertEqual({k:v for k,v in b.items() if k!='retainedContextBox'},a)
                l,t,r,d=b['retainedContextBox'];x,y=b['boardCropBox'][:2];s=b['integerScale']
                box=(x+l*s,y+t*s,x+r*s,y+d*s)
                self.assertEqual(old.crop(box).tobytes(),new.crop(box).tobytes())
                full=b['boardCropBox'];expected=Image.new('RGBA',old.size,board.NEUTRAL_GRAY)
                expected.paste(old.crop(box),box[:2])
                self.assertEqual(new.crop(full).tobytes(),expected.crop(full).tobytes())
            job=self.root/'focused'
            exchange.prepare(snapshot,manifest['digest'],job,assets=[row['asset']],
                local_edit_comparison=True,narrow_context_comparison=True)
            self.assertEqual(exchange.status(job)['status'],'awaiting_authorization')
            path=job/'context-boards'/row['asset']/board.BOARD
            damaged=Image.open(path).convert('RGBA')
            damaged.putpixel((0,0),(255,0,0,255));damaged.save(path)
            with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_ARTIFACT_CHANGED'):
                exchange.load_job(job)

    def test_reject_unscoped_or_non_substrate_reference_reduction(self):
        snapshot,manifest=self.frozen(version='v16')
        row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        with self.assertRaisesRegex(ValueError,'NARROW_CONTEXT_REQUIRES'):
            exchange.prepare(snapshot,manifest['digest'],self.root/'invalid',narrow_context_comparison=True)
        with self.assertRaisesRegex(ValueError,'SUBSTRATES_REQUIRED'):
            board.build(snapshot,row,prompt_version='v10',reference_policy='target-context-eight-source-pixels-v1')

if __name__=='__main__':unittest.main()
