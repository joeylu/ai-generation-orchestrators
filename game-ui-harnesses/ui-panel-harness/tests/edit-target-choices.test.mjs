import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scopedCopyFixture} from '../examples/scoped-button-copy-v1/fixture.mjs';
import {createPanelEditContext} from '../src/edit-planning.mjs';
import {ambiguousButtonCopyChoices} from '../src/edit-property-review.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-menu.catalog.json',import.meta.url),'utf8'));
const {spec}=await scopedCopyFixture(catalog);
const text='恢复默认按钮文字改为“仅恢复声音”，其他不变。';
const context=(t=text,s=spec,selection=null,policy='properties-v4')=>createPanelEditContext(s,catalog,
 {requestVersion:'0.1',id:'target-choice-fixture',target:'pixi',text:t},selection,{requestChecks:policy});
test('one exact ambiguous rename offers both groups without choosing a target or changing the context',async()=>{
 const c=await context(),before=structuredClone(c),choices=ambiguousButtonCopyChoices(c);
 assert.deepEqual(choices,[{rowId:'row1',label:'声音 · 恢复默认'},{rowId:'row3',label:'显示 · 恢复默认'}]);
 assert.deepEqual(c,before);assert.equal(c.requestChecks.items.length,0);assert(!c.requestChecks.preserveRest.enforced);
});
test('selection or exact qualification needs no local question; old policies stay unchanged',async()=>{
 for(const c of [await context(text,spec,{rowId:'row3'}),await context('声音分组里的'+text),
  await context(text,spec,null,'properties-v3'),await context(text,spec,null,'properties-v2')])assert.deepEqual(ambiguousButtonCopyChoices(c),[]);
});
test('local choices never infer a target from unknown names, malformed copy or correction/example language',async()=>{
 for(const t of ['不存在按钮文字改为“声音”。','恢复默认按钮文字改为声音。','恢复默认按钮文字改为“未闭合。',
  '例如'+text,'恢复默认按钮文字改为“声音”，不对，改成“显示”。','不存在分组里的'+text,
  '“这个”按钮文字改为“声音”。','让恢复默认更容易找到。'])assert.deepEqual(ambiguousButtonCopyChoices(await context(t)),[],t);
});
test('mixed requests and multiple assignments are left to existing model clarification',async()=>{
 for(const t of ['恢复默认按钮文字改为“声音”，标题改为“设置”。','恢复默认按钮文字改为“声音”，同时改变布局。',
  '恢复默认按钮文字改为“声音”，恢复默认按钮文字改为“显示”。'])assert.deepEqual(ambiguousButtonCopyChoices(await context(t)),[],t);
});
test('quoted full names containing qualifier words are literal, including punctuation',async()=>{
 const s=structuredClone(spec);for(const section of s.sections)section.rows[1].buttonLabel='声音分组里的恢复，默认';
 const choices=ambiguousButtonCopyChoices(await context('“声音分组里的恢复，默认”按钮文字改为“仅恢复，声音”。',s));
 assert.deepEqual(choices.map(c=>c.rowId),['row1','row3']);
});
test('same group duplicate names and duplicate section titles get positional labels',async()=>{
 const s=structuredClone(spec);s.sections[1].title='声音';
 const extra=structuredClone(s.sections[0].rows[1]);extra.id='extra';extra.event='panel.extra';s.sections[0].rows.push(extra);
 const choices=ambiguousButtonCopyChoices(await context(text,s));
 assert.equal(new Set(choices.map(c=>c.label)).size,3);assert.deepEqual(choices.map(c=>c.rowId),['row1','extra','row3']);
 assert(choices[0].label.includes('第1组'));assert(choices[0].label.includes('第2项'));assert(choices[1].label.includes('第3项'));assert(choices[2].label.includes('第2组'));
});
