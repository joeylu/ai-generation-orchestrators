import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { headingSpec, headingCases, flatten } from '../../examples/section-headings-v1/fixture.mjs';
import { readStoredZip } from '../../tests/unity-kit-helpers.mjs';
import { digestBytes } from '../../src/canonical.mjs';

/** Run exclusively against the supplied installed SDK, with no model or user tasks. */
export async function checkInstalledHeadings(sdk, output) {
  const checks = [], cases = [], pass = name => checks.push({name,status:'PASS'});
  const legacy = JSON.parse(await readFile(new URL('../../tests/fixtures/section-headings/rc1-single.bundle.json', import.meta.url), 'utf8'));
  assert.deepEqual(await sdk.panel.validatePanelBundle(legacy, sdk.core), legacy);
  pass('actual-rc1-bundle-recompiles-with-identical-complete-envelope-and-sha256');
  for (const fixture of [{id:'legacy-rc1',headings:['音量'],legacy:true}, ...headingCases]) {
    const bundle = fixture.legacy ? legacy : await sdk.panel.createPanelBundle(headingSpec(sdk.panel,sdk.seed.catalog,fixture),sdk.seed.catalog,sdk.core);
    const nodes = flatten(bundle.componentBundle.document.root);
    const headings = nodes.filter(node => /\.section\.[^.]+\.title$/.test(node.id)).map(node => node.props.text);
    assert.deepEqual(headings, fixture.headings); assert.equal(bundle.state.row0,57);
    const native = await sdk.panel.createUnityDocument(bundle,sdk.core);
    assert.deepEqual(native.nodes.filter(node => /\.section\.[^.]+\.title$/.test(node.id)).map(node=>node.text),headings);
    const kit = await sdk.delivery.createUnityKitFiles(bundle,sdk.core,sdk.delivery.sources);
    const delivered = await sdk.delivery.createPanelDelivery(bundle,sdk.core,{runtime:sdk.delivery.runtime,unityKit:kit});
    const zip = sdk.delivery.createStoredZip(delivered.contents), files=readStoredZip(zip);
    for (const file of delivered.manifest.files) assert.equal(await digestBytes(files.get(file.path)),file.sha256);
    const directory=resolve(output,'headings',fixture.id);await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,'panel-delivery.zip'),zip,{flag:'wx'});
    for(const[name,bytes]of files)if(name.startsWith('pixi/')){const path=resolve(directory,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});}
    assert.deepEqual(await sdk.panel.validatePanelBundle(JSON.parse(Buffer.from(files.get('pixi/panel.bundle.json'))),sdk.core),bundle);
    cases.push({id:fixture.id,compilerVersion:bundle.compilerVersion,headings,state:bundle.state,panelSha256:bundle.sha256,
      sectionHeight:nodes.find(node=>node.id==='heading-fixture.section.section0').layout.height,
      rowY:nodes.find(node=>node.id==='heading-fixture.row.row0').layout.y});
    pass('installed-heading-delivery-'+fixture.id);
  }
  const model=await sdk.createWorkbenchModel(sdk.seed,sdk.core);await model.importPanel(legacy);
  const upgraded=await model.adoptSectionHeadings('auto',{row0:57});assert.equal(upgraded.panel.compilerVersion,'0.28.0');
  assert.deepEqual(upgraded.panel.spec.sections,legacy.spec.sections);assert.deepEqual(upgraded.panel.state,legacy.state);
  assert.equal(model.getEditBudget().used,1);await model.undo();assert.deepEqual(model.getSnapshot().panel,legacy);
  await model.importPanel(legacy);assert.equal(model.getEditBudget().used,1);model.dispose();
  pass('installed-explicit-adoption-preserves-state-history-and-monotonic-edit-budget');
  const hidden=cases.find(value=>value.id==='single'),shown=cases.find(value=>value.id==='explicit-show');
  assert.equal(hidden.rowY,0);assert.equal(shown.rowY-hidden.rowY,44);assert.equal(shown.sectionHeight-hidden.sectionHeight,44);
  const report={status:'PASS',cases,checks,realModelCalls:0,unityNative:'NOT_RUN'};
  await writeFile(resolve(output,'heading-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return checks;
}
