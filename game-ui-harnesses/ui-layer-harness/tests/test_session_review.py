import _bootstrap  # Enable source-layout imports for unittest discovery.
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from ai_ui_layers.session_review import session_id, resume_command, build_review_prompt, render_for_review
from PIL import Image
from ai_ui_layers.evaluate import check_relations


class SessionReviewTests(unittest.TestCase):
    def test_outside_object_reaches_review_but_bad_box_does_not(self):
        plan={'kind':'ui_visual_plan_v5','materials':[
            {'id':'bg','label':'bg','role':'background','zOrder':0,'bboxNorm':[0,0,1,1]},
            {'id':'card','label':'card','role':'foreground','zOrder':1,'bboxNorm':[.2,.2,.8,.8]}],
            'objects':[{'id':'scene','label':'scene','kind':'background','materialId':'bg','bboxNorm':None},
                       {'id':'icon','label':'icon','kind':'icon','materialId':'card','bboxNorm':[.19,.2,.4,.4]}],
            'unknowns':[]}
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);reference=root/'reference.png';Image.new('RGB',(100,100)).save(reference)
            self.assertEqual(check_relations(plan)[0]['code'],'OBJECT_OUTSIDE_MATERIAL')
            render_for_review(reference,plan,root/'preview')
            self.assertTrue((root/'preview/materials-overlay.png').exists())
            plan['objects'][1]['bboxNorm']=[.4,.2,.1,.4]
            with self.assertRaisesRegex(ValueError,'M1_NOT_RENDERABLE'):
                render_for_review(reference,plan,root/'bad')

    def test_review_uses_shared_checks_but_excludes_repair_stage(self):
        source = 'intro\n## 第一步：检查\nShared checks\n## 第二步：修补\nRepair instruction'
        prompt = build_review_prompt(source, [{'code': 'EXAMPLE'}])
        self.assertIn('Shared checks', prompt)
        self.assertIn('EXAMPLE', prompt)
        self.assertNotIn('Repair instruction', prompt)
        with self.assertRaises(IndexError):
            build_review_prompt('Missing review section', [])

    def test_session_must_be_explicit_and_unambiguous(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'events'
            sid='12345678-1234-1234-1234-123456789abc'
            p.write_text(json.dumps({'type':'thread.started','thread_id':sid}),encoding='utf-8')
            self.assertEqual(session_id(p),sid)
            p.write_text('',encoding='utf-8')
            with self.assertRaises(ValueError):session_id(p)
            p.write_text('\n'.join(json.dumps({'type':'thread.started','thread_id':s}) for s in
                                   [sid,'12345678-1234-1234-1234-123456789abd']),encoding='utf-8')
            with self.assertRaises(ValueError):session_id(p)

    @patch('ai_ui_layers.codex_call.skill_overrides',return_value='skills.config=[]')
    def test_resume_retains_isolation_and_only_adds_overlay(self,_):
        p=Path('folder with spaces');sid='12345678-1234-1234-1234-123456789abc'
        args=resume_command('codex',p,p,sid)
        self.assertEqual(args[-2:],[sid,'-'])
        for flag in ['--ephemeral','--last','--dangerously-bypass-approvals-and-sandbox']:
            self.assertNotIn(flag,args)
        for flag in ['--ignore-user-config','sandbox_mode="read-only"','project_doc_max_bytes=0','features.shell_tool=false']:
            self.assertIn(flag,args)
        self.assertEqual(args.count('--image'),1)
        self.assertEqual(args[args.index('--image')+1],str(p/'review-overlay.png'))


if __name__=='__main__':unittest.main()
