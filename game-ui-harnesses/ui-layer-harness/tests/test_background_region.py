import _bootstrap
import copy
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

import numpy as np
from PIL import Image, PngImagePlugin
from ai_ui_layers import background_region as region


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def chunk(kind,value):
    return struct.pack('>I',len(value))+kind+value+struct.pack('>I',zlib.crc32(kind+value)&0xffffffff)


class BackgroundRegionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.source=self.root/'source.png';self.proposal=self.root/'proposal.png'
        self.edit=self.root/'edit.png';self.weights=self.root/'weights.png'
        rng=np.random.default_rng(4)
        self.a=rng.integers(0,256,(7,9,3),dtype=np.uint8)
        self.b=rng.integers(0,256,(7,9,3),dtype=np.uint8)
        self.w=np.zeros((7,9),dtype=np.uint8);self.w[2:5,2:7]=255
        self.w[2,2:7]=[1,64,128,192,254]
        Image.fromarray(self.a).save(self.source);Image.fromarray(self.b).save(self.proposal)
        Image.fromarray((self.w>0).astype(np.uint8)*255).save(self.edit)
        Image.fromarray(self.w).save(self.weights)

    def freeze(self,output=None,**overrides):
        values=dict(source=self.source,source_sha256=sha(self.source),edit_mask=self.edit,
            edit_sha256=sha(self.edit),blend_mask=self.weights,blend_sha256=sha(self.weights),
            output=output or self.root/'plan',background_mode='scene-only',
            text_policy='remove-business-text',reason='Fixture explicit permitted region')
        values.update(overrides);return region.freeze(**values)

    def apply(self,plan,output=None):
        return region.apply(self.root/'plan',plan['digest'],self.proposal,sha(self.proposal),output or self.root/'result')

    def test_pixel_protection_core_transition_and_original_bytes(self):
        original={p.name:p.read_bytes() for p in (self.source,self.proposal,self.edit,self.weights)}
        plan=self.freeze();self.assertEqual(region.inspect(self.root/'plan',plan['digest']),plan)
        result=self.apply(plan)
        with Image.open(self.root/'result/candidate.png') as image:actual=np.array(image)
        np.testing.assert_array_equal(actual[self.w==0],self.a[self.w==0])
        np.testing.assert_array_equal(actual[self.w==255],self.b[self.w==255])
        # Independent scalar arithmetic for every transition channel, including near endpoints.
        for y,x in zip(*np.where((self.w>0)&(self.w<255))):
            for channel in range(3):
                numerator=int(self.a[y,x,channel])*(255-int(self.w[y,x]))+int(self.b[y,x,channel])*int(self.w[y,x])
                self.assertEqual(int(actual[y,x,channel]),(numerator+127)//255)
        for p in (self.source,self.proposal,self.edit,self.weights):self.assertEqual(p.read_bytes(),original[p.name])
        self.assertEqual((self.root/'result/source.png').read_bytes(),original['source.png'])
        self.assertEqual((self.root/'result/proposal.png').read_bytes(),original['proposal.png'])
        self.assertEqual(result['status'],'candidate_pending_visual_review')
        self.assertFalse(result['maskCoverageProven']);self.assertFalse(result['generationReceiptVerified'])
        self.assertFalse(result['originalDagPromoted']);self.assertEqual(result['generationCalls'],0)

    def test_bad_hash_has_no_output(self):
        with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):self.freeze(source_sha256='0'*64)
        self.assertFalse((self.root/'plan').exists())

    def test_binary_mask_and_identical_support_required(self):
        for label,value in [('nonbinary',128),('support',0)]:
            with self.subTest(label=label):
                mask=(self.w>0).astype(np.uint8)*255;mask[3,3]=value
                Image.fromarray(mask).save(self.edit)
                with self.assertRaises(ValueError):self.freeze()
                self.assertFalse((self.root/'plan').exists())

    def test_protected_pixels_and_full_core_required(self):
        for weight in (np.full((7,9),255,dtype=np.uint8),np.where(self.w>0,128,0).astype(np.uint8),np.zeros((7,9),dtype=np.uint8)):
            with self.subTest(weight=int(weight.max())):
                Image.fromarray(weight).save(self.weights)
                Image.fromarray((weight>0).astype(np.uint8)*255).save(self.edit)
                with self.assertRaises(ValueError):self.freeze()

    def test_geometry_mask_mode_transparency_and_orientation(self):
        raw=self.edit.read_bytes()
        for mode,size,kwargs in [('L',(8,7),{}),('RGB',(9,7),{}),('L',(9,7),{'transparency':0}),
                                 ('L',(9,7),{'exif':Image.Exif()})]:
            if 'exif' in kwargs:kwargs['exif'][274]=6
            with self.subTest(mode=mode,size=size,kwargs=str(kwargs)):
                Image.new(mode,size).save(self.edit,**kwargs)
                with self.assertRaises(ValueError):self.freeze()
                self.edit.write_bytes(raw)

    def test_opaque_source_and_proposal_required(self):
        source_raw=self.source.read_bytes()
        Image.new('RGBA',(9,7),(1,2,3,254)).save(self.source)
        with self.assertRaisesRegex(ValueError,'OPAQUE'):self.freeze()
        self.source.write_bytes(source_raw);plan=self.freeze()
        Image.new('RGBA',(9,7),(1,2,3,254)).save(self.proposal)
        with self.assertRaisesRegex(ValueError,'OPAQUE'):self.apply(plan)
        self.assertFalse((self.root/'result').exists())

    def test_proposal_size_orientation_and_byte_limits(self):
        plan=self.freeze()
        Image.new('RGB',(10,7)).save(self.proposal)
        with self.assertRaisesRegex(ValueError,'CANVAS_MISMATCH'):self.apply(plan)
        exif=Image.Exif();exif[274]=6;Image.new('RGB',(9,7)).save(self.proposal,exif=exif)
        with self.assertRaisesRegex(ValueError,'ORIENTED'):self.apply(plan)
        with patch.object(region,'MAX_BYTES',1):
            with self.assertRaisesRegex(ValueError,'FILE_SIZE'):self.freeze(output=self.root/'limited')
        with patch.object(region,'MAX_SIDE',8):
            with self.assertRaisesRegex(ValueError,'IMAGE_SIZE'):self.freeze(output=self.root/'side')

    def test_color_metadata_preserved_and_mismatch_rejected(self):
        metadata=PngImagePlugin.PngInfo();metadata.add(b'sRGB',b'\0');metadata.add(b'gAMA',struct.pack('>I',45455))
        metadata.add(b'cHRM',struct.pack('>8I',31270,32900,64000,33000,30000,60000,15000,6000))
        Image.fromarray(self.a).save(self.source,pnginfo=metadata)
        plan=self.freeze()
        with self.assertRaisesRegex(ValueError,'COLOR_PROFILE_MISMATCH'):self.apply(plan)
        Image.fromarray(self.b).save(self.proposal,pnginfo=metadata)
        self.apply(plan)
        with Image.open(self.source) as source,Image.open(self.root/'result/candidate.png') as candidate:
            for key in ('srgb','gamma','chromaticity'):self.assertEqual(source.info[key],candidate.info[key])

    def test_icc_metadata_is_bound(self):
        profile=b'fixture-profile-bytes'
        Image.fromarray(self.a).save(self.source,icc_profile=profile);plan=self.freeze()
        with self.assertRaisesRegex(ValueError,'COLOR_PROFILE_MISMATCH'):self.apply(plan)
        Image.fromarray(self.b).save(self.proposal,icc_profile=profile);self.apply(plan)
        with Image.open(self.root/'result/candidate.png') as candidate:self.assertEqual(candidate.info['icc_profile'],profile)

    def test_late_color_chunks_and_trailing_data_rejected(self):
        raw=self.source.read_bytes();color=chunk(b'gAMA',struct.pack('>I',45455))
        for malformed in (raw+color,raw[:-12]+color+raw[-12:],raw+b'junk'):
            with self.subTest(length=len(malformed)):
                self.source.write_bytes(malformed)
                with self.assertRaises(ValueError):self.freeze()
                self.assertFalse((self.root/'plan').exists())

    def test_conflicting_icc_and_srgb_rejected(self):
        Image.fromarray(self.a).save(self.source,icc_profile=b'fixture-profile-bytes')
        raw=self.source.read_bytes()
        self.source.write_bytes(raw[:33]+chunk(b'sRGB',b'\0')+raw[33:])
        with self.assertRaisesRegex(ValueError,'CONFLICTING_COLOR_PROFILE'):self.freeze()

    def test_sixteen_bit_rgb_and_rgba_rejected_before_lossy_projection(self):
        plan=self.freeze()
        for color_type,channels in ((2,3),(6,4)):
            header=struct.pack('>IIBBBBB',9,7,16,color_type,0,0,0)
            pixel=struct.pack('>HHH',0x0701,0x1302,0x3503)+(b'\xff\xfe' if channels==4 else b'')
            data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',header)+chunk(b'IDAT',zlib.compress((b'\0'+pixel*9)*7))+chunk(b'IEND',b'')
            with self.subTest(color_type=color_type):
                self.source.write_bytes(data)
                with self.assertRaisesRegex(ValueError,'8_BIT'):self.freeze(output=self.root/'sixteen')
                self.proposal.write_bytes(data)
                with self.assertRaisesRegex(ValueError,'8_BIT'):self.apply(plan)
                self.assertFalse((self.root/'result').exists())

    def test_rehashed_missing_or_changed_semantics_rejected(self):
        plan=self.freeze();file=self.root/'plan/plan.json'
        variants=[]
        changed=copy.deepcopy(plan);del changed['evidence'];variants.append(changed)
        changed=copy.deepcopy(plan);changed['evidence']['humanVisualAcceptance']=True;variants.append(changed)
        changed=copy.deepcopy(plan);changed['artifacts']['source.png']['path']='../outside.png';variants.append(changed)
        changed=copy.deepcopy(plan);changed['blendPolicy']['rounding']='floor';variants.append(changed)
        changed=copy.deepcopy(plan);changed['counts']['corePixels']=0;variants.append(changed)
        for changed in variants:
            with self.subTest(changed=changed.keys()):
                changed['digest']=region.body_digest({k:v for k,v in changed.items() if k!='digest'})
                file.write_text(json.dumps(changed),encoding='utf-8')
                with self.assertRaisesRegex(ValueError,'STRUCTURE_OR_EVIDENCE'):region.inspect(file.parent,changed['digest'])

    def test_preview_reconstruction_and_file_whitelist(self):
        plan=self.freeze();file=self.root/'plan/preview.png';raw=file.read_bytes()
        file.write_bytes(self.source.read_bytes())
        with self.assertRaisesRegex(ValueError,'PREVIEW'):region.inspect(file.parent,plan['digest'])
        file.write_bytes(raw);(file.parent/'extra.txt').write_text('extra')
        with self.assertRaisesRegex(ValueError,'WHITELIST'):region.inspect(file.parent,plan['digest'])

    def test_existing_output_and_plan_nesting_rejected(self):
        plan=self.freeze();before=(self.root/'plan/plan.json').read_bytes()
        with self.assertRaises(FileExistsError):self.freeze()
        with self.assertRaisesRegex(ValueError,'OVERLAP'):self.apply(plan,self.root/'plan/child')
        self.assertEqual(before,(self.root/'plan/plan.json').read_bytes())

    def test_ancestor_link_detection(self):
        # Emulate a symlink ancestor without requiring OS symlink privileges.
        ordinary=Path.is_symlink
        ancestor=self.root/'linked'
        with patch.object(Path,'is_symlink',lambda p:p==ancestor or ordinary(p)):
            with self.assertRaisesRegex(ValueError,'LINK_PATH'):self.freeze(output=ancestor/'child')


if __name__=='__main__':unittest.main()
