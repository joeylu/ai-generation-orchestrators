"""Source-bound partial diagnostic replay; only offline host test doubles."""
import _bootstrap
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image

import test_body_soft_effects as fixtures
from ai_ui_layers import host_body_observation as host, visual_policy
from ai_ui_layers.diagnostic_body_replay import checked_replay
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.host_material_review import files
from ai_ui_layers.freeze_visual import inspect


class DiagnosticBodyReplayTests(unittest.TestCase):
    def fixture(self, fringe=False):
        f=fixtures.SoftEffectsHostTests();f.setUp();self.addCleanup(f.doCleanups);f.enable()
        if fringe:
            for row in f.visual['materials']:
                if row['role']=='foreground':
                    p=Path(read(f.inputs)['materials'][row['id']])
                    with Image.open(p) as im: image=im.convert('RGBA')
                    image.putpixel((15,27),(120,80,60,241));image.save(p)
        return f

    def inputs(self,f):
        config=host.load(f.job);job=f.root/'received-images';job.mkdir()
        bindings=[];rows=[]
        for mid,raw in config['materials'].items():
            p=job/'attempts'/mid/'raw.png';p.parent.mkdir(parents=True);p.write_bytes(Path(raw).read_bytes())
            bindings.append(dict(requestId=mid,rawSha256=digest(p)))
            rows.append(dict(asset=mid))
        manifest=inspect(f.snapshot)
        return (job,{},f.snapshot,manifest,rows,f.visual,None,None,bindings)

    def test_blocked_coverage_replay_is_partial_read_only_and_keeps_original_boxes(self):
        f=self.fixture(fringe=True);request=f.start()
        with self.assertRaisesRegex(ValueError,'SOURCE_BODY_OMITS_SOLID_ARTWORK'):
            f.receive(request,f.evidence(request))
        before=files(f.job);inputs=self.inputs(f)
        with patch('ai_ui_layers.visual_policy.snapshot_policy',return_value=visual_policy.warning_policy()), \
                patch('ai_ui_layers.diagnostic_body_replay.snapshot_policy',return_value=visual_policy.warning_policy()):
            replay=checked_replay(inputs,f.job)
        self.assertEqual(files(f.job),before)
        self.assertEqual(host.status(f.job)['status'],'blocked_no_retry')
        self.assertFalse(replay['originalDagPromoted']);self.assertEqual(replay['modelCalls'],0)
        self.assertEqual(len(replay['replayedObservations']),1)
        self.assertEqual(len(replay['missingMaterialIds']),len(host.load(f.job)['requests'])-1)
        result=replay['replayedObservations'][0]
        self.assertEqual(result['geometry']['sourceBodyBox'],f.answer['sourceBodyBox'])
        self.assertEqual(result['responseSha256'],digest(f.job/'attempts'/request['materialId']/'response.json'))
        self.assertEqual(result['geometry']['denseBoundaryCheck']['externalSolidPixels'],1)

    def test_genuine_sealed_partial_observation_and_exact_source_binding(self):
        f=self.fixture();request=f.start();f.receive(request,f.evidence(request));inputs=self.inputs(f)
        with patch('ai_ui_layers.diagnostic_body_replay.snapshot_policy',return_value=fixtures.appearance_policy()):
            replay=checked_replay(inputs,f.job)
        self.assertEqual(len(replay['replayedObservations']),1)
        inputs[-1][0]['rawSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'DIAGNOSTIC_BODY_SOURCE_MISMATCH'):
            checked_replay(inputs,f.job)

    def test_raw_response_tamper_and_unknown_failure_are_not_replayable(self):
        f=self.fixture();request=f.start();f.receive(request,f.evidence(request));inputs=self.inputs(f)
        p=f.job/'attempts'/request['materialId']/'response.json';p.write_bytes(p.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'BODY_SEALED_EVIDENCE_CHANGED'):
            checked_replay(inputs,f.job)
        f=self.fixture();request=f.start();host.fail(f.job,request['submissionDigest'],'indeterminate host return')
        with self.assertRaisesRegex(ValueError,'DIAGNOSTIC_BODY_RETURN_NOT_REPLAYABLE'):
            checked_replay(self.inputs(f),f.job)


if __name__=='__main__':unittest.main()
