"""Pure PNG delivery works with runtime UI, PSD and subprocesses unavailable."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from ai_ui_decomposition.assets_cli import main, parser
from ai_ui_decomposition.common import read_json, write_json, sha256


def fixture_coverage(source_sha,ids,canvas):
    return dict(kind='ui_reference_coverage_v1',sourceSha256=source_sha,
        review=dict(inventoryReviewed=True,removalsReviewed=True,basis='Authored synthetic fixture inventory'),
        elements=[dict(id=k,label=k,region=[0,0,*canvas],disposition='material',ownerAssets=[k],removedBy=[],reason='') for k in ids])


class FixtureProvider:
    """Procedural offline fixtures, never user artwork or a network provider."""
    def __init__(self, reject=False, fail=False):
        self.calls = 0
        self.reject = reject
        self.fail = fail

    def plan(self, *args, **kwargs):
        return json.dumps({"assets": [
            {"id": "scene", "role": "background", "source_region": [0, 0, 64, 48],
             "output_size": [64, 48], "prompt": "Empty blue background"},
            {"id": "button", "role": "important_component", "source_region": [4, 4, 24, 16],
             "output_size": [20, 12], "prompt": "Empty gold button"}],
            "nodes": [{"id": "scene", "asset": "scene", "xy": [0, 0]},
                      {"id": "button_one", "asset": "button", "xy": [4, 30]},
                      {"id": "button_two", "asset": "button", "xy": [36, 30]}],
            "groups": [{"id": "background", "children": ["scene"]},
                       {"id": "controls", "children": ["button_one", "button_two"]}]})

    def generate(self, bundle, *, state_dir, timeout):
        self.calls += 1
        if self.fail:
            raise RuntimeError("fixture generation failure")
        state_dir.mkdir(parents=True)
        if read_json(bundle / "handoff.json")["asset"] == "scene":
            picture = Image.new("RGB", (64, 48), "#17314a")
        else:
            picture = Image.new("RGB", (80, 60), "#f808f8")
            ImageDraw.Draw(picture).rectangle((10, 12, 69, 47), fill="#db9b31")
        result = state_dir / "raw.png"
        picture.save(result)
        return result

    def visual_qa(self, *args, **kwargs):
        return json.dumps({"decision": "reject" if self.reject else "accept", "overall_score": 90,
                           "checks": dict.fromkeys(("layout_fidelity", "component_coverage",
                                                    "text_policy", "cutout_cleanliness"), 90), "issues": []})


def run_fixture(root, *, reject=False, fail=False, authorized=True):
    reference = root / "reference.png"
    Image.new("RGB", (64, 48), "#17314a").save(reference)
    config = root / "provider.json"
    if not config.exists():
        write_json(config, {"fixture": True})
    provider = FixtureProvider(reject, fail)
    coverage=root/'coverage.json'
    if not coverage.exists():write_json(coverage,fixture_coverage(sha256(reference),['scene','button'],[64,48]))
    argv = ["auto-run", "--reference", str(reference), "--job-dir", str(root / "job"),
            "--provider-config", str(config), "--max-generation-calls", "2", "--coverage",str(coverage)]
    if authorized:
        argv.append("--allow-provider-calls-and-unreviewed-draft")
    with patch("ai_ui_decomposition.headless.load_provider", return_value=provider), \
         patch("subprocess.Popen", side_effect=AssertionError("No Node/browser/process allowed")), \
         contextlib.redirect_stdout(io.StringIO()) as output:
        code = main(argv)
    return code, json.loads(output.getvalue()), provider.calls


class AssetsCliTests(unittest.TestCase):
    def test_unreviewed_inventory_stops_automatic_image_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);reference=root/'reference.png'
            Image.new('RGB',(64,48),'#17314a').save(reference)
            coverage=fixture_coverage(sha256(reference),['scene','button'],[64,48])
            coverage['review']['inventoryReviewed']=False
            write_json(root/'coverage.json',coverage)
            code,result,calls=run_fixture(root)
            self.assertEqual(code,2)
            self.assertEqual(calls,0)
            self.assertFalse((root/'job/workspace/runs/automatic').exists())

    def test_file_exchange_reviewed_delivery_keeps_review_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.png"
            Image.new("RGB", (32, 24), "blue").save(reference)

            def invoke(*argv, expected=0):
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    code = main([str(value) for value in argv])
                self.assertEqual(code, expected, output.getvalue())
                return json.loads(output.getvalue())

            plan = root / "plan.json"
            run = root / "workspace" / "runs" / "test"
            delivery = root / "delivery"
            bundle = root / "request"
            invoke("init", "--reference", reference, "--plan", plan, "--id", "test", "--document", "test")
            invoke("check", "--plan", plan)
            invoke("freeze", "--plan", plan, "--workspace", root / "workspace", "--run", "test",expected=2)
            self.assertFalse(run.exists())
            write_json(root/'coverage.json',fixture_coverage(read_json(plan)['source']['sha256'],['scene'],[32,24]))
            invoke('coverage-bind','--plan',plan,'--coverage',root/'coverage.json','--output',root/'covered-plan.json')
            plan=root/'covered-plan.json'
            invoke("freeze", "--plan", plan, "--workspace", root / "workspace", "--run", "test")
            invoke("adapter-export", "--run-dir", run, "--asset", "scene", "--bundle", bundle)
            # Synthetic local fixture substitutes the external provider result.
            invoke("adapter-seal", "--bundle", bundle, "--source", reference)
            invoke("adapter-import", "--run-dir", run, "--bundle", bundle)
            invoke("process", "--run-dir", run)
            review = invoke("review-template", "--run-dir", run)
            invoke("finalize", "--run-dir", run, "--output", delivery, expected=2)
            self.assertFalse(delivery.exists())
            # Authored test review only; production requires the actual user's review.
            review["decision"] = "accept"
            review["reviewed_asset_ids"] = ["scene"]
            (run / "review.json").write_text(json.dumps(review), encoding="utf-8")
            invoke("finalize", "--run-dir", run, "--output", delivery)
            invoke("inspect", "--delivery", delivery)
            exported = invoke("export", "--delivery", delivery)
            with zipfile.ZipFile(delivery / exported["file"]) as archive:
                self.assertEqual(set(archive.namelist()), {"scene.json", "delivery.json", "preview.png", "layers/background.png"})

    def test_png_archive_without_component_runtime_or_psd(self):
        # Fresh interpreter: imports from other tests cannot mask dependencies.
        script = '''
import importlib.abc, sys, tempfile, zipfile, json
from pathlib import Path
class BlockRuntime(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        blocked = ('psd_tools', 'ai_ui_decomposition.cli', 'ai_ui_decomposition.component_handoff',
                   'ai_ui_decomposition.repository_workflow', 'ai_ui_decomposition.workflow',
                   'ai_ui_decomposition.native_delivery', 'ai_ui_decomposition.stateful',
                   'ai_ui_decomposition.studio_acceptance', 'ai_ui_decomposition.delivery_pipeline')
        if any(fullname == name or fullname.startswith(name + '.') for name in blocked):
            raise AssertionError('Forbidden dependency: ' + fullname)
sys.meta_path.insert(0, BlockRuntime())
from test_assets_cli import run_fixture
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    code, result, calls = run_fixture(root)
    assert code == 0, result
    assert calls == 2
    assert result['status'] == 'completed_visual_qa_draft'
    assert result['automatic_visual_acceptance'] is False
    with zipfile.ZipFile(root / 'job' / result['artifacts']['png_zip']['path']) as archive:
        assert set(archive.namelist()) == {'scene.json', 'delivery.json', 'preview.png',
            'automated-visual-qa.json', 'layers/scene.png', 'layers/button_one.png', 'layers/button_two.png'}
        scene = json.loads(archive.read('scene.json'))
        assert scene['document']['format'] == 'png_zip'
    code, result, calls = run_fixture(root)
    assert code == 0 and calls == 0, 'Completed job must not regenerate'
'''
        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join((str(Path(__file__).parent.resolve()),
                                           str(Path(__file__).resolve().parents[1] / "src")))
        result = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_authorization_quality_and_indeterminate_gates(self):
        for options, expected, calls in [({"authorized": False}, "rejected", 0),
                                         ({"reject": True}, "failed_visual_qa", 2),
                                         ({"fail": True}, "failed_no_resubmit", 1)]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                code, result, count = run_fixture(root, **options)
                self.assertEqual((code, result["status"], count), (2, expected, calls))
                self.assertFalse(list(root.rglob("*.zip")))
                if options.get("fail"):
                    code, result, count = run_fixture(root, **options)
                    self.assertEqual((code, count), (2, 0))
                    self.assertEqual(result["reason"], "JOB_ALREADY_STARTED_NO_RESUBMIT")

    def test_starter_is_png_and_runtime_commands_are_unavailable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            Image.new("RGB", (32, 24), "blue").save(root / "reference.png")
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["init", "--reference", str(root / "reference.png"),
                                       "--plan", str(root / "plan.json"), "--id", "test", "--document", "test"]), 0)
                plan = read_json(root / "plan.json")
                self.assertEqual(plan["document"]["format"], "png_zip")
                plan["document"]["format"] = "auto"
                write_json(root / "psd-plan.json", plan)
                self.assertEqual(main(["freeze", "--plan", str(root / "psd-plan.json"),
                                       "--workspace", str(root / "workspace"), "--run", "test"]), 2)
                self.assertFalse((root / "workspace").exists())
        for command in ("component-handoff", "delivery-run", "workflow-init", "studio-acceptance"):
            with self.subTest(command=command), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                parser().parse_args([command])


if __name__ == "__main__":
    unittest.main()
