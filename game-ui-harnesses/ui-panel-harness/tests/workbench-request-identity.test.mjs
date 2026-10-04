import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorkbenchRequestIdentity} from '../src/workbench-request-identity.mjs';

test('different default Studio requirements get distinct valid panel IDs; unchanged prepares retain theirs', () => {
  const identity=createWorkbenchRequestIdentity();
  const first=identity.select('声音设置','','my-panel');
  assert.match(first,/^panel-[a-f0-9]{32}$/);assert.equal(identity.select('声音设置','',first),first);
  const second=identity.select('背包筛选','',first);assert.notEqual(second,first);
  assert.notEqual(identity.select('背包筛选','modern-mint',second),second);
});
test('clarification and example adoption retain their source request identity', () => {
  let count=0;const identity=createWorkbenchRequestIdentity(()=>`panel-${++count}`);
  const initial=identity.select('缺初值','','my-panel');
  identity.adopt('缺初值。补充默认70。','',initial);assert.equal(identity.select('缺初值。补充默认70。','',initial),initial);
  identity.adopt('完整示例','','example-settings');assert.equal(identity.select('完整示例','','example-settings'),'example-settings');
  assert.equal(identity.select('新的任务面板','','example-settings'),'panel-2');
});
test('explicit advanced IDs stay manual; clearing restores automatic identity', () => {
  let count=0;const identity=createWorkbenchRequestIdentity(()=>`panel-${++count}`);
  identity.setManual(true);assert.equal(identity.select('声音设置','','studio-audio'),'studio-audio');
  assert.equal(identity.select('新需求','','studio-audio'),'studio-audio');assert.equal(count,0);
  identity.setManual(false);assert.equal(identity.select('新需求','',''),'panel-1');
});
test('invalid identity factories cannot yield paths or oversized IDs', () => {
  for(const value of ['../panel','1panel','panel/x','x'.repeat(65),null])assert.throws(()=>createWorkbenchRequestIdentity(()=>value).select('需求','','my-panel'),/WORKBENCH_REQUEST_ID/);
});
