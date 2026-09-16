import tempfile,unittest
from pathlib import Path
from PIL import Image,ImageDraw
from ai_ui_decomposition.common import sha256,ContractError
from ai_ui_decomposition.material_refit import apply_refit

class MaterialRefitTests(unittest.TestCase):
    def test_frame_fills_visible_width_without_stretching_corner(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'frame.png';im=Image.new('RGBA',(100,40));ImageDraw.Draw(im).rectangle((25,2,74,37),fill='white',outline='red',width=3);im.save(p)
            spec=dict(version='1.0',operation='visible-frame-nine-slice',sourceSha256=sha256(p),evidence='Measured empty frame',alphaBounds=[25,2,75,38],insets=[5]*4,padding=2)
            out,_=apply_refit(p,spec,{})
            self.assertEqual(out.getchannel('A').getbbox(),(2,2,98,38));self.assertEqual(out.getpixel((3,3)),im.getpixel((26,3)))
            spec['sourceSha256']='0'*64
            with self.assertRaisesRegex(ContractError,'SOURCE_CHANGED'):apply_refit(p,spec,{})

    def test_canonical_alpha_palette_evidence_and_invalid_patch(self):
        with tempfile.TemporaryDirectory() as t:
            c,p=Path(t)/'c.png',Path(t)/'p.png'
            a=Image.new('RGBA',(30,30));ImageDraw.Draw(a).ellipse((2,2,27,27),fill='#173A3E');a.save(c)
            b=Image.new('RGBA',(30,30));ImageDraw.Draw(b).rectangle((2,2,27,27),fill='#FCF2D6');b.save(p)
            spec=dict(version='1.0',operation='monochrome-state-from-canonical',sourceSha256=sha256(p),evidence='Explicit palette and glyph',canonicalLayerId='c',canonicalSha256=sha256(c),paletteLayerId='p',paletteSha256=sha256(p),paletteRect=[12,12,3,3])
            out,proof=apply_refit(p,spec,dict(c=c,p=p))
            self.assertEqual(out.getchannel('A').tobytes(),a.getchannel('A').tobytes());self.assertEqual(proof['paletteRgb'],[252,242,214]);self.assertNotEqual(out.tobytes(),a.tobytes())
            spec['paletteRect']=[0,0,3,3]
            with self.assertRaisesRegex(ContractError,'NOT_SOLID'):apply_refit(p,spec,dict(c=c,p=p))
            spec['paletteRect']=[12,12,3,3];spec['canonicalSha256']='0'*64
            with self.assertRaisesRegex(ContractError,'REFERENCE_CHANGED'):apply_refit(p,spec,dict(c=c,p=p))
