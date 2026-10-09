import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scopedCopyFixture} from '../examples/scoped-button-copy-v1/fixture.mjs';
import {createPanelEditContext} from '../src/edit-planning.mjs';
import {selectedEditScopeConflicts} from '../src/edit-property-review.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-menu.catalog.json',import.meta.url),'utf8'));
const {spec}=await scopedCopyFixture(catalog);
const context=(text,selection={rowId:'row1'},s=spec,policy='properties-v4')=>createPanelEditContext(s,catalog,
 {requestVersion:'0.1',id:'selected-scope-fixture',target:'pixi',text},selection,{requestChecks:policy});

test('selected rename mixed with a panel title is held before partial editing, preserving source evidence',async()=>{
 const c=await context('这个按钮文字改为“仅恢复声音”，标题改为“设置”，其他不变。'),before=structuredClone(c);
 assert.equal(c.requestChecks.items.length,1);assert.equal(c.requestChecks.unverified.length,1);
 assert.deepEqual(selectedEditScopeConflicts(c).map(item=>[item.field,item.quote]),[['title','标题改为“设置”']]);
 assert.deepEqual(c,before);
});
test('explicit global layout, appearance and another bound control are outside selected scope',async()=>{
 for(const [text,field] of [['面板宽度改为480','width'],['标题字号改为24','titleFont'],
  ['强调色改为#127AFF','color'],['绿色主题','theme'],['亮度默认值改为25','initial']]){
  assert.deepEqual(selectedEditScopeConflicts(await context(text)).map(item=>item.field),[field],text);
 }
});
test('two explicitly qualified copies cannot partially apply under one selection',async()=>{
 const c=await context('声音分组里的恢复默认按钮文字改为“仅恢复声音”，显示分组里的恢复默认按钮文字改为“仅恢复显示”，其他不变。');
 assert.deepEqual(selectedEditScopeConflicts(c).map(item=>item.target),['row3']);
});
test('selected operations, original duplicate name and pronoun remain on the existing path',async()=>{
 for(const text of ['这个按钮文字改为“仅恢复声音”，其他不变。','恢复默认按钮文字改为“仅恢复声音”，其他不变。',
  '声音分组里的恢复默认按钮文字改为“仅恢复声音”，恢复默认字号改为18，其他不变。'])
  assert.deepEqual(selectedEditScopeConflicts(await context(text)),[],text);
 assert.deepEqual(selectedEditScopeConflicts(await context('主音量默认值改为45，其他不变。',{rowId:'row0'})),[]);
});
test('unknown prose, unmatched names, negation, corrections and examples are never guessed',async()=>{
 for(const text of ['布局更好看一点','不要改标题','不存在按钮文字改为“声音”。','标题改为“未闭合。',
  '标题改为“设置”，不对，只改按钮。','例如标题改为“设置”，这个按钮文字改为“声音”。',
  '主音量默认值改为80，不对，主音量默认值改为45，以这次纠正为准。'])
  assert.deepEqual(selectedEditScopeConflicts(await context(text)),[],text);
});
test('an explicit conflict is held even alongside unrecognized prose',async()=>{
 const c=await context('这个按钮文字改为“声音”，标题改为“设置”，顺便更精致一点。');
 assert.deepEqual(selectedEditScopeConflicts(c).map(item=>item.field),['title']);
});
test('ambiguous repeated assignments on the selected control are not mislabeled as outside scope',async()=>{
 assert.deepEqual(selectedEditScopeConflicts(await context('这个按钮文字改为“声音”，声音分组里的恢复默认按钮文字改为“恢复声音”。')),[]);
});
test('quoted copy is literal, including words that resemble panel instructions and punctuation',async()=>{
 assert.deepEqual(selectedEditScopeConflicts(await context('这个按钮文字改为“标题改为设置，面板宽度改为480”，其他不变。')),[]);
 const s=structuredClone(spec);s.sections[1].rows[1].buttonLabel='标题，宽度';
 assert.deepEqual(selectedEditScopeConflicts(await context('“标题，宽度”按钮文字改为“显示”。',{rowId:'row1'},s)).map(item=>item.target),['row3']);
});
test('unselected requests and previous context policies keep their existing behavior',async()=>{
 assert.deepEqual(selectedEditScopeConflicts(await context('标题改为“设置”。',null)),[]);
 for(const policy of ['properties-v2','properties-v3'])assert.deepEqual(selectedEditScopeConflicts(await context('标题改为“设置”。',{rowId:'row1'},spec,policy)),[]);
});
test('cached request-check facts cannot hide or invent a scope conflict',async()=>{
 const c=await context('标题改为“设置”。');c.requestChecks.items=[];c.requestChecks.unverified=[];
 assert.deepEqual(selectedEditScopeConflicts(c).map(item=>item.field),['title']);
 c.request.text='这个按钮文字改为“声音”。';assert.deepEqual(selectedEditScopeConflicts(c),[]);
});
