import _bootstrap
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from PIL import Image
from ai_ui_layers import planning_dag as planning, delivery_dag as delivery, session_review
from ai_ui_layers.evaluate import read, save, digest


class PlanningModelSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.image=self.base/'reference.png'
        Image.new('RGB',(100,100)).save(self.image)

    def test_settings_are_bound_and_nested_must_match(self):
        root=delivery.init(self.image,self.base/'delivery',target='frozen',
            planning_model='gpt-6.1-sol',planning_effort='medium',planning_timeout=1800)
        config=read(root/'.dag/config.json')
        self.assertEqual((config['planningModel'],config['planningEffort'],config['planningTimeoutSeconds']),
                         ('gpt-6.1-sol','medium',1800))
        planning.init(self.image,root/'planning',planning_model='gpt-6.1-sol',
                      planning_effort='medium',planning_timeout=1800)
        delivery.DeliveryDag(root).verify()
        nested=read(root/'planning/.dag/config.json')
        self.assertEqual((nested['model'],nested['effort'],nested['timeoutSeconds']),('gpt-6.1-sol','medium',1800))
        nested['timeoutSeconds']=900
        (root/'planning/.dag/config.json').write_text(json.dumps(nested),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'CONFIG_CHANGED'):planning.Dag(root/'planning').verify()
        (root/'planning/.dag/config-digest.json').write_text(json.dumps({'sha256':digest(root/'planning/.dag/config.json')}),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PLANNING_MODEL_NESTED_RUN_MISMATCH'):delivery.DeliveryDag(root).verify()

    @patch('ai_ui_layers.codex_call.skill_overrides',return_value='skills.config=[]')
    def test_first_and_resume_use_frozen_settings(self, overrides):
        root=planning.init(self.image,self.base/'plan',planning_model='gpt-6.1-sol',
                           planning_effort='medium',planning_timeout=1800)
        for name in ('m1','m2'):
            folder=root/name;folder.mkdir();(folder/'prompt.md').write_text('Fixture prompt',encoding='utf-8')
        with patch.object(planning,'invoke') as invoke,patch.object(planning.shutil,'which',return_value='codex'):
            planning.live_model(root/'m1',None,True)
            planning.live_model(root/'m2','12345678-1234-1234-1234-123456789abc',False)
        self.assertEqual(invoke.call_count,2)
        for call in invoke.call_args_list:
            args=call.args[0]
            self.assertEqual(args[args.index('--model')+1],'gpt-6.1-sol')
            self.assertIn('model_reasoning_effort="medium"',args)
            self.assertEqual(call.kwargs['timeout'],1800)
            self.assertNotIn('--ephemeral',args)
        self.assertIn('resume',invoke.call_args_list[1].args[0])
        self.assertIn('12345678-1234-1234-1234-123456789abc',invoke.call_args_list[1].args[0])

    def test_legacy_missing_timeout_keeps_default(self):
        root=planning.init(self.image,self.base/'legacy')
        config=read(root/'.dag/config.json');config.pop('timeoutSeconds')
        (root/'.dag/config.json').write_text(json.dumps(config),encoding='utf-8')
        (root/'.dag/config-digest.json').write_text(json.dumps({'sha256':digest(root/'.dag/config.json')}),encoding='utf-8')
        planning.Dag(root).verify()
        folder=root/'m1';folder.mkdir();(folder/'prompt.md').write_text('Fixture',encoding='utf-8')
        with patch.object(planning,'command',return_value=['codex','--ephemeral']) as command,patch.object(planning,'invoke') as invoke:
            planning.live_model(folder,None,True)
        self.assertEqual(command.call_args.args[-2:],('gpt-6-luna','xhigh'))
        self.assertEqual(invoke.call_args.kwargs['timeout'],900)

    def test_invalid_settings_rejected_before_output(self):
        for fields in ({'planning_model':''},{'planning_model':'x\n--unsafe'},
                       {'planning_effort':'invalid'},{'planning_timeout':0},
                       {'planning_timeout':True},{'planning_timeout':900.5},{'planning_timeout':86401}):
            with self.subTest(fields=fields):
                target=self.base/'invalid'
                with self.assertRaises(ValueError):planning.init(self.image,target,**fields)
                self.assertFalse(target.exists())
                with self.assertRaises(ValueError):delivery.init(self.image,target,target='frozen',**fields)
                self.assertFalse(target.exists())

    def test_delivery_execute_passes_settings_to_nested_planning(self):
        from test_planning_dag import FakeModel
        Image.new('RGB',(1000,1000)).save(self.image)
        root=delivery.init(self.image,self.base/'execute',target='frozen',
            planning_model='gpt-6.1-sol',planning_effort='medium',planning_timeout=1800)
        result=delivery.DeliveryDag(root,model=FakeModel()).execute()
        self.assertEqual(result['status'],'frozen')
        nested=read(root/'planning/.dag/config.json')
        self.assertEqual((nested['model'],nested['effort'],nested['timeoutSeconds']),('gpt-6.1-sol','medium',1800))
        request=read(root/'planning/request.json')
        self.assertEqual(request['timeoutSeconds'],1800)

    def test_timeout_is_recorded_kills_once_and_never_retries(self):
        folder=self.base/'call';folder.mkdir()
        process=Mock();process.returncode=-1
        process.communicate.side_effect=[subprocess.TimeoutExpired('codex',1800),None]
        with patch.object(session_review.subprocess,'Popen',return_value=process) as popen:
            with self.assertRaises(session_review.TransportFailure):
                session_review.invoke(['codex'],folder,self.base,'Fixture',timeout=1800)
        self.assertEqual(popen.call_count,1)
        self.assertEqual(process.communicate.call_args_list[0].kwargs['timeout'],1800)
        process.kill.assert_called_once()
        receipt=read(folder/'transport.json')
        self.assertEqual(receipt['timeoutSeconds'],1800)
        self.assertEqual(receipt['failure'],'TIMEOUT_NO_RETRY')
        for timeout in (0,True,1.5,86401):
            with self.assertRaises(ValueError):session_review.invoke([],self.base/'absent',self.base,'',timeout=timeout)

    def test_public_cli_accepts_new_run_settings_and_rejects_resume_override(self):
        args=['ui_layer.py','run','--image',str(self.image),'--output',str(self.base/'cli'),
              '--target','frozen','--planning-model','gpt-6.1-sol','--planning-effort','medium',
              '--planning-timeout','1800']
        with patch.object(sys,'argv',args),patch.object(delivery,'init') as init,patch.object(delivery,'DeliveryDag') as dag:
            dag.return_value.execute.return_value={'status':'frozen'}
            delivery.main()
        self.assertEqual(init.call_args.kwargs,
            dict(planning_model='gpt-6.1-sol',planning_effort='medium',planning_timeout=1800))
        for flag,value in (('--planning-model','gpt-6.1-sol'),('--planning-effort','medium'),('--planning-timeout','1800')):
            with self.subTest(flag=flag),patch.object(sys,'argv',['ui_layer.py','resume','--output','absent',flag,value]):
                with self.assertRaises(SystemExit) as raised:delivery.main()
                self.assertEqual(raised.exception.code,2)


if __name__=='__main__':unittest.main()
