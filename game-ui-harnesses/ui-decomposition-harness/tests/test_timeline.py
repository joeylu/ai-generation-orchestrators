import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from ai_ui_decomposition import timeline as t
from ai_ui_decomposition.common import ContractError


class TimelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.ref=self.root/'ref.png';self.ref.write_bytes(b'reference')
        self.package=self.root/'draft.zip';self.package.write_bytes(b'package')
        self.directory=self.root/'clock'

    def stamps(self,seconds):
        from datetime import datetime,timezone,timedelta
        base=datetime(2026,1,1,tzinfo=timezone.utc)
        return [dict(utc=(base+timedelta(seconds=s)).isoformat(),monotonic=100+s) for s in seconds]

    def test_complete_wall_clock_includes_authorization_and_failures(self):
        with patch.object(t,'_stamp',side_effect=self.stamps([0,2,12,15,20])):
            t.begin(self.directory,self.ref)
            t.transition(self.directory,'approval','authorization_wait')
            t.transition(self.directory,'generation','generation')
            t.transition(self.directory,'repair','code_repair','failed')
            result=t.finish(self.directory,self.package,'blocked')
        self.assertEqual(result['totalElapsedSeconds'],20)
        self.assertEqual(result['categorySeconds']['authorization_wait'],10)
        self.assertEqual(result['phases'][2]['status'],'failed')
        self.assertTrue(result['attributionComplete'])
        self.assertFalse(result['human_visual_acceptance'])
        self.assertIn('| approval | authorization_wait |',t.markdown(result))
        with self.assertRaisesRegex(ContractError,'CLOSED'):t.transition(self.directory,'extra','tests')

    def test_exception_and_unclassified_gap_are_not_hidden(self):
        with patch.object(t,'_stamp',side_effect=self.stamps([0,1,3,9])):
            t.begin(self.directory,self.ref)
            with self.assertRaisesRegex(RuntimeError,'broken'):
                with t.measured(self.directory,'processing','processing'):raise RuntimeError('broken')
            result=t.finish(self.directory,None,'failed')
        self.assertEqual(result['categorySeconds']['unclassified'],6)
        self.assertEqual(result['phases'][1]['status'],'failed')
        self.assertFalse(result['attributionComplete'])

    def test_changed_clock_is_unknown_not_negative_or_fake_elapsed(self):
        stamps=self.stamps([0,10]);stamps[1]['monotonic']=1
        with patch.object(t,'_stamp',side_effect=stamps):
            t.begin(self.directory,self.ref);result=t.finish(self.directory,self.package,'draft')
        self.assertIsNone(result['totalElapsedSeconds'])
        self.assertFalse(result['clockConsistent'])

    def test_tamper_rejected_and_live_report_remains_open(self):
        with patch.object(t,'_stamp',side_effect=self.stamps([0,4])):
            t.begin(self.directory,self.ref);result=t.report(self.directory)
        self.assertFalse(result['closed']);self.assertEqual(result['totalElapsedSeconds'],4)
        path=self.directory/'000000.json';row=json.loads(path.read_text());row['phase']='changed'
        path.write_text(json.dumps(row))
        with self.assertRaisesRegex(ContractError,'CHANGED'):t.report(self.directory)

    def test_cli_brackets_actual_command(self):
        from ai_ui_decomposition.cli import main
        t.begin(self.directory,self.ref)
        with patch('ai_ui_decomposition.cli.execute',return_value={'status':'ok'}):
            self.assertEqual(main(['--timeline',str(self.directory),'--timing-category','tests','self-test']),0)
        result=t.finish(self.directory,self.package,'draft')
        self.assertEqual(result['phases'][1]['phase'],'self-test')
        self.assertEqual(result['phases'][1]['category'],'tests')
        self.assertFalse(result['attributionComplete'])
