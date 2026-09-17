import test from 'node:test';import assert from 'node:assert/strict';
import {linkageFixture,linkageHandoffFixture} from './helpers/component-linkages-fixture.ts';
import {validateDocument} from '../src/tree-contract.ts';
import {linkageTransition,visibleLinkageItems,quantityValue,writeQuantity,linkageTotal,linkageNodes} from '../src/component-linkages.ts';
import {compileComponentHandoff} from '../src/component-handoff.ts';
test('linkage projection uses stable IDs, stable price ties and bounded multiplication',()=>{const d=linkageFixture(),p=d.componentLinkages!.pipelines[0];validateDocument(d);assert.deepEqual(visibleLinkageItems(d,p).map(i=>i.itemId),['ember','tidal','shadow','verdant','chain','iron']);assert.equal(linkageTotal(d,p),'20 gold');writeQuantity(d,p,3);assert.equal(linkageTotal(d,p),'60 gold');const nodes=linkageNodes(d),search=nodes.get('search')!;if(search.type==='Input')search.props.value='SHADOW';assert.deepEqual(visibleLinkageItems(d,p).map(i=>i.itemId),['shadow']);assert.equal(quantityValue(d,p),3);validateDocument(d);});
const mutations:Record<string,(d:ReturnType<typeof linkageFixture>)=>void>={version:d=>{(d.componentLinkages as any).version='9'},reference:d=>{d.componentLinkages!.pipelines[0].quantity.incrementId='missing'},type:d=>{d.componentLinkages!.pipelines[0].quantity.incrementId='total'},duplicate:d=>{d.componentLinkages!.pipelines.push(structuredClone(d.componentLinkages!.pipelines[0]))},mapping:d=>{d.componentLinkages!.pipelines[0].sort.map.pop()},item:d=>{d.componentLinkages!.pipelines[0].items[0].itemId='missing'},operation:d=>{(d.componentLinkages!.pipelines[0].total as any).operation='eval'},step:d=>{d.componentLinkages!.pipelines[0].quantity.step=0},overflow:d=>{d.componentLinkages!.pipelines[0].items[0].unitPrice=Number.MAX_SAFE_INTEGER},target:d=>{d.componentLinkages!.pipelines[0].total.textId='selected-name'},state:d=>{d.linkageState={version:'1.0',quantities:[{listId:'skill-list',value:99}]}},unknown:d=>{(d.componentLinkages!.pipelines[0] as any).script='x'}};
for(const [name,mutate]of Object.entries(mutations))test('reject '+name,()=>{const d=linkageFixture();mutate(d);assert.throws(()=>validateDocument(d),/COMPONENT_LINKAGE/);});
test('old document has no inferred linkage; orphan runtime state rejected',()=>{const d=linkageFixture();delete d.componentLinkages;assert.equal(validateDocument(d).componentLinkages,undefined);d.linkageState={version:'1.0',quantities:[]};assert.throws(()=>validateDocument(d),/STATE_WITHOUT/);});
test('official handoff compiler retains linkage configuration',async()=>{const f=await linkageHandoffFixture(),c=await compileComponentHandoff(f.zip);assert.deepEqual((c.bundle.document as any).componentLinkages,f.document.componentLinkages);});
test('pure transition handles reset/retain/first/clear and quantity limits without invalid updates',()=>{
 const p=linkageFixture().componentLinkages!.pipelines[0];
 assert.deepEqual(linkageTransition(p,['ember'],'ember','ember',3,'plus'),{selectedId:'ember',quantity:3});
 assert.deepEqual(linkageTransition(p,[], 'ember','ember',3,'plus'),{selectedId:null,quantity:1});
 p.quantity.onSelectionChange='retain';p.selectionOnFilter='first';
 assert.deepEqual(linkageTransition(p,['shadow'],'ember','ember',3),{selectedId:'shadow',quantity:3});
 assert.deepEqual(linkageTransition(p,[],null,null,2,'plus'),{selectedId:null,quantity:2});
 assert.deepEqual(linkageTransition(p,['ember'],'ember','ember',1,'minus'),{selectedId:'ember',quantity:1});
});
test('category, prefix matching and descending stable tie order are explicit',()=>{
 const d=linkageFixture(),p=d.componentLinkages!.pipelines[0],nodes=linkageNodes(d);
 const sort=nodes.get('sort')!;if(sort.type==='Select')sort.props.selectedId='high';
 assert.deepEqual(visibleLinkageItems(d,p).map(i=>i.itemId),['iron','chain','verdant','tidal','shadow','ember']);
 const category=nodes.get('category')!;if(category.type==='Tabs')category.props.activeId='a';
 assert.deepEqual(visibleLinkageItems(d,p).map(i=>i.itemId),['chain','shadow','ember']);
 p.search.match='startsWith';p.search.caseSensitive=true;const search=nodes.get('search')!;if(search.type==='Input')search.props.value='sh';assert.deepEqual(visibleLinkageItems(d,p),[]);
 p.search.caseSensitive=false;assert.equal(visibleLinkageItems(d,p)[0].itemId,'shadow');
});
