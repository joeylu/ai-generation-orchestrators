import test from 'node:test';
import assert from 'node:assert/strict';
import {planningClient} from '../src/panel/planning-client.mjs';
import {readPanelSdkJson,panelSdkIdentity} from '../src/panel/sdk.mjs';
const catalog=await readPanelSdkJson('catalog/modern-core.json');

test('updated heading catalog retains native protocol compatibility without adopting its rendering policy',async()=>{
  const headings=await readPanelSdkJson('examples/modern-action-headings.catalog.json');
  const session=await planningClient().prepare({request:{requestVersion:'0.1',id:'heading-upgrade',text:'设置面板，音乐开关默认开启。',target:'pixi'},catalog:headings});
  assert.equal(session.context.planningContextVersion,'0.11');
  assert.deepEqual(session.responseSchema.properties.panelIntentVersion.enum,['0.12']);
  assert.deepEqual(await planningClient().verify(session),session);
  // This tests the wire boundary only. A theme mapping is not a layout implementation.
});
test('Chain uses the public Panel API with deterministic roundtrip and no legacy compiler',async()=>{
  const client=planningClient();const session=await client.prepare({request:{requestVersion:'0.1',id:'chain-settings',text:'音量范围0到100，默认65，步长1。',target:'pixi'},catalog});
  assert.deepEqual(await client.verify(JSON.parse(JSON.stringify(session))),session);
  const changed=structuredClone(session);changed.responseSchema.extra=true;await assert.rejects(()=>client.verify(changed));
});
test('Chain rejects unknown API and newly introduced wire versions instead of silently upgrading',async()=>{
  assert.throws(()=>planningClient({PLANNING_API_VERSION:'2.0'}),{code:'panel.planner-version'});
  const client=planningClient({PLANNING_API_VERSION:'1.0',preparePlanning:async()=>({apiVersion:'1.0',context:{planningContextVersion:'future'}}),verifyPlanning:async s=>s});
  await assert.rejects(()=>client.prepare({}),{code:'panel.planner-version'});
});

test('Chain accepts the full component catalog protocol and rejects untested version combinations',async()=>{
  const fullCatalog=await readPanelSdkJson('examples/modern-all-components.catalog.json');
  const client=planningClient();
  const session=await client.prepare({request:{requestVersion:'0.1',id:'full-settings',text:'音乐开关默认开启。',target:'pixi'},catalog:fullCatalog});
  assert.equal(session.context.planningContextVersion,'0.11');
  assert.deepEqual(session.responseSchema.properties.panelIntentVersion.enum,['0.12']);
  assert.deepEqual(await client.verify(session),session);
  const crossed=structuredClone(session);crossed.context.planningContextVersion='0.1';
  const unsupported=planningClient({PLANNING_API_VERSION:'1.0',preparePlanning:async()=>crossed,verifyPlanning:async s=>s});
  await assert.rejects(()=>unsupported.prepare({}),{code:'panel.planner-version'});
});

test('inventory wire version is accepted only as the exact context 0.12 and intent 0.13 pair',async()=>{
  const inventoryCatalog=await readPanelSdkJson('examples/modern-readable-game-grid-layout.catalog.json');
  const session=await planningClient().prepare({request:{requestVersion:'0.1',id:'inventory-wire',text:'仓库面板，5列4行。',target:'pixi'},catalog:inventoryCatalog});
  assert.equal(session.context.planningContextVersion,'0.12');assert.deepEqual(session.responseSchema.properties.panelIntentVersion.enum,['0.13']);
  assert.deepEqual(await planningClient().verify(session),session);
  for(const [context,intent]of [['0.12','0.12'],['0.11','0.13'],['0.13','0.13']]){
    const crossed=structuredClone(session);crossed.context.planningContextVersion=context;crossed.responseSchema.properties.panelIntentVersion.enum=[intent];
    const client=planningClient({PLANNING_API_VERSION:'1.0',preparePlanning:async()=>crossed,verifyPlanning:async value=>value});
    await assert.rejects(client.prepare({}),{code:'panel.planner-version'});await assert.rejects(client.verify(crossed),{code:'panel.planner-version'});
  }
});

test('ordinary and inventory catalogs use the locked official package without seed default migration',async()=>{
 const identity=await panelSdkIdentity();assert.equal(identity.mode,'locked');assert.equal(identity.sourceCommit,'514bc98c9bcf699e094e7d9b4bfb0ab9474c79ff');
 const ordinary=await readPanelSdkJson('examples/modern-all-components.catalog.json'),inventory=await readPanelSdkJson('examples/modern-readable-game-grid-layout.catalog.json'),request={requestVersion:'0.1',id:'sdk-catalog-guard',text:'设置面板',target:'pixi'};
 const client=planningClient(),a=await client.prepare({request,catalog:ordinary}),b=await client.prepare({request,catalog:inventory});
 assert.equal(a.context.planningContextVersion,'0.11');assert.deepEqual(a.responseSchema.properties.panelIntentVersion.enum,['0.12']);assert.equal(b.context.planningContextVersion,'0.12');assert.deepEqual(b.responseSchema.properties.panelIntentVersion.enum,['0.13']);
});
