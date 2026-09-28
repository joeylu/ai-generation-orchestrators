import _bootstrap
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
try:
    import tomllib
except ImportError:  # Python 3.10 has no standard-library TOML parser.
    tomllib=None

from ai_ui_layers import frozen_image_arguments as relay
from ai_ui_layers.generate_session import relay_config


# Synthetic prompt only: punctuation, interpolation-like text and long Unicode.
PROMPT=('图标 "引号" `刻度` ${保留} \\路径\n'*240)+'[{"tip":"浅色"}]'


def request():
    return dict(submissionDigest='synthetic-submission',arguments=dict(
        prompt=PROMPT,referenced_image_paths=['synthetic-reference.png','synthetic-crop.png']))


def ready_server(folder, transparency=True):
    sha=relay.prepare(folder,request(),transparency)
    server=relay.ArgumentServer(folder/'frozen-image-arguments.json',sha)
    server.handle(dict(method='initialize',params={'protocolVersion':'2025-06-18'}))
    server.handle(dict(method='notifications/initialized'))
    return server,sha


class FrozenArgumentsTests(unittest.TestCase):
    def test_relay_recognizer_keeps_only_known_data_flow_with_whitespace_changes(self):
        self.assertTrue(relay.is_relay_code(relay.RELAY_CODE.replace('const frozen =','const\t frozen  =').replace(';',';\n')))
        for code in (relay.RELAY_CODE.replace('const frozen','constfrozen'),
                     relay.RELAY_CODE.replace('||','| |'),
                     relay.RELAY_CODE+'\ntools.image_gen__imagegen({});',
                     relay.RELAY_CODE.replace('frozen.structuredContent);','{...frozen.structuredContent});'),
                     relay.RELAY_CODE.replace('const result','// ignored\nconst result'),
                     relay.RELAY_CODE.replace('120000','1000')):
            with self.subTest(code=code):self.assertFalse(relay.is_relay_code(code))

    def test_stdio_process_preserves_exact_prompt_once_without_media(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);sha=relay.prepare(folder,request(),True)
            messages=[dict(jsonrpc='2.0',id=1,method='initialize',params={'protocolVersion':'2025-06-18'}),
                dict(jsonrpc='2.0',method='notifications/initialized'),
                dict(jsonrpc='2.0',id=2,method='tools/list'),
                dict(jsonrpc='2.0',id=3,method='tools/call',params={'name':relay.TOOL,'arguments':{}}),
                dict(jsonrpc='2.0',id=4,method='tools/call',params={'name':relay.TOOL,'arguments':{}})]
            process=subprocess.run([sys.executable,'-I',relay.__file__,'--payload',
                str(folder/'frozen-image-arguments.json'),'--sha256',sha],
                input=b'\n'.join(relay.encoded(m) for m in messages)+b'\n',capture_output=True,timeout=10)
            self.assertEqual(process.returncode,0,process.stderr)
            replies=[json.loads(line) for line in process.stdout.splitlines()]
            self.assertEqual([r['id'] for r in replies],[1,2,3,4])
            self.assertEqual(replies[1]['result']['tools'][0]['name'],relay.TOOL)
            args=replies[2]['result']['structuredContent']
            self.assertEqual(args,relay.tool_arguments(request(),True))
            self.assertEqual(args['prompt'].encode('utf-8'),PROMPT.encode('utf-8'))
            self.assertEqual(json.loads(replies[2]['result']['content'][0]['text']),args)
            self.assertTrue(replies[3]['result']['isError'])
            self.assertNotIn('structuredContent',replies[3]['result'])
            self.assertEqual({p.name for p in folder.iterdir()},
                             {'frozen-image-arguments.json','frozen-arguments-read.json'})
            restarted=relay.ArgumentServer(folder/'frozen-image-arguments.json',sha)
            restarted.initialized=True
            self.assertTrue(restarted.handle(messages[-1])['isError'])

    def test_changed_payload_cannot_be_read_after_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);server,_=ready_server(folder)
            path=folder/'frozen-image-arguments.json'
            payload=json.loads(path.read_text(encoding='utf-8'))
            payload['arguments']['prompt']=PROMPT[:-1]
            path.write_bytes(relay.encoded(payload))
            result=server.handle(dict(method='tools/call',params={'name':relay.TOOL,'arguments':{}}))
            self.assertTrue(result['isError'])
            self.assertNotIn('structuredContent',result)
            self.assertFalse((folder/'frozen-arguments-read.json').exists())

    def test_tool_cannot_select_another_file_or_add_arguments(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);server,_=ready_server(folder)
            for params in ({'name':'read_file','arguments':{}},
                           {'name':relay.TOOL,'arguments':{'path':'other.png'}},
                           {'name':relay.TOOL,'arguments':{'prompt':'override'}}):
                with self.subTest(params=params),self.assertRaisesRegex(ValueError,'MCP_REQUEST_NOT_ALLOWED'):
                    server.handle(dict(method='tools/call',params=params))
            self.assertFalse((folder/'frozen-arguments-read.json').exists())

    def test_protocol_notices_never_emit_responses_or_issue_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);server,_=ready_server(folder)
            target=io.BytesIO()
            relay.serve(server,[relay.encoded(dict(jsonrpc='2.0',method='notifications/cancelled'))+b'\n'],target)
            self.assertEqual(target.getvalue(),b'')
            self.assertFalse((folder/'frozen-arguments-read.json').exists())

    @unittest.skipUnless(tomllib,'TOML parser check needs Python 3.11+; relay process supports 3.10')
    def test_invocation_config_is_valid_toml_with_literal_paths(self):
        with tempfile.TemporaryDirectory(prefix='relay 空格 ') as tmp:
            folder=Path(tmp)
            value=tomllib.loads(relay_config(folder,'a'*64))['mcp_servers']['ui_layer_frozen']
            self.assertEqual(value['command'],sys.executable)
            self.assertEqual(value['args'][-3:],[str(folder/'frozen-image-arguments.json'),'--sha256','a'*64])
            self.assertEqual(value['enabled_tools'],[relay.TOOL])
            self.assertTrue(value['required'])

    @unittest.skipUnless(shutil.which('node'),'Node unavailable; stdio byte-preservation test still runs')
    def test_fixed_javascript_forwards_returned_object_and_stops_on_read_error(self):
        # Execute the actual fixed relay against in-memory tools. No CLI/model/service.
        runner='''const vm=require('node:vm');
let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',s=>input+=s);
process.stdin.on('end',async()=>{
  const data=JSON.parse(input); let reads=0, images=0, shown=0, same=false, received=null;
  const tools={mcp__ui_layer_frozen__read_arguments:async()=>{reads++;return data.reply;},
    image_gen__imagegen:async(args)=>{images++;same=args===data.reply.structuredContent;received=args;return {};}};
  let error=null;
  try {await vm.runInNewContext('(async()=>{'+data.code+'\\n})()',
    {tools,generatedImage:()=>shown++});} catch(e) {error=e.message;}
  process.stdout.write(JSON.stringify({reads,images,shown,same,received,error}));
});'''
        for transparency in (True,False):
            with self.subTest(transparency=transparency),tempfile.TemporaryDirectory() as tmp:
                server,_=ready_server(Path(tmp),transparency)
                reply=server.handle(dict(method='tools/call',params={'name':relay.TOOL,'arguments':{}}))
                for data,expected_calls in ((reply,1),({'isError':True},0),({},0)):
                    process=subprocess.run([shutil.which('node'),'-e',runner],
                        input=relay.encoded(dict(reply=data,code=relay.RELAY_CODE)),capture_output=True,timeout=10)
                    self.assertEqual(process.returncode,0,process.stderr)
                    result=json.loads(process.stdout)
                    self.assertEqual(result['reads'],1)
                    self.assertEqual(result['images'],expected_calls)
                    if expected_calls:
                        self.assertTrue(result['same'])
                        self.assertEqual(result['received'],relay.tool_arguments(request(),transparency))
                        self.assertEqual(result['shown'],1)
                    else:
                        self.assertEqual(result['error'],'FROZEN_ARGUMENTS_UNAVAILABLE')


if __name__=='__main__':unittest.main()
