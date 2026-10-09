import _bootstrap
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw

from ai_ui_layers import host_review, planning_dag
from ai_ui_layers._core import common, contract, media, prompts, resources
from ai_ui_layers.compile_visual import HARNESS, compile_plan
from ai_ui_layers.evaluate import read


class CoreContractTests(unittest.TestCase):
    def test_local_core_and_planning_are_bound_without_retired_imports(self):
        self.assertEqual(HARNESS.name, 'ui-layer-harness')
        retired = HARNESS.parent / 'ui-decomposition-harness'
        self.assertFalse(retired.exists())
        for module in (common, contract, media, prompts, resources):
            self.assertTrue(Path(module.__file__).is_relative_to(HARNESS))
            relative = Path(module.__file__).relative_to(HARNESS.parents[1]).as_posix()
            self.assertIn(relative, host_review.runtime_files())
            self.assertIn(relative, planning_dag.runtime_files())
        plan, _ = compile_plan(read(HARNESS/'planning-harness/examples/visual-plan.json'), [1000,1000], 'a'*64)
        contract.validate(plan, verify_source=False)
        plan['assets'][0]['source_region'] = [-1,0,1000,1000]
        with self.assertRaisesRegex(ValueError, 'ASSET_REGION'):
            contract.validate(plan, verify_source=False)

    def test_public_runtime_has_no_retired_package_or_directory_dependency(self):
        for path in (HARNESS/'src').rglob('*.py'):
            source = path.read_text(encoding='utf-8')
            with self.subTest(path=path.name):
                self.assertNotIn('ui-decomposition-harness', source)
                self.assertNotRegex(source, r'(?m)^\s*(?:from|import)\s+ai_ui_decomposition\b')

    def test_path_json_and_source_integrity_survive_the_port(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for value in ('../outside', 'a/../outside', 'C:/outside', '/outside', 'a\\outside'):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    common.safe_relative(root, value)
            path = root/'duplicate.json'
            path.write_text('{"id":1,"id":2}', encoding='utf-8')
            with self.assertRaises(ValueError):
                common.read_json(path)
            image = root/'image.png'
            Image.new('RGBA',(16,12),(20,50,100,128)).save(image)
            loaded, evidence = common.load_verified_image(image, [16,12])
            self.assertEqual(loaded.size,(16,12))
            self.assertEqual(evidence['sha256'],common.sha256(image))
            with self.assertRaises(ValueError):
                common.load_verified_image(image,[12,16])

    def test_global_key_holes_spill_and_transparent_rgb_are_preserved(self):
        image = Image.new('RGBA',(64,64),(248,8,248,255))
        draw = ImageDraw.Draw(image)
        draw.rectangle((8,8,55,55),fill=(20,80,120,255))
        draw.rectangle((24,24,39,39),fill=(248,8,248,255))
        result = np.asarray(media.matte_key(image,[64,64]))
        self.assertEqual(int(result[32,32,3]),0)
        self.assertEqual(int(result[0,0,3]),0)
        self.assertEqual(int(result[16,16,3]),255)
        self.assertTrue(np.all(result[result[:,:,3]==0,:3]==0))
        fringe = (result[:,:,3]>0)&(result[:,:,3]<255)
        self.assertTrue(np.any(fringe))
        self.assertTrue(np.all(result[fringe,:3]==[20,80,120]))

    def test_native_alpha_and_legacy_prompt_behavior_remain_explicit(self):
        image = Image.new('RGBA',(4,2),(90,80,70,128))
        image.putpixel((0,0),(255,30,20,0))
        normalized=media.normalize(image)
        self.assertEqual(normalized.getpixel((0,0)),(0,0,0,0))
        self.assertEqual(normalized.getpixel((1,0)),(90,80,70,128))
        fitted=media.contain(normalized,[8,8])
        self.assertEqual(fitted.size,(8,8))
        prompt=prompts._prompt(dict(prompt='A single panel.',output_size=[100,200],route='generated_isolation',output_mode='transparent_component'))
        self.assertIn('100:200',prompt)
        self.assertIn('alpha channel',prompt)
        self.assertIn('ownership',prompts._prompt(dict(prompt='native-material-ownership-v1:',output_size=[100,200],route='generated_completion',output_mode='opaque_background')))


if __name__=='__main__':
    unittest.main()
