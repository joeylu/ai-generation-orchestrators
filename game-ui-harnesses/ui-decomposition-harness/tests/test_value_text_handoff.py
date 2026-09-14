import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

from ai_ui_decomposition.common import ContractError, read_json, sha256
from ai_ui_decomposition.value_text_handoff import attach

ROOT = Path(__file__).resolve().parents[2]/'ui-component-harness'


@unittest.skipUnless(shutil.which('node') and (ROOT/'node_modules').exists(), 'local consumer Node dependencies required')
class ValueTextHandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)
        script=self.base/'fixture.mjs'
        fixture=(ROOT/'tests/helpers/value-text-handoff-fixture.ts').as_uri()
        script.write_text('import {writeFile} from "node:fs/promises";\n'
            f'import {{valueTextHandoffFixture}} from {json.dumps(fixture)};\n'
            'const f=await valueTextHandoffFixture();'
            'await writeFile(process.argv[2],f.zip);await writeFile(process.argv[3],JSON.stringify(f.bindings));',encoding='utf8')
        self.source=self.base/'source.zip';self.bindings=self.base/'bindings.json'
        result=subprocess.run(['node',str(script),str(self.source),str(self.bindings)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_official_roundtrip_preserves_reference_and_legacy_source(self):
        original=sha256(self.source)
        result=attach(self.source,self.bindings,ROOT,self.base/'out')
        self.assertEqual(sha256(self.source),original)
        self.assertEqual(result['generation_calls'],0)
        self.assertFalse(result['human_visual_acceptance'])
        with zipfile.ZipFile(self.source) as old, zipfile.ZipFile(self.base/'out'/result['file']) as new:
            for name in ('reference/original.png','reference/reference-state.json','acceptance-scope.json','decomposition/fixture.draft.zip'):
                self.assertEqual(old.read(name),new.read(name))
        self.assertEqual(read_json(self.base/'out/consumed.json')['document']['valueTextBindings'],read_json(self.bindings))
        with self.assertRaisesRegex(ContractError,'VALUE_TEXT_OUTPUT_EXISTS'):
            attach(self.source,self.bindings,ROOT,self.base/'out')

    def test_invalid_reference_rejected_without_published_package(self):
        bindings=read_json(self.bindings);bindings['bindings'][0]['sourceId']='missing'
        invalid=self.base/'invalid.json';invalid.write_text(json.dumps(bindings),encoding='utf8')
        with self.assertRaisesRegex(ContractError,'VALUE_TEXT_OFFICIAL_CLI_REJECTED'):
            attach(self.source,invalid,ROOT,self.base/'out')
        self.assertFalse((self.base/'out/ui.component-handoff.draft.zip').exists())
        self.assertNotEqual(read_json(self.base/'out/attach-cli.json')['exit_code'],0)
