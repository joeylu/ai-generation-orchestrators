import tempfile
import unittest
from pathlib import Path
from evaluate import save
from post_generation_review import prepare,receive

class ReviewTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        self.source=self.root/'image.png';self.source.write_bytes(b'fixture')
        self.packet=self.root/'packet';prepare(self.source,self.source,{'panel':self.source},self.packet,['ordinary text'])
        self.candidate=self.root/'candidate.json'
    def test_empty_review_still_waits_for_user(self):
        save(self.candidate,{'issues':[]})
        r=receive(self.packet,self.candidate,'host-visual')
        self.assertEqual(r['status'],'awaiting_user_decision')
        self.assertFalse(r['automaticCorrection']);self.assertEqual(r['generationCalls'],0)
    def test_changed_inputs_are_rejected(self):
        save(self.candidate,{'issues':[]});self.source.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'INPUT_CHANGED'):receive(self.packet,self.candidate,'host-visual')
    def test_unknown_material_does_not_enter_report(self):
        save(self.candidate,{'issues':[{'id':'issue','materialIds':['absent'],'severity':'major','category':'geometry','observation':'changed','suggestedFix':'review','route':'manual_review'}]})
        with self.assertRaisesRegex(ValueError,'UNKNOWN_MATERIAL'):receive(self.packet,self.candidate,'host-visual')
        self.assertFalse((self.packet/'report.json').exists())
