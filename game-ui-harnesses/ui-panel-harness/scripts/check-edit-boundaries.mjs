import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import assert from 'node:assert/strict';
import {createOutputDirectory,writeNewJson,harnessRoot} from '../src/io.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {createEditBoundaryFixtures,runEditBoundaryCase,probePartialOmission,EDIT_BOUNDARY_CASES,EDIT_BOUNDARY_GAPS} from './edit-boundaries-contract.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output')throw new Error('USAGE: node scripts/check-edit-boundaries.mjs --output <fresh-directory>');
const out=await createOutputDirectory(args[1]);
const core=await loadWorkspaceCore(),fixtures=await createEditBoundaryFixtures(core),runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources();
const sourceFiles={};
async function fingerprint(path){
  const entries=await readdir(join(harnessRoot,path),{withFileTypes:true});
  for(const entry of entries){const name=path+'/'+entry.name;if(entry.isDirectory())await fingerprint(name);else if(entry.isFile())sourceFiles[name]=await digestBytes(await readFile(join(harnessRoot,name)));}
}
for(const folder of ['src','schemas','prompts','adapters/unity','examples/edit-boundaries-v1','../ui-component-harness/src'])await fingerprint(folder);
for(const file of ['scripts/check-edit-boundaries.mjs','scripts/edit-boundaries-contract.mjs','scripts/build-delivery-runtime.mjs','examples/modern-adaptive.catalog.json','examples/adaptive-v1/fixture.mjs'])sourceFiles[file]=await digestBytes(await readFile(join(harnessRoot,file)));
await writeNewJson(out,'source-binding.json',{sourceFiles,sha256:await digestJson(sourceFiles)});
const results=[];
for(const item of EDIT_BOUNDARY_CASES){
  try{
    const checked=await runEditBoundaryCase(item,fixtures,core),dir=await createOutputDirectory(join(out,item.id));
    await writeNewJson(dir,'context.json',checked.context);await writeNewJson(dir,'authored-draft.json',checked.draft);
    if(checked.after){
      await writeNewJson(dir,'before.bundle.json',checked.before);await writeNewJson(dir,'after.bundle.json',checked.after);await writeNewJson(dir,'unity-document.json',checked.unity);
      const unityKit=await createUnityKitFiles(checked.after,core,sources),delivery=await createPanelDelivery(checked.after,core,{runtime,unityKit}),zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
      assert.equal(files.size,delivery.manifest.files.length+1);
      for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
      for(const path of ['pixi/panel.bundle.json','unity/panel.bundle.json'])assert.deepEqual(await validatePanelBundle(JSON.parse(new TextDecoder().decode(files.get(path))),core),checked.after);
      await writeFile(join(dir,'panel-delivery.zip'),zip,{flag:'wx'});
      checked.result.delivery={status:'CRC_SHA_AND_REIMPORT_PASS',fileCount:files.size,sha256:await digestBytes(zip),nativeUnity:'NOT_RUN',offlineBrowser:'NOT_RUN'};
    }
    await writeNewJson(dir,'result.json',checked.result);results.push(checked.result);
  }catch(error){results.push({id:item.id,input:item.text,status:'FIXTURE_FAILED',failureCode:error.code??error.name});}
}
const probe=await probePartialOmission(fixtures);
const report={editBoundaryReportVersion:'0.1',status:results.every(r=>r.status!=='FIXTURE_FAILED')?'FIXTURE_CHECKS_PASS_WITH_KNOWN_GAPS':'FAIL',modelCalls:0,automaticRetries:0,
  sourceBindingSha256:await digestJson(sourceFiles),suiteSha256:await digestJson({cases:EDIT_BOUNDARY_CASES,gaps:EDIT_BOUNDARY_GAPS}),
  summary:{executedFixtureCases:results.length,appliedPlansVerified:results.filter(r=>r.status==='AUTHORED_PLAN_VERIFIED').length,invalidBatchesRejected:results.filter(r=>r.status==='REJECTED_ATOMICALLY').length,noChange:results.filter(r=>r.status==='NO_CHANGES').length,clarification:results.filter(r=>r.status==='NEEDS_INPUT').length,failed:results.filter(r=>r.status==='FIXTURE_FAILED').length,knownGaps:EDIT_BOUNDARY_GAPS.length},results,
  gaps:EDIT_BOUNDARY_GAPS.map(item=>({...item,status:'KNOWN_GAP',modelInterpretation:'NOT_RUN'})),semanticOmissionProbe:probe,
  limitations:['Natural-language model interpretation was not exercised; authored plans are fixtures.','Known gaps are recorded separately and do not count as successful requests.','Browser rendering and native Unity import are not validated by this command.','Structural acceptance does not prove complete natural-language request coverage.']};
await writeNewJson(out,'report.json',report);
const rows=results.map(r=>`| ${r.id} | ${r.input} | ${r.status} |`).join('\n');
const gaps=report.gaps.map(r=>`| ${r.id} | ${r.input} | ${r.missing} |`).join('\n');
await writeFile(join(out,'README.md'),`# 用户修改边界夹具审计\n\n${report.status}。模型调用0；自然语言解释均未实测。\n\n## 已执行的确定性夹具\n\n| ID | 输入 | 程序结果 |\n| --- | --- | --- |\n${rows}\n\n## 尚未支持，不能算通过\n\n| ID | 输入 | 缺口 |\n| --- | --- | --- |\n${gaps}\n\n## 已观察到的语义边界\n\n故意遗漏条件启用要求的局部方案能通过结构校验，未应用。结构验收不能代替自然语言需求完整性验收。详见 report.json。\n`,{flag:'wx'});
console.log(JSON.stringify({status:report.status,summary:report.summary,modelCalls:0,output:relative(harnessRoot,out).replaceAll('\\','/')}));
if(report.status==='FAIL')process.exitCode=1;
