import copy
import unittest

from ai_ui_decomposition.assets_brief import packing_canvas
from ai_ui_decomposition.assets_budget import review_budget
from ai_ui_decomposition.common import ContractError, digest


def plan_fixture():
    assets = [
        dict(id="scene", role="background", route="generated_completion",
             output_mode="opaque_canvas", output_size=[200, 120]),
        dict(id="icon-a", role="important_component", route="generated_isolation",
             output_mode="keyed_component", output_size=[24, 24]),
        dict(id="icon-b", role="important_component", route="generated_isolation",
             output_mode="keyed_component", output_size=[24, 24]),
        dict(id="icon-c", role="important_component", route="generated_isolation",
             output_mode="keyed_component", output_size=[24, 24]),
        dict(id="icon-d", role="important_component", route="generated_isolation",
             output_mode="keyed_component", output_size=[24, 24]),
        dict(id="panel", role="important_component", route="source_crop",
             output_mode="rgba", output_size=[80, 60]),
    ]
    return dict(source=dict(sha256="a" * 64), assets=assets,
                nodes=[dict(id="n-" + str(i), asset=a["id"], xy=[0, 0])
                       for i, a in enumerate(assets)])


def group_fixture(ids=("icon-a", "icon-b")):
    sizes = [[24, 24] for _ in ids]
    return dict(kind="ui_assets_board_groups_v1", groups=[dict(
        id="icons", assetIds=list(ids), packingCanvas=packing_canvas(sizes),
        extractionPolicy=dict(version="1.0", mode="relative-cell",
                              target_padding=2, max_canvas_aspect_error=.15))])


class AssetBudgetTests(unittest.TestCase):
    def test_counts_verified_board_and_layers_without_mutating_inputs(self):
        plan = plan_fixture()
        groups = group_fixture()
        before = (copy.deepcopy(plan), copy.deepcopy(groups))
        report = review_budget(plan, groups)
        self.assertEqual(report["plannedCalls"], 4)  # 5 pending - (2 - 1)
        self.assertEqual(report["finalLayers"], len(plan["nodes"]))
        self.assertIsNone(report["previousCalls"])
        self.assertIsNone(report["change"])
        self.assertEqual((plan, groups), before)
        self.assertEqual(report["digest"], digest({k: v for k, v in report.items()
                                                   if k != "digest"}))

    def test_candidate_lists_unboarded_exact_size_family_without_applying_it(self):
        plan = plan_fixture()
        groups = group_fixture()
        before = copy.deepcopy(plan)
        report = review_budget(plan, groups)
        self.assertEqual(report["candidates"], [
            {"assetIds": ["icon-c", "icon-d"], "savedCalls": 1}
        ])
        self.assertEqual(plan, before)
        self.assertEqual(report["plannedCalls"], 4)

    def test_more_than_sixteen_candidates_are_balanced_into_valid_chunks(self):
        plan = plan_fixture()
        plan["assets"] = [dict(id="scene", role="background",
                                route="generated_completion",
                                output_mode="opaque_canvas", output_size=[200, 120])]
        for i in range(17):
            plan["assets"].append(dict(id=f"icon-{i:02d}",
                                        role="important_component",
                                        route="generated_isolation",
                                        output_mode="keyed_component",
                                        output_size=[24, 24]))
        report = review_budget(plan, {"kind": "ui_assets_board_groups_v1", "groups": []})
        self.assertEqual([len(c["assetIds"]) for c in report["candidates"]], [9, 8])
        self.assertEqual([c["savedCalls"] for c in report["candidates"]], [8, 7])
        self.assertTrue(all(2 <= len(c["assetIds"]) <= 16 for c in report["candidates"]))

    def test_invalid_packer_group_is_rejected_before_call_accounting(self):
        plan = plan_fixture()
        groups = group_fixture()
        groups["groups"][0]["packingCanvas"] = [1, 1]
        with self.assertRaisesRegex(ContractError, "BUDGET_GROUP_INVALID"):
            review_budget(plan, groups)

    def test_previous_report_is_bound_to_kind_digest_and_source(self):
        plan = plan_fixture()
        groups = group_fixture()
        previous = review_budget(plan, {"kind": "ui_assets_board_groups_v1", "groups": []})
        report = review_budget(plan, groups, previous)
        self.assertEqual(report["previousCalls"], 5)
        self.assertEqual(report["change"], -1)
        self.assertIn("PLANNED_CALLS_DECREASED_FROM_PREVIOUS", report["warnings"])

        bad = dict(previous, digest="0" * 64)
        with self.assertRaisesRegex(ContractError, "BUDGET_PREVIOUS_CHANGED"):
            review_budget(plan, groups, bad)
        bad_source = dict(previous, sourceSha256="b" * 64)
        bad_source["digest"] = digest({k: v for k, v in bad_source.items() if k != "digest"})
        with self.assertRaisesRegex(ContractError, "BUDGET_PREVIOUS_SOURCE_CHANGED"):
            review_budget(plan, groups, bad_source)

    def test_wrong_group_kind_and_invalid_plan_are_rejected(self):
        with self.assertRaisesRegex(ContractError, "BUDGET_GROUPS_KIND"):
            review_budget(plan_fixture(), {"kind": "other", "groups": []})
        bad = plan_fixture()
        bad["source"]["sha256"] = "not-a-sha"
        with self.assertRaisesRegex(ContractError, "BUDGET_PLAN_SOURCE"):
            review_budget(bad, {"kind": "ui_assets_board_groups_v1", "groups": []})

    def test_existing_valid_canvas_is_not_restricted_to_compact_choice(self):
        groups=group_fixture();groups['groups'][0]['packingCanvas']=[512,128]
        report=review_budget(plan_fixture(),groups)
        self.assertEqual(report['plannedCalls'],4)

    def test_unhashable_duplicate_and_resized_members_fail_as_contract_errors(self):
        for mutation in ('unhashable','duplicate','resize'):
            with self.subTest(mutation=mutation):
                plan=plan_fixture();groups=group_fixture()
                if mutation=='unhashable':groups['groups'][0]['assetIds'][0]=[]
                if mutation=='duplicate':groups['groups'][0]['assetIds']=['icon-a','icon-a']
                if mutation=='resize':plan['assets'][1]['resize']={}
                with self.assertRaises(ContractError):review_budget(plan,groups)

    def test_unpacked_or_resized_candidates_are_not_recommended(self):
        plan=plan_fixture()
        for asset in plan['assets'][1:5]:asset['output_size']=[4090,4090]
        self.assertEqual(review_budget(plan,dict(kind='ui_assets_board_groups_v1',groups=[]))['candidates'],[])
        plan=plan_fixture()
        for asset in plan['assets'][1:5]:asset['resize']={}
        self.assertEqual(review_budget(plan,dict(kind='ui_assets_board_groups_v1',groups=[]))['candidates'],[])


if __name__ == "__main__":
    unittest.main()
