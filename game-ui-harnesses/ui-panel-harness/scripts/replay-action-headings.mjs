/** Reviewed saved specimens, versioned heading-policy adoption only; zero inference. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {readJson,writeNewJson,createOutputDirectory} from '../src/io.mjs';
import {validatePanelBundle,createPanelBundle} from '../src/panel-bundle.mjs';
import {headingThemeTarget} from '../src/section-headings.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===2&&args[0]==='--output');
const catalog=await readJson('examples/modern-action-headings.catalog.json'),core=await loadWorkspaceCore();
const {fixtures}=await readJson('tests/fixtures/action-heading-real-v1.json');
const output=await createOutputDirectory(args[1]),runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),results=[];
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
const headings=b=>flatten(b.componentBundle.document.root).filter(n=>/\.section\.[^.]+\.title$/.test(n.id)).map(n=>n.props.text);
for(const fixture of fixtures){
  const recent=fixture.id.startsWith('new_'),id=fixture.id.replace(/^new_/,''),run=recent?'heading-short-input-real-v1':'short-input-real-v1';
  const bytes=await readFile(resolve('output',run,id,'panel.bundle.json'));assert.equal(await digestBytes(bytes),fixture.sourceFileSha256);
  const before=await validatePanelBundle(JSON.parse(bytes),core);assert.deepEqual(before.spec,fixture.spec);
  for(const mode of ['auto','show']){
    const spec=structuredClone(before.spec);spec.theme=headingThemeTarget(spec,before.catalog,catalog,mode);
    const bundle=await createPanelBundle(spec,catalog,core,before.state);await validatePanelBundle(bundle,core);
    assert.deepEqual({...bundle.spec,theme:before.spec.theme},before.spec);assert.deepEqual(bundle.state,before.state);assert.deepEqual(bundle.actions,before.actions);assert.deepEqual(bundle.bindings,before.bindings);
    const expected=mode==='show'?spec.sections.map(s=>s.title):spec.sections.length===1?[]:spec.sections.filter(s=>!s.rows.every(r=>r.kind==='button')).map(s=>s.title);
    assert.deepEqual(headings(bundle),expected);assert.equal(bundle.compilerVersion,'0.33.0');
    const caseId=fixture.id+'_'+mode,directory=await createOutputDirectory(join(output,caseId));
    const kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit}),zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
    for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
    await writeNewJson(directory,'panel.bundle.json',bundle);await writeFile(join(directory,'panel.zip'),zip,{flag:'wx'});
    for(const [name,value]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(p=>p&&!['.','..'].includes(p)));const path=join(directory,'delivery',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,value,{flag:'wx'});}
    const evidence={kind:'DETERMINISTIC_HEADING_POLICY_ADOPTION',mode,sourceId:id,sourceRun:run,sourceFileSha256:fixture.sourceFileSha256,
      originalHeadings:headings(before),visibleHeadings:headings(bundle),specExceptThemeUnchanged:true,stateActionsBindingsUnchanged:true,realModelCalls:0};
    await writeNewJson(directory,'replay-evidence.json',evidence);
    results.push({id:caseId,status:'PASS',outcome:'DETERMINISTIC_HEADING_REPLAY',...evidence,delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)}});
  }
}
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_HEADING_REPLAY',status:'PASS_BEFORE_BROWSER',cohort:'action-heading-v3',planSha256:await digestJson({fixtures,catalog}),realModelCalls:0,originalRealModelCalls:41,automaticRetries:0,results});
console.log(JSON.stringify({panels:results.length,sourcePanels:fixtures.length,realModelCalls:0}));
