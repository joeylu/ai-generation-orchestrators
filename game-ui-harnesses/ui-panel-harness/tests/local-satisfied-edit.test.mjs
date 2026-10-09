import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scopedCopyFixture} from '../examples/scoped-button-copy-v1/fixture.mjs';
import {createPanelEditContext} from '../src/edit-planning.mjs';
import {alreadySatisfiedEditRequirements} from '../src/edit-property-review.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-menu.catalog.json',import.meta.url),'utf8'));
const {spec}=await scopedCopyFixture(catalog);
const text='声音分组里的恢复默认按钮文字改为“恢复默认”，其他不变。';
const context=(t=text,selection=null,policy='properties-v4')=>createPanelEditContext(spec,catalog,
 {requestVersion:'0.1',id:'local-satisfied-fixture',target:'pixi',text:t},selection,{requestChecks:policy});
test('exact already-satisfied copy plus preserve-rest produces local evidence without mutating context',async()=>{
 const c=await context(),before=structuredClone(c),report=alreadySatisfiedEditRequirements(c);
 assert.equal(report.status,'MATCHED');assert.equal(report.unverifiedCount,0);assert.equal(report.preserveRest.status,'MATCHED');
 assert(report.items.every(item=>item.matched));assert.equal(report.semanticReview,'NOT_RUN');assert.deepEqual(c,before);
});
test('every explicit item must already match, including independent groups',async()=>{
 const matched='声音分组里的恢复默认按钮文字改为“恢复默认”，显示分组里的恢复默认按钮文字改为“恢复默认”，标题改为“声音与显示”，其他不变。';
 assert.equal(alreadySatisfiedEditRequirements(await context(matched)).items.length,4);
 assert.equal(alreadySatisfiedEditRequirements(await context(matched.replace('标题改为“声音与显示”','标题改为“设置”'))),null);
});
test('default requirements compare authored defaults rather than saved played values',async()=>{
 assert(alreadySatisfiedEditRequirements(await context('主音量默认值改为70，亮度默认值改为40，其他不变。')));
 assert.equal(alreadySatisfiedEditRequirements(await context('主音量默认值改为35，其他不变。')),null);
});
test('partial recognition, corrections, examples and conflicting assignments cannot skip the model',async()=>{
 for(const t of [text.replace('其他不变','同时旋转图标，其他不变'),'例如'+text,
  text.replace('其他不变','不对，改成“声音”，其他不变'),
  '标题改为“声音与显示”，标题改为“声音与显示”，其他不变。',
  '声音分组里的恢复默认按钮文字改为“未闭合，其他不变。'])assert.equal(alreadySatisfiedEditRequirements(await context(t)),null,t);
});
test('unqualified duplicates, empty facts and missing preserve-rest stay on the existing path',async()=>{
 for(const t of ['恢复默认按钮文字改为“恢复默认”，其他不变。','其他不变。',text.replace('，其他不变',''),
  '恢复默认按钮文字改为“恢复默认”，让按钮更好看。'])assert.equal(alreadySatisfiedEditRequirements(await context(t)),null,t);
});
test('selection is respected and old context policies do not gain new skipping behavior',async()=>{
 assert(alreadySatisfiedEditRequirements(await context('这个按钮文字改为“恢复默认”，其他不变。',{rowId:'row3'})));
 assert.equal(alreadySatisfiedEditRequirements(await context(text,{rowId:'row3'})),null);
 for(const policy of ['properties-v2','properties-v3'])assert.equal(alreadySatisfiedEditRequirements(await context(text,null,policy)),null);
});
test('cached request-check tampering cannot turn an unsatisfied request into local success',async()=>{
 const c=await context(text.replace('改为“恢复默认”','改为“仅恢复声音”'));
 c.requestChecks.items[0].expected='恢复默认';assert.equal(alreadySatisfiedEditRequirements(c),null);
});
