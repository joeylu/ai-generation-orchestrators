"""Protected row geometry through the public extraction-revision producer."""
import copy
import hashlib
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from ai_ui_decomposition.board_extraction_revision import revise
from ai_ui_decomposition.common import read_json, sha256, write_json
from ai_ui_decomposition.component_boards import plan_boards
from ai_ui_decomposition.media import matte_key


class ProtectedGridRevisionTests(unittest.TestCase):
    def test_revision_reproduces_and_retains_source_and_protected_mark(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raw = Image.new('RGB', (244, 84), '#F808F8')
            draw = ImageDraw.Draw(raw)
            draw.rectangle((22, 12, 221, 71), fill='#CFE4FA')
            draw.rectangle((162, 12, 165, 71), fill='#368AC9')
            draw.line((182, 39, 188, 46, 198, 34), fill='#0758B2', width=3)
            raw.save(root / 'raw.png')
            policy = dict(version='1.2', mode='foreground-gap-row',
                          canvas_policy='content-bounds', separation_basis='mixed-height',
                          max_internal_gap_ratio=.08, max_part_aspect_error=.5,
                          target_padding=2)
            strategy = plan_boards(dict(kind='ai_ui_material_observations_v2',
                strategy='component-family-board-v1', packing_canvas=[256, 256],
                extraction_policy=policy, assets=[dict(id='selected', component_type='List',
                component_group='rows', target_size=[100, 40], source_reusable=False,
                source_evidence='')]))
            write_json(root / 'strategy.json', strategy)
            matted = matte_key(raw, list(raw.size))
            support = matted.crop(matted.getchannel('A').getbbox())
            self.assertEqual(support.size, (202, 62))
            spec = dict(version='1.2', role='row-frame', supportSize=[202, 62],
                supportSha256=hashlib.sha256(support.tobytes()).hexdigest(),
                evidence='Procedural fixture: preserve check and corners, position divider.',
                resize=dict(mode='protected_grid', scale=[1, 2],
                    sourceX=[0, 8, 140, 144, 158, 178, 194, 202],
                    sourceY=[0, 8, 20, 40, 54, 62],
                    targetX=[0, 4, 64, 66, 73, 83, 92, 96],
                    targetY=[0, 4, 12, 22, 32, 36],
                    markCell=[4, 2], dividerColumn=2))
            def run(folder, frame=spec):
                return revise(root / 'raw.png', root / 'strategy.json', 'rows',
                    sha256(root / 'raw.png'), policy, 'Reviewed protected-grid fixture.',
                    root / folder, {'selected': frame},
                    source_regions={'selected': [0, 0, 244, 84]})
            first, second = run('one'), run('two')
            self.assertEqual(first['digest'], second['digest'])
            output = Image.open(root / 'one/selected.png').convert('RGBA')
            scaled = support.resize((101, 31), Image.Resampling.LANCZOS)
            self.assertEqual(output.crop((75, 14, 85, 24)).tobytes(),
                             scaled.crop((79, 10, 89, 20)).tobytes())
            self.assertEqual(output.size, (100, 40))
            self.assertEqual(output.getpixel((0, 0)), (0, 0, 0, 0))
            self.assertEqual(first['sourceStrategy'], strategy)
            self.assertEqual(first['measuredFrames']['selected'], spec)
            recorded = read_json(root / 'one/extraction-revision.json')
            self.assertFalse(recorded['human_visual_acceptance'])
            bad = copy.deepcopy(spec)
            bad['supportSha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'SUPPORT_CHANGED'):
                run('bad-source', bad)
