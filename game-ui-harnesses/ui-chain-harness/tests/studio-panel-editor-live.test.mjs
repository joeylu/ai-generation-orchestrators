import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelEditorLive} from '../src/studio/panel-editor-live.mjs';

const request=(value,group='text',nodeId='title',variantKey='wide')=>({variantKey,nodeId,group,values:{value}});
function clock(){
  let id=0;const jobs=new Map(),all=new Map();
  return {setTimer(callback,delay){const key=++id;jobs.set(key,{callback,delay});all.set(key,callback);return key;},clearTimer(key){jobs.delete(key);},run(){for(const [key,job]of [...jobs]){jobs.delete(key);job.callback();}},get jobs(){return jobs;},get last(){return all.get(id);}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('debounce snapshots raw input and executes only the latest request for the same node and group',async()=>{
  const time=clock(),calls=[],live=createPanelEditorLive({...time,apply:async value=>{calls.push(value);return 'preview';}}),first=request('old');
  live.schedule(first);first.values.value='mutated outside';live.schedule(request('latest'));
  assert.equal(live.pending,true);assert.equal(live.active,false);assert.equal(time.jobs.size,1);assert.equal([...time.jobs.values()][0].delay,180);
  time.run();const results=await live.flush();assert.equal(calls.length,1);assert.equal(calls[0].values.value,'latest');assert.equal(results[0].status,'fulfilled');assert.equal(results[0].value,'preview');assert.equal(live.pending,false);assert.equal(live.active,false);
  const raw=request('1e');live.schedule(raw);raw.values.value='bad';await live.flush();assert.equal(calls[1].values.value,'1e');
});

test('groups keep their latest snapshots in chronological order and flush bypasses the pending timer',async()=>{
  const time=clock(),calls=[],live=createPanelEditorLive({...time,apply:async value=>calls.push([value.group,value.values.value])});
  live.schedule(request('old','text'));live.schedule(request('500','rectangle'));live.schedule(request('new','text'));
  const outcomes=await live.flush();assert.deepEqual(calls,[['rectangle','500'],['text','new']]);assert.equal(outcomes.length,2);assert.equal(time.jobs.size,0);assert.deepEqual(await live.flush(),[]);
});

test('new input during an async preview invalidates its publication and every apply remains serial',async()=>{
  const time=clock(),first=deferred(),entered=[],published=[];let simultaneous=0,maxSimultaneous=0;
  const live=createPanelEditorLive({...time,apply:async (value,{isCurrent})=>{
    simultaneous++;maxSimultaneous=Math.max(maxSimultaneous,simultaneous);entered.push(value.values.value);
    if(value.values.value==='old')await first.promise;
    if(isCurrent())published.push(value.values.value);simultaneous--;return value.values.value;
  }});
  live.schedule(request('old'));time.run();assert.equal(live.active,true);
  live.schedule(request('intermediate'));live.schedule(request('latest'));time.run();assert.deepEqual(entered,['old']);
  const done=live.flush();first.resolve();const outcomes=await done;
  assert.equal(maxSimultaneous,1);assert.deepEqual(entered,['old','latest']);assert.deepEqual(published,['latest']);assert.deepEqual(outcomes.map(value=>value.status),['stale','fulfilled']);assert.equal(live.active,false);
});

test('switching node or variant drops the previous queue and invalidates previous in-flight work',async()=>{
  for(const next of [request('other node','text','other'),request('other variant','text','title','tall')]){
    const time=clock(),first=deferred(),calls=[],published=[],live=createPanelEditorLive({...time,apply:async (value,{isCurrent})=>{calls.push(value.values.value);if(value.values.value==='active')await first.promise;if(isCurrent())published.push(value.values.value);}});
    live.schedule(request('active'));time.run();live.schedule(request('old queued','rectangle'));live.schedule(next);
    const done=live.flush();first.resolve();await done;
    assert.deepEqual(calls,['active',next.values.value]);assert.deepEqual(published,[next.values.value]);
  }
});

test('input arriving during active work keeps its debounce unless explicitly flushed',async()=>{
  const time=clock(),gate=deferred(),calls=[],live=createPanelEditorLive({...time,apply:async value=>{calls.push(value.values.value);if(value.values.value==='first')await gate.promise;}});
  live.schedule(request('first'));time.run();live.schedule(request('next'));gate.resolve();await Promise.resolve();await Promise.resolve();
  assert.deepEqual(calls,['first']);assert.equal(live.active,false);assert.equal(live.pending,true);assert.equal(time.jobs.size,1);
  time.run();await live.flush();assert.deepEqual(calls,['first','next']);
});

test('cancel removes queued work and even an already-dispatched old timer cannot start cancelled or newer work',async()=>{
  const time=clock(),calls=[],live=createPanelEditorLive({...time,apply:async value=>calls.push(value.values.value)});
  live.schedule(request('cancelled'));const staleTimer=time.last;live.cancel();staleTimer();assert.equal(live.pending,false);assert.deepEqual(await live.flush(),[]);assert.deepEqual(calls,[]);
  live.schedule(request('new'));staleTimer();assert.equal(live.pending,true);assert.equal(live.active,false);assert.equal(time.jobs.size,1);
  time.run();await live.flush();assert.deepEqual(calls,['new']);
  const gate=deferred(),published=[],active=createPanelEditorLive({...time,apply:async (value,{isCurrent})=>{await gate.promise;if(isCurrent())published.push(value);}});
  active.schedule(request('active'));time.run();active.schedule(request('queued'));const done=active.flush();active.cancel();gate.resolve();const outcomes=await done;
  assert.deepEqual(published,[]);assert.equal(outcomes.length,1);assert.equal(outcomes[0].status,'stale');assert.equal(active.pending,false);assert.equal(active.active,false);
});

test('failures are reported without poisoning later previews and stale failures never replace the current message',async()=>{
  const time=clock(),errors=[],gate=deferred(),failure=new Error('capacity'),live=createPanelEditorLive({...time,apply:async value=>{if(value.values.value==='late')await gate.promise;if(value.values.value!=='good')throw failure;return 'ok';},onError:(error,value)=>errors.push([error,value.values.value])});
  live.schedule(request('bad'));const bad=await live.flush();assert.equal(bad[0].status,'rejected');assert.equal(bad[0].reason,failure);assert.deepEqual(errors,[[failure,'bad']]);
  live.schedule(request('late'));time.run();live.schedule(request('good'));const done=live.flush();gate.resolve();const results=await done;
  assert.deepEqual(results.map(result=>result.status),['stale','fulfilled']);assert.equal(errors.length,1);assert.equal(live.pending,false);assert.equal(live.active,false);
});

test('concurrent flush callers share serial work and a failed notification cannot strand the queue',async()=>{
  const time=clock(),gate=deferred(),notification=new Error('notification'),calls=[],live=createPanelEditorLive({...time,apply:async value=>{calls.push(value.group);if(value.group==='text'){await gate.promise;throw Error('capacity');}return 'preview';},onError:()=>{throw notification;}});
  live.schedule(request('bad'));live.schedule(request('300','rectangle'));const first=live.flush(),second=live.flush();gate.resolve();
  const [a,b]=await Promise.all([first,second]);assert.deepEqual(calls,['text','rectangle']);assert.deepEqual(a.map(value=>value.status),['rejected','fulfilled']);assert.deepEqual(b.map(value=>value.status),['rejected','fulfilled']);assert.equal(a[0].notificationError,notification);assert.equal(live.active,false);assert.equal(live.pending,false);
});

test('invalid options or uncloneable input fail before disturbing the last scheduled valid preview',async()=>{
  for(const options of [{},{apply:3},{apply:()=>{},delay:-1},{apply:()=>{},delay:NaN},{apply:()=>{},setTimer:null},{apply:()=>{},onError:3}])assert.throws(()=>createPanelEditorLive(options),TypeError);
  const time=clock(),calls=[],live=createPanelEditorLive({...time,delay:0,apply:async value=>calls.push(value.values.value)});live.schedule(request('safe'));
  for(const value of [null,[],{variantKey:'wide',nodeId:'title'},{...request('bad'),group:''},{...request('bad'),callback:()=>{}}])assert.throws(()=>live.schedule(value));
  assert.equal(live.pending,true);await live.flush();assert.deepEqual(calls,['safe']);
});
