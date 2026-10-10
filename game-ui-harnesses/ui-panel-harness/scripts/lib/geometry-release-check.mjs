import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {singleControlSpec,geometryCases,flatten} from '../../examples/section-geometry-v2/fixture.mjs';
import {readStoredZip} from '../../tests/unity-kit-helpers.mjs';
import {digestBytes} from '../../src/canonical.mjs';

/** Compile/export through the installed SDK; workspace helpers verify fixture bytes. */
export async function checkInstalledGeometry(sdk,output) {
  const checks=[],cases=[],pass=name=>checks.push({name,status:'PASS'});
  for(const fixture of [...geometryCases.map(kind=>({id:kind,kind})),{id:'select-dark',kind:'select',themeId:'modern-mint-dark'},
    {id:'rc2-slider',legacy:true},{id:'rc2-select-visible',legacy:true}]) {
    const bundle=fixture.legacy?JSON.parse(await readFile(new URL(`../../tests/fixtures/section-geometry/${fixture.id}.bundle.json`,import.meta.url),'utf8'))
      :await sdk.panel.createPanelBundle(singleControlSpec(sdk.panel,sdk.seed.catalog,fixture.kind,{themeId:fixture.themeId??'modern-mint-light'}),sdk.seed.catalog,sdk.core);
    assert.deepEqual(await sdk.panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),sdk.core),bundle);
    const nodes=flatten(bundle.componentBundle.document.root),section=nodes.find(node=>node.id==='heading-fixture.section.section0');
    assert(section.layout.height>=80);
    const headings=nodes.filter(node=>/\.section\.[^.]+\.title$/.test(node.id));
    assert.equal(headings.length,fixture.id==='rc2-select-visible'?1:0);
    const row=nodes.find(node=>node.id==='heading-fixture.row.row0');
    if(!fixture.legacy&&fixture.kind!=='button')assert.equal(row.layout.y,0);
    if(fixture.kind==='select') {assert.deepEqual(bundle.spec.state[0].options.map(option=>option.label),['男','女']);assert.equal(bundle.state.row0,'male');}
    const native=await sdk.panel.createUnityDocument(bundle,sdk.core);
    assert.deepEqual(native.nodes.filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).map(node=>node.text),headings.map(node=>node.props.text));
    const kit=await sdk.delivery.createUnityKitFiles(bundle,sdk.core,sdk.delivery.sources);
    const delivery=await sdk.delivery.createPanelDelivery(bundle,sdk.core,{runtime:sdk.delivery.runtime,unityKit:kit});
    const zip=sdk.delivery.createStoredZip(delivery.contents),files=readStoredZip(zip);
    for(const file of delivery.manifest.files)assert.equal(await digestBytes(files.get(file.path)),file.sha256);
    const kitZip=sdk.delivery.createStoredZip(kit.contents),kitFiles=readStoredZip(kitZip);
    for(const file of kit.manifest.files)assert.equal(await digestBytes(kitFiles.get(file.path)),file.sha256);
    const directory=resolve(output,'geometry',fixture.id);await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,'panel-delivery.zip'),zip,{flag:'wx'});await writeFile(resolve(directory,'ugui-import-kit.zip'),kitZip,{flag:'wx'});
    for(const[name,bytes]of files)if(name.startsWith('pixi/')){const path=resolve(directory,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});}
    assert.deepEqual(JSON.parse(Buffer.from(files.get('pixi/panel.bundle.json'))),bundle);
    cases.push({id:fixture.id,kind:fixture.kind??'legacy',compilerVersion:bundle.compilerVersion,panelSha256:bundle.sha256,
      headings:headings.map(node=>node.props.text),sectionHeight:section.layout.height,rowY:row?.layout.y??null,state:bundle.state,
      zip:{bytes:zip.length,sha256:await digestBytes(zip)},uguiZip:{bytes:kitZip.length,sha256:await digestBytes(kitZip)}});
    pass('installed-geometry-delivery-'+fixture.id);
  }
  const report={status:'PASS',cases,checks,realModelCalls:0,unityNative:'NOT_RUN'};
  await writeFile(resolve(output,'geometry-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});return checks;
}
