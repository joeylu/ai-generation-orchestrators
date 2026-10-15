import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {digestBytes} from '../../src/canonical.mjs';
import {readStoredZip} from '../../tests/unity-kit-helpers.mjs';

/** Public regression fixtures through the installed SDK; never a model result. */
export async function checkInstalledCompactMessages(sdk,output){
 const {records}=JSON.parse(await readFile(new URL('../../tests/fixtures/compact-message-regressions-v1.json',import.meta.url),'utf8'));
 const artifacts=[],checks=[];
 for(const record of records){
  const spec=structuredClone(record.spec);
  if(['modern-readable-game','modern-readable-game-headings','modern-readable-game-layout','modern-readable-game-heading-panels','modern-readable-game-section-panels','modern-readable-game-grouped-layout','modern-readable-game-data-layout','modern-readable-game-data-panels','modern-readable-game-item-groups','modern-readable-game-card-layout','modern-readable-game-grid-layout'].includes(sdk.seed.catalog.id)){
    const theme=sdk.seed.catalog.themes.find(theme=>theme.id===spec.theme.id);assert(theme);spec.theme={id:theme.id,version:theme.version};
    spec.layout.titleHeight=Math.max(spec.layout.titleHeight,theme.headingSurface==='panel-v1'?64:Math.ceil(theme.tokens.titleSize*1.3));spec.layout.sectionTitleHeight=Math.max(spec.layout.sectionTitleHeight,theme.headingSurface==='panel-v1'?48:Math.ceil(theme.tokens.headingSize*1.3));
  }
  for(const row of spec.sections.flatMap(section=>section.rows))if(row.kind==='text')row.recipe.version='0.2.0';
  const bundle=await sdk.panel.createPanelBundle(spec,sdk.seed.catalog,sdk.core,record.state);
  assert.equal(bundle.compilerVersion,['modern-readable-game-grid-layout','modern-readable-game-item-groups','modern-readable-game-card-layout'].includes(sdk.seed.catalog.id)?'0.45.0':sdk.seed.catalog.id==='modern-readable-game-data-panels'?'0.44.0':sdk.seed.catalog.id==='modern-readable-game-data-layout'?'0.43.0':sdk.seed.catalog.id==='modern-readable-game-grouped-layout'?'0.42.0':sdk.seed.catalog.id==='modern-readable-game-section-panels'?'0.41.0':sdk.seed.catalog.id==='modern-readable-game-heading-panels'?'0.40.0':sdk.seed.catalog.id==='modern-readable-game-layout'?'0.39.0':sdk.seed.catalog.id==='modern-readable-game-headings'?'0.38.0':sdk.seed.catalog.id==='modern-readable-game'?'0.37.0':'0.36.0');
  const buttons=record.spec.sections[0].rows.filter(row=>row.kind==='button');assert.equal(bundle.actions.length,buttons.length);
  for(const row of buttons){const action=bundle.actions.find(action=>action.rowId===row.id);assert(action);for(const key of ['action','event','enabled'])assert.deepEqual(action[key],row[key]);}
  const text=spec.sections[0].rows[0];assert.equal(text.text,record.spec.sections[0].rows[0].text);assert(text.label.length>0);
  const kit=await sdk.delivery.createUnityKitFiles(bundle,sdk.core,sdk.delivery.sources);
  const delivery=await sdk.delivery.createPanelDelivery(bundle,sdk.core,{runtime:sdk.delivery.runtime,unityKit:kit});
  const zip=sdk.delivery.createStoredZip(delivery.contents),files=readStoredZip(zip);
  for(const file of delivery.manifest.files)assert.equal(await digestBytes(files.get(file.path)),file.sha256);
  const directory=resolve(output,'compact-message',record.id);await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'panel-delivery.zip'),zip,{flag:'wx'});
  for(const[name,bytes]of files)if(name.startsWith('pixi/')){const target=resolve(directory,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});}
  const native=await sdk.panel.createUnityDocument(bundle,sdk.core);
  assert(native.nodes.some(node=>node.text===text.text&&node.textAlignment==='MiddleCenter'));
  artifacts.push({id:record.id,panelSha256:bundle.sha256,pixiDirectory:'compact-message/'+record.id+'/pixi',zipSha256:await digestBytes(zip)});
  checks.push({name:'installed-compact-message-'+record.id,status:'PASS'});
 }
 await writeFile(resolve(output,'compact-message-report.json'),JSON.stringify({status:'PASS',kind:'INSTALLED_COMPACT_FIXTURES_NOT_MODEL_RESULTS',artifacts,realModelCalls:0,unityNative:'NOT_RUN'},null,2)+'\n',{flag:'wx'});
 return checks;
}
