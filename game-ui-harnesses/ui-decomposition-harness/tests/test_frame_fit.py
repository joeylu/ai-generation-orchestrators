import unittest,hashlib,copy
import numpy as np
from PIL import Image,ImageDraw
from ai_ui_decomposition.frame_fit import fit_frame,validate_frames
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.component_boards import crop_board
from ai_ui_decomposition.media import matte_key
from ai_ui_decomposition.relative_board import gap_windows
from test_content_gap_board import board,picture

class FrameFitTests(unittest.TestCase):
    def test_row_frame_preserves_end_band_after_proportional_height_fit(self):
        im=Image.new('RGBA',(200,40),'white');ImageDraw.Draw(im).rectangle((175,12,185,26),fill='blue')
        spec=self.spec(im);spec.update(version='1.1',role='row-frame',resize=dict(mode='height_then_nine_slice',insets=[10,4,30,4]))
        out,_=fit_frame(im,[120,24],2,spec)
        scaled=im.resize((100,20),Image.Resampling.LANCZOS)
        self.assertEqual(out.crop((103,2,118,22)).tobytes(),scaled.crop((85,0,100,20)).tobytes())
        spec['role']='empty-frame'
        validate_frames({'tab':spec},board())
        self.assertEqual(fit_frame(im,[120,24],2,spec)[0].tobytes(),out.tobytes())

    def spec(self,im):
        return dict(version='1.0',role='empty-frame',supportSha256=hashlib.sha256(im.tobytes()).hexdigest(),supportSize=list(im.size),resize=dict(mode='nine_slice',insets=[6,6,6,6]),evidence='Local fixture measured 6px corners.')

    def test_corners_unchanged_and_hash_size_target_fail_closed(self):
        im=Image.new('RGBA',(100,30),'#EFE5CE');d=ImageDraw.Draw(im)
        d.rectangle((0,0,5,5),fill='red');d.rectangle((94,24,99,29),fill='blue')
        spec=self.spec(im);out,r=fit_frame(im,[50,40],2,spec)
        self.assertEqual(out.crop((2,2,8,8)).tobytes(),im.crop((0,0,6,6)).tobytes())
        self.assertEqual(out.crop((42,32,48,38)).tobytes(),im.crop((94,24,100,30)).tobytes())
        self.assertEqual(out.getpixel((0,0)),(0,0,0,0));self.assertFalse(r['human_visual_acceptance'])
        for change in [dict(supportSha256='0'*64),dict(supportSize=[99,30])]:
            bad={**spec,**change}
            with self.assertRaisesRegex(ContractError,'SUPPORT_CHANGED'):fit_frame(im,[50,40],2,bad)
        with self.assertRaisesRegex(ContractError,'TARGET_TOO_SMALL'):fit_frame(im,[14,14],2,spec)

    def test_schema_identity_role_and_policy(self):
        im=Image.new('RGBA',(30,30),'white');spec=self.spec(im);b=board()
        for change in [dict(version='2'),dict(role='icon'),dict(evidence=''),dict(resize=dict(mode='stretch',insets=[6]*4))]:
            with self.assertRaises(ContractError):validate_frames({'tab':{**spec,**change}},b)
        with self.assertRaisesRegex(ContractError,'UNKNOWN_PART'):validate_frames({'missing':spec},b)
        b['extraction_policy']['version']='1.0'
        with self.assertRaisesRegex(ContractError,'CONTENT_POLICY'):validate_frames({'tab':spec},b)

    def test_only_explicit_frame_bypasses_aspect_icon_still_checked(self):
        b=board();im=picture();d=ImageDraw.Draw(im)
        d.rectangle((10,20,89,59),fill='#F808F8');d.rectangle((10,30,89,45),fill='#DDD0BB')
        a=np.asarray(im);from ai_ui_decomposition.media import KEY_RGB
        f=np.linalg.norm(a.astype(float)-KEY_RGB,axis=2)>=145
        windows=gap_windows(f,b['slots'],b['extraction_policy'],['tab']);box=windows['tab']
        cut=matte_key(im.crop(box),[box[2]-box[0],box[3]-box[1]]);cut=cut.crop(cut.getchannel('A').getbbox())
        with self.assertRaisesRegex(ContractError,'PART_ASPECT'):crop_board(im,b,'keyed_component')
        parts,rows=crop_board(im,b,'keyed_component',measured_frames={'tab':self.spec(cut)})
        self.assertEqual(parts['tab'].size,(84,44));self.assertIn('measuredFrame',rows[0]);self.assertNotIn('measuredFrame',rows[1])
