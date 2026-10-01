"""Review rules are selected by an explicit stage, never their document position."""
import _bootstrap
import unittest

from ai_ui_layers.compile_visual import HARNESS
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.session_review import build_review_prompt
import test_planning_dag


BEGIN='<!-- ui-review-checks:begin -->'
END='<!-- ui-review-checks:end -->'


class ReviewStageContractTests(unittest.TestCase):
    def test_explicit_review_after_repair_stays_review_only(self):
        source=('## 第一步：检查\nLegacy checks\n## 第二步：修补\nDo not dispatch this repair.\n'
                +BEGIN+'\nCheck the original contour and adaptation eligibility.\n'+END)
        prompt=build_review_prompt(source,[])
        self.assertIn('Check the original contour and adaptation eligibility.',prompt)
        self.assertNotIn('Do not dispatch this repair.',prompt)
        self.assertNotIn('Legacy checks',prompt)
        self.assertNotIn(BEGIN,prompt);self.assertNotIn(END,prompt)

    def test_malformed_stage_fails_instead_of_silently_falling_back(self):
        legacy='## 第一步：检查\nLegacy checks\n## 第二步：修补\nRepair'
        for marked in (BEGIN+'\nChecks', 'Checks\n'+END,
                       '<!-- ui-review-checks:bengin -->\nChecks\n'+END,
                       END+'\nChecks\n'+BEGIN,
                       BEGIN+'\nChecks\n'+BEGIN+'\n'+END,
                       BEGIN+'\nChecks\n'+END+'\n'+END,
                       BEGIN+'\n\n'+END,
                       BEGIN+'\n## 第二步：修补\nRepair\n'+END):
            with self.subTest(marked=marked):
                with self.assertRaisesRegex(ValueError,'REVIEW_STAGE_BOUNDARY'):
                    build_review_prompt(legacy+'\n'+marked,[])

    def test_published_source_keeps_all_checks_in_the_review_stage(self):
        source=(HARNESS/'planning-harness/prompts/visual-review.md').read_text(encoding='utf-8')
        self.assertEqual(source.count(BEGIN),1);self.assertEqual(source.count(END),1)
        checks=source.split(BEGIN,1)[1].split(END,1)[0].strip()
        prompt=build_review_prompt(source,[])
        self.assertIn(checks,prompt)
        for rule in ('Material adaptationPolicy defaults to preserve.',
                     'Horizontal-frame-slice applies only',
                     '核对重复卡片比例时', '规划/定位问题',
                     'coverageAudit', 'missingFromPlan', 'preserveText',
                     'MINOR_COLOR_TONE', 'DESCRIPTION_WORDING'):
            self.assertIn(rule,prompt)
        self.assertNotIn('宿主提供当前源计划、明确问题',prompt)
        self.assertNotIn(BEGIN,prompt);self.assertNotIn(END,prompt)

    def test_m2_and_rereview_receive_the_complete_stage_without_extra_calls(self):
        test_planning_dag.DagTests.setUp(self)
        fake=test_planning_dag.FakeModel(repair=True)
        def model(folder,sid,first):
            fake(folder,sid,first)
            if folder.name in ('m2','rereview'):
                prompt=(folder/'prompt.md').read_text(encoding='utf-8')
                self.assertIn('Material adaptationPolicy defaults to preserve.',prompt)
                self.assertIn('核对重复卡片比例时',prompt)
                self.assertIn('全部四边覆盖完整自有可见轮廓',prompt)
                self.assertIn('observedArtwork 只列保留图形，businessText 只列待删除普通业务文字',prompt)
                self.assertIn('普通业务文字只填各区 businessText，不列入 smallMaterialAudit.parts',prompt)
                self.assertIn('cosmeticIssues 只用 schema 允许的 code',prompt)
                self.assertIn('协议填 typed-review-v3',prompt)
                self.assertIn('planEvidenceId',prompt)
                self.assertNotIn('证据逐字引用所属素材/对象 label',prompt)
                self.assertNotIn('宿主提供当前源计划、明确问题',prompt)
        self.assertEqual(Dag(self.root,model).execute()['status'],'frozen')
        self.assertEqual([name for name,_ in fake.calls],['m1','m2','repair','rereview'])
