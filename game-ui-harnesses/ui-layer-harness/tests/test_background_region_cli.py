import _bootstrap
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from PIL import Image,ImageDraw
from ai_ui_layers.evaluate import digest


class BackgroundRegionCliTests(unittest.TestCase):
    def test_public_offline_roundtrip_and_tamper_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);entry=Path(__file__).resolve().parents[1]/'ui_layer.py'
            source=root/'source.png';proposal=root/'proposal.png'
            edit=root/'edit.png';blend=root/'blend.png'
            Image.new('RGB',(9,7),(11,31,57)).save(source)
            Image.new('RGB',(9,7),(90,110,130)).save(proposal)
            mask=Image.new('L',(9,7),0);ImageDraw.Draw(mask).rectangle((2,2,6,4),fill=255);mask.save(edit)
            weights=mask.copy();weights.putpixel((2,2),128);weights.save(blend)
            def cli(*args):
                proc=subprocess.run([sys.executable,'-B',str(entry),*map(str,args)],capture_output=True,text=True,encoding='utf-8')
                return proc,json.loads(proc.stdout)
            proc,frozen=cli('freeze-background-region','--source',source,'--source-sha256',digest(source),
                '--edit-mask',edit,'--edit-mask-sha256',digest(edit),'--blend-mask',blend,'--blend-mask-sha256',digest(blend),
                '--background-mode','scene-only','--text-policy','remove-business-text','--reason','Synthetic explicit region',
                '--output',root/'region')
            self.assertEqual(proc.returncode,0,proc.stdout+proc.stderr)
            proc,inspected=cli('inspect-background-region','--output',root/'region','--region-digest',frozen['digest'])
            self.assertEqual(proc.returncode,0,proc.stdout+proc.stderr)
            self.assertEqual(inspected['digest'],frozen['digest'])
            proc,result=cli('apply-background-region','--region-plan',root/'region','--region-digest',frozen['digest'],
                '--source',proposal,'--source-sha256',digest(proposal),'--output',root/'applied')
            self.assertEqual(proc.returncode,0,proc.stdout+proc.stderr)
            self.assertEqual(result['status'],'candidate_pending_visual_review')
            self.assertFalse(result['humanVisualAcceptance'])
            self.assertFalse(result['originalDagPromoted'])
            with Image.open(root/'applied/candidate.png') as candidate:
                self.assertEqual(candidate.size,(9,7))
                self.assertEqual(candidate.convert('RGB').getpixel((0,0)),(11,31,57))
                self.assertEqual(candidate.convert('RGB').getpixel((4,3)),(90,110,130))
            frozen_source=root/'region/source.png'
            frozen_source.write_bytes(proposal.read_bytes())
            proc,rejected=cli('apply-background-region','--region-plan',root/'region','--region-digest',frozen['digest'],
                '--source',proposal,'--source-sha256',digest(proposal),'--output',root/'must-not-exist')
            self.assertEqual(proc.returncode,1)
            self.assertEqual(rejected['status'],'stopped')
            self.assertFalse((root/'must-not-exist').exists())


if __name__=='__main__':unittest.main()
