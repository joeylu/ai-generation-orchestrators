import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planningClient} from '../src/panel/planning-client.mjs';
const catalog=JSON.parse(await readFile(new URL('../../ui-panel-harness/catalog/modern-core.json',import.meta.url)));

test('updated heading catalog retains native protocol compatibility without adopting its rendering policy',async()=>{
  const headings=JSON.parse(await readFile(new URL('../../ui-panel-harness/examples/modern-action-headings.catalog.json',import.meta.url)));
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
  const fullCatalog=JSON.parse(await readFile(new URL('../../ui-panel-harness/examples/modern-all-components.catalog.json',import.meta.url)));
  const client=planningClient();
  const session=await client.prepare({request:{requestVersion:'0.1',id:'full-settings',text:'音乐开关默认开启。',target:'pixi'},catalog:fullCatalog});
  assert.equal(session.context.planningContextVersion,'0.11');
  assert.deepEqual(session.responseSchema.properties.panelIntentVersion.enum,['0.12']);
  assert.deepEqual(await client.verify(session),session);
  const crossed=structuredClone(session);crossed.context.planningContextVersion='0.1';
  const unsupported=planningClient({PLANNING_API_VERSION:'1.0',preparePlanning:async()=>crossed,verifyPlanning:async s=>s});
  await assert.rejects(()=>unsupported.prepare({}),{code:'panel.planner-version'});
});
