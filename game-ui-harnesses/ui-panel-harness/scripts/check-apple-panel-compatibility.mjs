#!/usr/bin/env node
/** Strict replay of saved local comparisons. No planning, generation or writes to sources. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {harnessRoot,writeNewJson,createOutputDirectory} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
const args=process.argv.slice(2);assert(args.length===2&&args[0]==='--output');
const output=await createOutputDirectory(args[1]),core=await loadWorkspaceCore(),checks=[],report={status:'FAIL',modelCalls:0,checks};
try{
  for(const directory of ['skill-art-real-v2','apple-grouped-audio-review-v3','apple-line-icons-review-v1','slider-clarity-review-v2','audio-flow-review-v1']){
    const root=resolve(harnessRoot,'output',directory,'review'),names=(await readdir(root)).filter(name=>name.endsWith('.panel.bundle.json')).sort();assert(names.length>=4);
    for(const name of names){const bytes=await readFile(resolve(root,name)),bundle=JSON.parse(bytes);assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
      checks.push({path:`output/${directory}/review/${name}`,fileSha256:await digestBytes(bytes),bundleSha256:bundle.sha256,compilerVersion:bundle.compilerVersion});}
  }
  assert.equal(checks.length,24);report.status='PASS';
}catch(error){report.failure={code:error.code??error.name,message:error.message};}
await writeNewJson(output,'legacy-replay-report.json',report);
process.stdout.write(JSON.stringify({status:report.status,bundles:checks.length,modelCalls:0})+'\n');if(report.status!=='PASS')process.exitCode=1;
