import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCandidate,validateCandidateConfig} from '../src/skins/candidate-pipeline.mjs';
const skin={id:'test',label:'测试',input:'work/test/input.json',baseline:'work/test/assembly.json',allowDifferentSourceTrial:false};
test('profile mode needs no previous assembly and routes through common metadata generator',async()=>{
  const s={id:'new',label:'新皮肤',input:'work/new/input.json',profile:'work/new/profile.json'},calls=[];
  validateCandidateConfig({version:'1.0',port:4198,skins:[s]});
  await buildCandidate(s,async(stage,script,args)=>{calls.push({stage,script,args});return stage==='locate'?{status:'needs-review',directory:'work/location'}:stage==='trial'?{status:'experimental-candidate',directory:'work/meta',assembly:'work/meta/assembly.json'}:stage==='content-insets'?{directory:'work/meta/assembly-content-insets.json'}:{status:'checked-candidate',directory:'work/post',consumerDirectory:'work/consumer'};});
  assert.equal(calls[1].script,'skin-metadata-draft.mjs');assert.ok(calls[1].args.includes('--profile'));assert.ok(!calls[1].args.includes('--baseline'));
  assert.throws(()=>validateCandidateConfig({version:'1.0',port:4198,skins:[{...s,baseline:'work/old.json'}]}));
});
test('pipeline forwards generated paths and only explicit different-source trial flag',async()=>{
  const calls=[];
  const execute=async(stage,script,args)=>{calls.push({stage,script,args});return stage==='locate'?{directory:'work/location/id',status:'needs-review'}:stage==='trial'?{directory:'work/trial/id',assembly:'work/trial/id/assembly.json',status:'experimental-candidate'}:stage==='content-insets'?{directory:'work/trial/id/assembly-content-insets.json'}:{directory:'work/post/id',consumerDirectory:'work/consumer/id',status:'checked-candidate'};};
  const r=await buildCandidate(skin,execute);assert.equal(r.status,'awaiting-visual-review');
  assert.ok(calls[1].args.includes('work/location/id/report.json'));assert.ok(!calls[1].args.includes('--allow-different-source-trial'));assert.ok(calls[2].args.includes('work/trial/id/assembly.json'));
  assert.equal(calls[2].stage,'content-insets');assert.ok(calls[3].args.includes('work/trial/id/assembly-content-insets.json'));
  calls.length=0;await buildCandidate({...skin,allowDifferentSourceTrial:true},execute);assert.ok(calls[1].args.includes('--allow-different-source-trial'));
});
test('failed or unresolved stage stops without retry or downstream execution',async()=>{
  const stages=[];await assert.rejects(buildCandidate(skin,async stage=>{stages.push(stage);if(stage==='locate')return{directory:'work/location',status:'needs-review'};throw Error('trial.unresolved');}),/unresolved/);
  assert.deepEqual(stages,['locate','trial']);
  await assert.rejects(buildCandidate(skin,async()=>({status:'failed'})),/locate-result/);
});
test('config rejects duplicate identities, path traversal and implicit trial opt-in',()=>{
  const c={version:'1.0',port:4196,skins:[skin]};assert.equal(validateCandidateConfig(c),c);
  assert.throws(()=>validateCandidateConfig({...c,skins:[skin,skin]}));
  assert.throws(()=>validateCandidateConfig({...c,skins:[{...skin,input:'work/../outside'}]}));
  assert.throws(()=>validateCandidateConfig({...c,skins:[{...skin,allowDifferentSourceTrial:undefined}]}));
});
