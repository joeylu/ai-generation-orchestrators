import unittest
import numpy as np
from PIL import Image
from ai_ui_decomposition.reviewed_recovery import preserve_canvas_alpha,prepare
from ai_ui_decomposition.cached import verified_result,_verified_result
from ai_ui_decomposition.common import read_json,sha256
import test_deferred_preflight as fixtures
from ai_ui_decomposition import workflow as w


class RecoveryAlphaTests(unittest.TestCase):
    def test_preserves_soft_alpha_magenta_and_edge_pixels_without_crop(self):
        a=np.zeros((12,16,4),dtype=np.uint8)
        a[0,0]=[248,8,248,17];a[5,6]=[240,20,240,128];a[6,7]=[30,90,50,255]
        result=preserve_canvas_alpha(Image.fromarray(a),[16,12])
        np.testing.assert_array_equal(np.asarray(result),a)

    def test_opaque_and_empty_are_not_alpha_recovery(self):
        for mode,color in [('RGB','red'),('RGBA',(0,0,0,255)),('RGBA',(0,0,0,0))]:
            with self.assertRaisesRegex(ValueError,'RECOVERY_NATIVE_ALPHA_REQUIRED'):
                preserve_canvas_alpha(Image.new(mode,(10,10),color),[10,10])

    def test_partial_opacity_is_preserved_not_normalized_to_opaque(self):
        im=Image.new('RGBA',(12,12));im.putpixel((5,5),(10,20,30,253))
        self.assertEqual(preserve_canvas_alpha(im,[12,12]).getchannel('A').getextrema(),(0,253))


class RecoveryProvenanceTests(unittest.TestCase):
    preflight_mode='after-generation-v1'
    setUp=fixtures.DeferredPreflightTests.setUp
    tearDown=fixtures.DeferredPreflightTests.tearDown
    authorize=fixtures.DeferredPreflightTests.authorize
    collect=fixtures.DeferredPreflightTests.collect
    paths=fixtures.DeferredPreflightTests.paths

    def test_failed_quality_stays_failed_and_tampering_is_rejected(self):
        self.collect();w.advance(self.job)
        compiled,run=self.paths()
        report=read_json(self.job/'nodes/process/output/material-preflight.json')
        bad=next(r for r in report['materials'] if r['status']=='failed')
        frozen,_,_,raw=_verified_result(run,bad['asset'],revision_errors=set(bad['errors']))
        before=sha256(raw.parent/'quality.json')
        with self.assertRaisesRegex(ValueError,'MATERIAL_QUALITY_FAILED'):
            verified_result(run,bad['asset'])
        self.assertEqual(sha256(raw.parent/'quality.json'),before)
        raw.write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError,'MATERIAL_QUALITY_CHANGED'):
            _verified_result(run,bad['asset'],revision_errors=set(bad['errors']))

    def test_no_revision_cannot_materialize_failed_result(self):
        self.collect();w.advance(self.job)
        compiled,run=self.paths()
        frozen=read_json(run/'batch.json')
        spec=dict(version='1.0',batchDigest=frozen['digest'],revisions={})
        with self.assertRaisesRegex(ValueError,'RECOVERY_REVISIONS_REQUIRED'):
            prepare(compiled,run,spec,self.base/'recovery',self.base/'consumer')
        self.assertFalse((self.base/'recovery').exists())
