import tempfile
import unittest
from pathlib import Path
from PIL import Image,ImageDraw
from evaluate import save,digest,read
from place_parts import place

class PartsTests(unittest.TestCase):
    def test_explicit_frame_part_matches_both_declared_edges(self):
        contract=read(self.contract)
        contract['parts'][0].update(targetBox=[50,60,90,80],fitMode='frame-bounds')
        self.contract=self.root/'frame.json';save(self.contract,contract)
        report=place(self.raw,self.ref,self.contract,[0,0,100,100],['button'],self.root/'out')
        with Image.open(self.root/'out/material.png') as im:
            self.assertEqual(im.getchannel('A').getbbox(),(50,60,90,80))
        self.assertTrue(report['parts'][0]['fitting']['warnings'])
    def test_one_object_can_place_disconnected_fragments_without_expanding_gap(self):
        contract=read(self.contract)
        contract['parts']=[{'objectId':'button','fragments':[
            {'sourceBox':[5,5,35,35],'targetBox':[10,10,30,30]},
            {'sourceBox':[5,5,35,35],'targetBox':[70,10,90,30]}]}]
        self.contract=self.root/'fragments.json';save(self.contract,contract)
        place(self.raw,self.ref,self.contract,[0,0,100,100],['button'],self.root/'out')
        with Image.open(self.root/'out/material.png') as im:
            self.assertEqual(im.getpixel((20,20))[3],128)
            self.assertEqual(im.getpixel((80,20))[3],128)
            self.assertEqual(im.getpixel((50,20))[3],0)
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);self.root=Path(tmp.name)
        self.raw=self.root/'raw.png';self.ref=self.root/'ref.png';self.contract=self.root/'contract.json'
        im=Image.new('RGBA',(100,100));ImageDraw.Draw(im).rectangle((10,10,29,29),fill=(10,20,30,128));im.save(self.raw)
        Image.new('RGB',(100,100)).save(self.ref)
        save(self.contract,{'kind':'material-parts-placement-v1','sourceSha256':digest(self.raw),'referenceSha256':digest(self.ref),
            'parts':[{'objectId':'button','sourceBox':[5,5,35,35],'targetBox':[60,70,80,90]}]})
    def test_explicit_target_replaces_group_center(self):
        place(self.raw,self.ref,self.contract,[0,0,100,100],['button'],self.root/'out')
        with Image.open(self.root/'out/material.png') as im:
            self.assertEqual(im.getchannel('A').getbbox(),(60,70,80,90))
            self.assertEqual(im.getpixel((65,75))[3],128)
    def test_changed_source_and_incomplete_ownership_rejected(self):
        with self.assertRaisesRegex(ValueError,'OWNERSHIP'):place(self.raw,self.ref,self.contract,[0,0,100,100],['button','missing'],self.root/'out')
        Image.new('RGBA',(100,100)).save(self.raw)
        with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):place(self.raw,self.ref,self.contract,[0,0,100,100],['button'],self.root/'out')
    def test_target_outside_region_rejected_before_output(self):
        with self.assertRaisesRegex(ValueError,'TARGET_OUTSIDE'):place(self.raw,self.ref,self.contract,[0,0,50,50],['button'],self.root/'out')
        self.assertFalse((self.root/'out').exists())
