"""Offline guards for shared planning wording, not model-fidelity evidence."""
import _bootstrap
import hashlib
import unittest

from ai_ui_layers.compile_visual import HARNESS
from ai_ui_layers.evaluate import read
from ai_ui_layers.session_review import build_review_prompt


BEGIN = '<!-- ui-review-checks:begin -->'
END = '<!-- ui-review-checks:end -->'
PROMPTS = HARNESS / 'planning-harness/prompts'


class CompactPlanningPromptTests(unittest.TestCase):
    def test_review_transport_keeps_critical_checks_and_excludes_repair(self):
        source = (PROMPTS / 'visual-review.md').read_text(encoding='utf-8')
        checks = source.split(BEGIN, 1)[1].split(END, 1)[0].strip()
        dispatched = build_review_prompt(source, [])
        self.assertIn(checks, dispatched)
        for anchor in ('未改区域', 'coverageAudit', '九区', 'missingFromPlan',
                       '逐字引用所属素材/对象 label', '全部四边',
                       '非 null 辅助框', '同 materialId', '200 字符',
                       '选中/未选中', '勾选/未勾选', '启用/禁用',
                       'preserveText', '显式用户许可', '目标长短比至少 4',
                       '宽高比至少 3', '保护端饰', '切片边',
                       'MINOR_COLOR_TONE', 'DESCRIPTION_WORDING'):
            with self.subTest(anchor=anchor):
                self.assertIn(anchor, checks)
                self.assertIn(anchor, dispatched)
        self.assertNotIn('宿主提供当前源计划、明确问题', dispatched)
        self.assertNotIn(BEGIN, dispatched)
        self.assertNotIn(END, dispatched)

    def test_local_repair_contract_remains_identical_to_fixed_base(self):
        source = (PROMPTS / 'visual-review.md').read_text(encoding='utf-8')
        suffix = source.split(END, 1)[1]
        self.assertEqual(len(suffix), 223)
        self.assertEqual(hashlib.sha256(suffix.encode('utf-8')).hexdigest(),
                         'cfeeea00162a93990b7a2959c0ce35981aeb64788b087ce73c5e128f7b82b8ef')

    def test_m1_retains_visual_interpretation_when_schema_owns_syntax(self):
        source = (PROMPTS / 'visual-plan.md').read_text(encoding='utf-8')
        schema = read(HARNESS / 'planning-harness/schemas/visual-plan.schema.json')
        # These syntax constraints remain in the existing attached schema.
        self.assertEqual(schema['properties']['kind']['const'], 'ui_visual_plan_v5')
        objects = schema['properties']['objects']['items']
        self.assertIn('bboxNorm', objects['required'])
        self.assertEqual(objects['properties']['label']['maxLength'], 200)
        self.assertFalse(schema['additionalProperties'])
        # The schema cannot establish these visual or authorization decisions.
        for anchor in ('static-composite', '空数组仍合理拆分',
                       '本版不复用像素', '同一图形只有一个实际归属',
                       '全部四边', '完整自有可见轮廓', '固定装饰',
                       '200 字符', '对象承载所属可见细节',
                       '独立显隐勾号', '受审查的整卡生图比例/轮廓失败证据',
                       'preserveText 是唯一留字许可', 'scene-only',
                       'preserve-underlay', '显式用户许可', '目标长短比至少 4',
                       '宽高比至少 3', '保护端饰', '不修缺失细节'):
            with self.subTest(anchor=anchor):
                self.assertIn(anchor, source)


if __name__ == '__main__':
    unittest.main()
