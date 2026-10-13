"""Prevent near-transparent RGB from being judged as opaque visual contamination."""
import _bootstrap
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from ai_ui_layers.native_alpha_audit import analyze,audit
from ai_ui_layers.review_image import alpha_visibility_rgb

class NativeAlphaAuditTests(unittest.TestCase):
    def test_alpha_one_is_not_opaque_but_opaque_seam_is_detected(self):
        image=Image.new('RGBA',(128,64))
        image.putpixel((64,32),(255,0,255,1))
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'source.png';image.save(path)
            with Image.open(path) as raw:
                before=raw.tobytes();r=analyze(raw,[2,1]);view=alpha_visibility_rgb(raw)
                self.assertEqual(raw.tobytes(),before)
            band=r['nominalSeamBands'][0]
            self.assertEqual(band['nonzeroAlphaCount'],1)
            self.assertEqual(band['maximum8bitCompositeChannelChangeBound'],1)
            bg=alpha_visibility_rgb(Image.new('RGBA',image.size))
            self.assertLessEqual(max(abs(a-b) for a,b in zip(view.getpixel((64,32)),bg.getpixel((64,32)))),1)
            image.putpixel((64,32),(255,0,255,255));image.save(path)
            with Image.open(path) as raw:r=analyze(raw,[2,1])
            self.assertEqual(r['nominalSeamBands'][0]['maximumAlpha'],255)
            self.assertEqual(r['nominalSeamBands'][0]['atLeastEightCount'],1)

    def test_hash_binding_source_preservation_and_fresh_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'input.png';output=root/'audit'
            image=Image.new('RGBA',(64,64),(33,44,55,0))
            image.putpixel((30,30),(50,60,70,72));image.save(source)
            before=source.read_bytes();r=audit(source,output,[1,1])
            self.assertEqual(before,source.read_bytes())
            self.assertEqual(r['sourceSha256'],hashlib.sha256(before).hexdigest())
            self.assertFalse(r['qualityAccepted'])
            with Image.open(output/r['preview']) as preview:self.assertEqual(preview.mode,'RGB')
            self.assertEqual(json.loads((output/'audit.json').read_bytes()),r)
            with self.assertRaises(FileExistsError):audit(source,output,[1,1])

if __name__=='__main__':unittest.main()
