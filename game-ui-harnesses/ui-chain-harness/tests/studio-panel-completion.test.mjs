import test from 'node:test';
import assert from 'node:assert/strict';
import {panelCompletion} from '../src/studio/panel-completion.mjs';

const job={id:'job',sha256:'digest',status:'running'};
const projects=(changes={})=>[{id:'project',name:'测试',panels:[{...job,...changes}]}];
const ready={status:'ready',artifact:{id:'preview'}};
function setup(){const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};const tracker=panelCompletion(storage);tracker.watch('project',job,'#generate-panel');return{tracker,storage};}

test('only a ready artifact opens once, including after refresh',()=>{
 const {tracker,storage}=setup();assert.equal(tracker.observe(projects(),'#generate-panel'),null);
 const restored=panelCompletion(storage);assert.equal(restored.observe(projects({status:'ready'}),'#generate-panel'),null);
 assert.deepEqual(restored.observe(projects(ready),'#generate-panel'),{artifactId:'preview',name:'测试',autoOpen:true});
 assert.equal(restored.observe(projects(ready),'#generate-panel'),null);
 assert.equal(panelCompletion(storage).observe(projects(ready),'#generate-panel'),null);
});
test('leaving, returning or editing prevents navigation but still reports completion',()=>{
 for(const interrupt of [t=>t.leave('#library'),t=>t.editing()]){const {tracker}=setup();interrupt(tracker);assert.equal(tracker.observe(projects(ready),'#generate-panel').autoOpen,false);}
 const {tracker}=setup();assert.equal(tracker.observe(projects(ready),'#panels').autoOpen,false);
});
test('only the watched project and revision can complete',()=>{
 const {tracker}=setup();assert.equal(tracker.observe([{id:'other',panels:[{...job,...ready}]}],'#generate-panel'),null);
 assert.equal(tracker.observe(projects({...ready,sha256:'new'}),'#generate-panel'),null);
 assert.equal(tracker.observe(projects(ready),'#generate-panel'),null);
});
test('failure, clarification and deletion clear pending navigation',()=>{
 for(const change of [{status:'needs-input'},{status:'failed-no-retry'},{status:'interrupted-no-retry'},{status:'invalid'},{deletedAt:'today'}]){const {tracker,storage}=setup();assert.equal(tracker.observe(projects(change),'#generate-panel'),null);assert.equal(panelCompletion(storage).observe(projects(ready),'#generate-panel'),null);}
});
test('an open confirmation defers navigation until dismissed',()=>{
 const {tracker}=setup();assert.equal(tracker.observe(projects(ready),'#generate-panel',true),null);assert.equal(tracker.observe(projects(ready),'#generate-panel').autoOpen,true);
});
test('ineligible submission and unavailable storage do not break completion',()=>{
 const tracker=panelCompletion({getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}});
 tracker.watch('project',job,'#generate-panel',false);assert.equal(tracker.observe(projects(ready),'#generate-panel').autoOpen,false);
});
