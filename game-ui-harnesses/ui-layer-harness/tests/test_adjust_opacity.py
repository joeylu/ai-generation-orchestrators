import _bootstrap
import tempfile
from pathlib import Path
import unittest
import numpy as np
from PIL import Image
from ai_ui_layers.adjust_opacity import adjust
from ai_ui_layers.evaluate import digest


class OpacityTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);self.root=Path(tmp.name)
        self.source=self.root/'source.png'
        im=Image.new('RGBA',(256,2))
        im.putdata([(40,90,170,a) for a in range(256)]*2);im.save(self.source)
        self.sha=digest(self.source)

    def test_continuous_alpha_rgb_and_geometry_are_preserved(self):
        r=adjust(self.source,self.sha,.5,self.root/'out','User chose 50%')
        out=np.array(Image.open(self.root/'out/corrected.png'))
        expected=(np.arange(256)+1)//2
        np.testing.assert_array_equal(out[0,:,3],expected)
        self.assertTrue(np.all(out[0,1:,:3]==[40,90,170]))
        self.assertEqual(out[0,0].tolist(),[0,0,0,0])
        self.assertEqual(r['size'],[256,2])
        self.assertEqual(digest(self.source),self.sha)
        self.assertEqual(digest(self.root/'out/raw.png'),self.sha)
        self.assertFalse(r['humanVisualAcceptance'])
        self.assertFalse(r['originalDagPromoted'])

    def test_explicit_input_and_destination_guards(self):
        for value in (0,-1,1.1,float('nan'),float('inf'),True):
            with self.assertRaisesRegex(ValueError,'OPACITY'):
                adjust(self.source,self.sha,value,self.root/'bad','reason')
        with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):
            adjust(self.source,'bad',.5,self.root/'bad','reason')
        with self.assertRaisesRegex(ValueError,'REASON'):
            adjust(self.source,self.sha,.5,self.root/'bad',' ')
        self.assertFalse((self.root/'bad').exists())
        adjust(self.source,self.sha,1,self.root/'out','identity')
        with self.assertRaises(FileExistsError):
            adjust(self.source,self.sha,.5,self.root/'out','reason')

    def test_never_erases_entire_layer(self):
        with self.assertRaisesRegex(ValueError,'EMPTY_CORRECTION'):
            adjust(self.source,self.sha,.00001,self.root/'bad','reason')
        self.assertFalse((self.root/'bad').exists())
