/** Versioned heading treatment of saved successful native plans; no inference or content edits. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {headingThemeTarget,sectionHeadingVisible} from '../src/section-headings.mjs';
import {resolveTheme} from '../src/catalog.mjs';
import {fitDraftPanelLayout} from '../src/draft-layout.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--run'&&args[2]==='--output');
const source=resolve(args[1]),sourceBytes=await readFile(join(source,'input-adaptability-report.json')),original=JSON.parse(sourceBytes);
assert.equal(original.planSha256,'2d00b6eeac00a058b27896d26189ea72682317e5300eb9728b11e24c78ff6e61');
assert.equal(original.treatment,'CURRENT_GENERATION_DEFAULTS_FROM_SAVED_NATIVE_INTENTS');assert.equal(original.realModelCalls,0);
assert.equal(original.results.filter(x=>x.delivery).length,41);assert.equal(original.results.filter(x=>x.status==='FAIL').length,23);
const catalog=await readJson('examples/modern-tab-headings.catalog.json'),core=await loadWorkspaceCore();
const output=await createOutputDirectory(args[3]),runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),results=[];
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
const headings=b=>flatten(b.componentBundle.document.root).filter(n=>/\.section\.[^.]+\.title$/.test(n.id)).map(n=>n.props.text);
const scrub=spec=>{const value=structuredClone(spec);delete value.theme;delete value.canvas;delete value.layout.width;delete value.layout.maxHeight;return value;};
for(const item of original.results){
  if(!item.delivery){const {receipt,...rest}=item;results.push({...rest,originalStatus:item.originalStatus??item.status});continue;}
  const bytes=await readFile(join(source,item.id,'panel.bundle.json')),before=await validatePanelBundle(JSON.parse(bytes),core),assets=panelBundleAssetInputs(before,core);
  for(const mode of ['auto','show']){
    const adopted=structuredClone(before.spec);adopted.theme=headingThemeTarget(adopted,before.catalog,catalog,mode);
    // The exact source cohort has no requested geometry; both modes may grow only
    // suggested dimensions. Content, layout order, styles and resource bytes remain.
    const fitted=fitDraftPanelLayout(adopted,catalog,core,{policy:'draft-content-fit-v2',assetClosure:assets?.closure,mutableDimensions:['width','maxHeight','canvasWidth','canvasHeight']});
    assert.equal(fitted.evidence.status,'CONTENT_VISIBLE');assert.deepEqual(scrub(fitted.spec),scrub(before.spec));
    const bundle=await createPanelBundle(fitted.spec,catalog,core,before.state,assets);await validatePanelBundle(bundle,core);assert.equal(bundle.compilerVersion,'0.34.0');
    for(const key of ['state','actions','bindings','assetClosure'])assert.deepEqual(bundle[key],before[key]);
    const policy=resolveTheme(catalog,bundle.spec.theme).headingStyle,expected=bundle.spec.sections.filter(section=>sectionHeadingVisible(bundle.spec,section,policy)).map(section=>section.title);
    assert.deepEqual(headings(bundle),expected);
    const id=item.id+'_'+mode,directory=await createOutputDirectory(join(output,id)),kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
    const zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
    for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
    await writeNewJson(directory,'panel.bundle.json',bundle);await writeFile(join(directory,'panel.zip'),zip,{flag:'wx'});
    for(const [name,value]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(p=>p&&!['.','..'].includes(p)));const path=join(directory,'delivery',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,value,{flag:'wx'});}
    const evidence={kind:'DETERMINISTIC_TAB_HEADING_ADOPTION',mode,sourceId:item.id,originalFileSha256:await digestBytes(bytes),originalBundleSha256:before.sha256,
      originalHeadings:headings(before),visibleHeadings:headings(bundle),dimensionChanges:fitted.evidence.changes,businessStateActionsAndAssetsPreserved:true,realModelCalls:0};
    await writeNewJson(directory,'replay-evidence.json',evidence);
    results.push({id,status:'PASS',outcome:'DETERMINISTIC_TAB_HEADING_REPLAY',originalStatus:item.originalStatus,mode,sourceId:item.id,...evidence,
      delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)}});
  }
}
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',treatment:'TAB_HEADING_V4_AUTO_AND_EXPLICIT_SHOW',cohort:'common-panels-fix-v1',status:'PARTIAL_REPLAY_ORIGINAL_FAILURES_PRESERVED',
  planSha256:await digestJson({sourceReportSha256:await digestBytes(sourceBytes),catalog,modes:['auto','show']}),sourcePlanSha256:original.planSha256,realModelCalls:0,originalRealModelCalls:original.originalRealModelCalls,automaticRetries:0,results});
console.log(JSON.stringify({sourcePanels:41,replayed:results.filter(x=>x.delivery).length,preservedFailures:results.filter(x=>x.status==='FAIL').length,realModelCalls:0}));
