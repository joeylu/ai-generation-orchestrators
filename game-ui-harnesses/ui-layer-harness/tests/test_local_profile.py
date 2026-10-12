"""Offline profiling must preserve bytes, errors and exclusive cost accounting."""
import _bootstrap
import hashlib
import io
from contextlib import redirect_stdout
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from PIL import Image

from ai_ui_layers import local_profile as profile, benchmark
from ai_ui_layers.evaluate import digest


class LocalProfileTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name)

    def fixture(self, root, compression=zipfile.ZIP_STORED):
        root.mkdir()
        image=Image.new('RGBA',(128,96),(20,40,60,180))
        image.tobytes()  # The shared native encoder also serializes raw pixels.
        path=root/'layer.png';image.save(path)
        raw=path.read_bytes();sha=hashlib.sha256(raw).hexdigest()
        archive=root/'layers.zip'
        with zipfile.ZipFile(archive,'x',compression=compression) as zipped:
            info=zipfile.ZipInfo('layer.png',(2020,1,1,0,0,0));info.compress_type=compression
            zipped.writestr(info,raw)
        with zipfile.ZipFile(archive) as zipped:
            self.assertIsNone(zipped.testzip())
            self.assertEqual(zipped.read('layer.png'),raw)
        return dict(png=sha,archive=digest(archive))

    def test_real_profile_preserves_bytes_and_partitions_native_encoder(self):
        expected=self.fixture(self.root/'ordinary')
        recorder=profile.LocalProfile(True)
        actual=recorder.call('fixture',self.fixture,self.root/'profiled')
        self.assertEqual(actual,expected)
        self.assertIsNone(sys.getprofile())
        result=recorder.report();row=result['operations'][0]
        for name in ('png_encoding','image_buffers','file_open','file_read','file_write','hashing','crc','zip_structure'):
            self.assertGreater(row['categories'][name]['functionCalls'],0,name)
        self.assertEqual(row['categories']['zip_compression']['functionCalls'],0)
        self.assertAlmostEqual(sum(r['selfSeconds'] for r in row['categories'].values()),row['profiledSelfSeconds'],places=7)
        self.assertGreaterEqual(row['wallSeconds'],row['profiledSelfSeconds'])
        self.assertGreaterEqual(row['processCpuSeconds'],0)
        self.assertEqual(profile.archive_methods(self.root/'profiled')['memberCountsByMethod'],{'0':1})

    def test_zip_deflate_is_distinct_from_png_encoder_and_detected_in_metadata(self):
        recorder=profile.LocalProfile(True)
        recorder.call('compressed-fixture',self.fixture,self.root/'deflated',zipfile.ZIP_DEFLATED)
        categories=recorder.report()['operations'][0]['categories']
        self.assertGreater(categories['zip_compression']['functionCalls'],0)
        self.assertGreater(categories['zip_decompression']['functionCalls'],0)
        self.assertEqual(profile.archive_methods(self.root/'deflated')['memberCountsByMethod'],{'8':1})

    def test_disabled_profile_does_not_install_or_construct_a_profiler(self):
        recorder=profile.LocalProfile()
        with patch.object(profile.cProfile,'Profile',side_effect=AssertionError('Disabled profiler')):
            self.assertEqual(recorder.call('fixture',lambda *, value:value,value=7),7)
        self.assertEqual(recorder.operations,[])

    def test_failure_propagates_and_releases_profiler(self):
        recorder=profile.LocalProfile(True)
        def failed():raise ValueError('OFFLINE_TECHNICAL_FAILURE')
        with self.assertRaisesRegex(ValueError,'OFFLINE_TECHNICAL_FAILURE'):recorder.call('failed',failed)
        self.assertIsNone(sys.getprofile())
        self.assertEqual(recorder.operations[0]['outcome'],'error')

    def test_existing_profiler_is_preserved_and_function_never_runs(self):
        def existing(frame,event,arg):pass
        sys.setprofile(existing)
        try:
            with self.assertRaisesRegex(ValueError,'LOCAL_PROFILE_ALREADY_ACTIVE'):
                profile.LocalProfile(True).call('fixture',lambda:self.fail('Must not run'))
            self.assertIs(sys.getprofile(),existing)
        finally:sys.setprofile(None)

    def test_shared_encoder_caller_times_are_split_once_without_paths(self):
        private='C:\\Users\\private-user\\secret\\PIL\\ImageFile.py'
        raw='C:\\Users\\private-user\\secret\\PIL\\Image.py'
        key=('~',0,"<method 'encode' of 'ImagingEncoder' objects>")
        stats={key:(5,5,7.0,7.0,{(private,1,'_encode_tile'):(2,2,4.0,4.0),
                                  (raw,2,'tobytes'):(3,3,3.0,3.0)}),
               (private,1,'_encode_tile'):(2,2,1.0,5.0,{})}
        result=profile.summarize(stats,operation='fixture',wall=8,cpu=6,outcome='returned')
        self.assertEqual(result['categories']['png_encoding']['selfSeconds'],5)
        self.assertEqual(result['categories']['image_buffers']['selfSeconds'],3)
        self.assertEqual(sum(r['selfSeconds'] for r in result['categories'].values()),8)
        self.assertNotIn('private-user',str(result))
        self.assertNotIn('secret',str(result))

    def test_profile_option_requires_replay_before_any_output(self):
        output=self.root/'result'
        with self.assertRaisesRegex(ValueError,'LOCAL_PROFILE_REPLAY_REQUIRED'):
            benchmark.run_suite('unused-suite','unused-evidence',output,profile_local=True)
        self.assertFalse(output.exists())

    def test_shared_compressor_is_attributed_to_zip_only_by_caller(self):
        key=('~',0,"<method 'compress' of 'zlib.Compress' objects>")
        stats={key:(5,5,7.0,7.0,{('/public/zipfile/__init__.py',1,'write'):(2,2,4.0,4.0),
                                 ('/public/other_codec.py',2,'compress'):(3,3,3.0,3.0)})}
        row=profile.summarize(stats,operation='fixture',wall=7,cpu=5,outcome='returned')
        self.assertEqual(row['categories']['zip_compression']['selfSeconds'],4)
        self.assertEqual(row['categories']['other_codecs']['selfSeconds'],3)
        self.assertEqual(row['categories']['png_encoding']['selfSeconds'],0)

    def test_cli_forwards_profile_flag(self):
        args=['ui_layer.py','benchmark','--suite','s','--evidence','e','--output','o',
              '--replay-received','--profile-local']
        with patch.object(sys,'argv',args), patch.object(benchmark,'run_suite',return_value={'regressionCount':0}) as run:
            with redirect_stdout(io.StringIO()):benchmark.main()
        run.assert_called_once_with('s','e','o',replay_received=True,profile_local=True)


if __name__=='__main__':unittest.main()
