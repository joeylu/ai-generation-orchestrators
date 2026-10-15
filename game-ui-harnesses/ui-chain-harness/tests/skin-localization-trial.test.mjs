import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trialPart} from '../src/skins/localization-trial.mjs';

test('horizontal crop trials preserve source end cuts on the x axis',()=>{
  const b={sha256:'same',crop:[20,10,100,30],metadata:{density:4},fit:{method:'horizontal-slice',caps:[15,15]}};
  const r=trialPart(b,{file:'source.png',sha256:'same'},[17,8,108,35],'horizontal');
  assert.deepEqual(r.part.fit,{method:'horizontal-slice',caps:[18,20]});
  assert.throws(()=>trialPart(b,{sha256:'same'},[40,10,40,30],'horizontal'),/invalid-source-caps/);
  assert.throws(()=>trialPart(b,{sha256:'same'},[17,8,108,35],'vertical'),/unsupported-fit/);
});
test('same source preserves absolute vertical cuts when candidate expands the crop',()=>{
  const b={sha256:'same',crop:[10,20,30,100],metadata:{density:3},fit:{method:'vertical-slice',caps:[15,15]}};
  const r=trialPart(b,{file:'source.png',sha256:'same'},[8,17,35,108],'vertical');
  assert.deepEqual(r.part.fit.caps,[18,20]);assert.deepEqual(b.fit.caps,[15,15]);
  assert.throws(()=>trialPart(b,{sha256:'same'},[10,40,30,40],'vertical'),/invalid-source-caps/);
});
test('different source is refused unless explicit experimental mode is supplied',()=>{
  const b={sha256:'old',metadata:{density:4}};
  assert.throws(()=>trialPart(b,{sha256:'new'},[0,0,20,100],'vertical'),/explicit-trial/);
  const r=trialPart(b,{sha256:'new'},[0,0,20,100],'vertical',true);
  assert.deepEqual(r.part.fit.caps,[10,10]);assert.equal(r.evidence.capBasis,'experimental-half-source-width');
  assert.equal(r.evidence.visualAcceptance,'unreviewed');
});
