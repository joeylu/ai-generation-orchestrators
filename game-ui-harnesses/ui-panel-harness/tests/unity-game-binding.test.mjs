import test from 'node:test';
import assert from 'node:assert/strict';
import {core,fixture,catalog} from './helpers.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {createUnityGameBinding} from '../src/unity-game-binding.mjs';
import {digestJson} from '../src/canonical.mjs';
const bundle=await createPanelBundle(fixture,catalog,core);
const route={gameBindingVersion:'0.1',panelId:bundle.spec.id,panelSha256:bundle.sha256,states:[{fieldId:'volume',key:'volume',direction:'two-way'}],commands:[]};
test('native game binding keeps common route digest and copies validated routes',async()=>{const result=await createUnityGameBinding(route,bundle);assert.equal(result.unityGameBindingVersion,'0.1');assert.equal(result.sourceBindingSha256,await digestJson(route));assert.equal(result.panelSha256,bundle.sha256);result.states[0].key='changed';assert.equal(route.states[0].key,'volume');});
test('native game conversion refuses stale and malformed sources before writing',async()=>{await assert.rejects(createUnityGameBinding({...route,panelSha256:'0'.repeat(64)},bundle),/GAME_BINDING_SOURCE/);await assert.rejects(createUnityGameBinding({...route,commands:[{rowId:'volume-row',command:'save',payload:{},concurrency:'drop'}]},bundle),/GAME_BINDING_COMMAND/);});
test('native payload conversion preserves exact field targets using JsonUtility arrays',async()=>{
 const spec=structuredClone(fixture),recipes=structuredClone(catalog);spec.panelSpecVersion='0.3';spec.assets=null;
 recipes.recipes.push({id:'test.button',version:'1.0.0',kind:'button-row',description:'Native route conversion fixture',tags:['button'],states:['idle','hover','disabled'],supports:['pixi'],minWidth:280,minHeight:40});
 spec.sections[0].rows.push({id:'reset-row',kind:'button',recipe:{id:'test.button',version:'1.0.0'},label:'音量操作',buttonLabel:'恢复音量',enabled:true,event:'audio.reset',action:{kind:'reset-initial',fields:['volume']}});
 const buttons=await createPanelBundle(spec,recipes,core),input={...route,panelSha256:buttons.sha256,commands:[{rowId:'reset-row',command:'settings.reset',payload:{current:'volume'},concurrency:'replace'}]};
 const result=await createUnityGameBinding(input,buttons);assert.deepEqual(result.commands,[{rowId:'reset-row',command:'settings.reset',payload:[{key:'current',fieldId:'volume'}],concurrency:'replace'}]);assert.equal(result.sourceBindingSha256,await digestJson(input));
});
