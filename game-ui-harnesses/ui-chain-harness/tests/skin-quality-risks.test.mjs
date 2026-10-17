import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evaluateRisks,fixtureFor} from './helpers/skin-quality-risks.mjs';
import {decodePng} from '../src/skins/png.mjs';
const corpus=JSON.parse(await readFile(new URL('./fixtures/skin-quality-risks.json',import.meta.url),'utf8'));
test('risk corpus has independent wrong-neighbor and decoration ground truth',()=>{
  const image=decodePng(fixtureFor(corpus.cases[0]).png);
  const pixel=(x,y)=>[...image.pixels.subarray((y*image.width+x)*4,(y*image.width+x)*4+4)];
  assert.notDeepEqual(pixel(32,32),pixel(96,32));
  assert.equal(pixel(160,32)[3],0);
  assert.deepEqual(pixel(2,2),pixel(11,11));
  assert.notDeepEqual(pixel(11,11),pixel(12,12));
});
test('risk evaluator separates hard blocks, advisory warnings, misses and controls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'skin-risks-'));
  try{
    const report=await evaluateRisks(dir,corpus);
    assert.equal(report.cases.length,corpus.cases.length);
    const byId=Object.fromEntries(report.cases.map(c=>[c.id,c]));
    for(const id of ['missing-part','source-mismatch','crop-outside','slice-overflow','caps-overflow'])assert.equal(byId[id].signal,'blocked',id);
    assert.equal(byId['rail-letterbox'].signal,'warning');
    assert.equal(byId['crop-empty'].signal,'blocked');
    assert.equal(byId['crop-empty'].code,'skin.empty-asset');
    assert.equal(byId['cuts-through-decoration'].signal,'warning');
    assert.equal(byId['caps-too-shallow'].signal,'warning');
    assert.equal(report.counts.controlSignals,0);
    assert.equal(report.counts.defects,report.counts.blocked+report.counts.warningOnly+report.counts.silentMisses);
    assert.equal(report.productionReady,false);
    // Do not enshrine current visual misses as desired behavior: the report records them.
    for(const c of report.cases)assert.ok(['silent','warning','blocked'].includes(c.signal));
  }finally{await rm(dir,{recursive:true,force:true});}
});
