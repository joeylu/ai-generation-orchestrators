import tempfile,unittest
from pathlib import Path
from PIL import Image,ImageDraw
from ai_ui_decomposition.common import write_json
from ai_ui_decomposition.material_preflight import check_material

class LongControlPreflightTests(unittest.TestCase):
    def test_shortened_rail_fails_before_materialization(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            write_json(root/'material-catalog.json',{'strategies':{}})
            write_json(root/'plan.json',{'assets':[dict(id='rail',route='generated_isolation',output_size=[400,20],output_mode='keyed_component')]})
            raw=root/'raw.png';im=Image.new('RGB',(500,200),'#F808F8')
            ImageDraw.Draw(im).rectangle((100,80,299,119),fill='#226644');im.save(raw)
            with self.assertRaisesRegex(ValueError,'LONG_CONTROL_SUPPORT_ASPECT_MISMATCH'):
                check_material(root,'rail',raw)
