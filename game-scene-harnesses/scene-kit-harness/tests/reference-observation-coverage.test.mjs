import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,hash,unseal} from '../src/generation/common.mjs';
import {createLayerSourceScopes} from '../src/generation/layer-source.mjs';
import {checkReferenceObservationCoverage,assertReferenceObservationCoverage} from '../src/generation/reference-observation-coverage.mjs';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const requirements=seal({subjects:[
  {subjectId:'foreground.rock',role:'foreground',layerId:'foreground',content:'深色岩石主体与少量灌木'},
  {subjectId:'foreground.pipe',role:'foreground',layerId:'foreground',content:'独立近景管道和阀门'},
  {subjectId:'background.mountain',role:'backdrop',layerId:'rear',content:'远景山峰'}
]});
const sourceScopes=createLayerSourceScopes(requirements);
const observations=[{observationId:'rock',description:'画面两侧深色岩石主体',layerId:'foreground',parentRole:'foreground'},
  {observationId:'pipe',description:'左侧近景管道和阀门',layerId:'foreground',parentRole:'foreground'}];
const assignments=[{observationId:'rock',subjectId:'foreground.rock',scopeQuote:'深色岩石主体'},
  {observationId:'pipe',subjectId:'foreground.pipe',scopeQuote:'近景管道和阀门'}];
const base={referenceBytes:Buffer.from('synthetic reference bytes'),requirements,sourceScopes,requiredObservationIds:['rock','pipe'],observations,assignments};
const codes=r=>r.findings.map(f=>f.code);

test('explicit observations and source ownership are matched without claiming art acceptance',()=>{
  const r=checkReferenceObservationCoverage(base);
  assert.equal(r.status,'pass');assert.equal(r.referenceRawSha256,hash(base.referenceBytes));
  assert.equal(r.sourceScopesSha256,sourceScopes.sha256);assert.equal(r.automaticImageUnderstanding,false);
  assert.equal(r.semanticCorrectness,'not-assessed');assert.equal(r.artAcceptance,'not-assessed');assert.equal(r.generationCalls,0);
  assert.equal(assertReferenceObservationCoverage(base,r).sha256,r.sha256);
  assert.throws(()=>assertReferenceObservationCoverage({...base,referenceBytes:Buffer.from('another reference')},r));
});
test('missing subject and a pipe scope pretending to own the rock are caught',()=>{
  const missing=checkReferenceObservationCoverage({...base,assignments:[{...assignments[0],subjectId:'missing.rock'},assignments[1]]});
  assert(codes(missing).includes('ASSIGNMENT_SUBJECT_MISSING'));assert(codes(missing).includes('OBSERVATION_UNCOVERED'));
  const wrong=checkReferenceObservationCoverage({...base,assignments:[{...assignments[0],subjectId:'foreground.pipe'},assignments[1]]});
  assert(codes(wrong).includes('ASSIGNMENT_QUOTE_MISSING'));assert.equal(wrong.status,'fail');
});
test('wrong layer and a declared but omitted observation are caught',()=>{
  const wrong=checkReferenceObservationCoverage({...base,observations:[{...observations[0],layerId:'rear',parentRole:'far'},observations[1]]});
  assert(codes(wrong).includes('ASSIGNMENT_LAYER_MISMATCH'));
  const omitted=checkReferenceObservationCoverage({...base,requiredObservationIds:['rock','pipe','sky'],assignments:[...assignments,{observationId:'sky',subjectId:'background.mountain',scopeQuote:'远景山峰'}]});
  assert(codes(omitted).includes('REQUIRED_OBSERVATION_MISSING'));assert(codes(omitted).includes('ASSIGNMENT_OBSERVATION_MISSING'));
});
test('observed but unmapped source and duplicate data cannot silently pass',()=>{
  const unmapped=checkReferenceObservationCoverage({...base,assignments:[assignments[1]]});
  assert.deepEqual(unmapped.findings,[{code:'OBSERVATION_UNCOVERED',observationId:'rock',subjectId:null}]);
  assert.throws(()=>assertReferenceObservationCoverage({...base,assignments:[assignments[1]]},unmapped));
  assert.throws(()=>checkReferenceObservationCoverage({...base,requiredObservationIds:['rock','rock']}));
  assert.throws(()=>checkReferenceObservationCoverage({...base,assignments:[assignments[0],assignments[0]]}));
});
test('CLI returns actionable nonzero status for uncovered observations and does not compute',()=>{
  const dir=mkdtempSync(join(tmpdir(),'scene-observation-')),input=join(dir,'input.json'),reference=join(dir,'reference.bin');
  try {
    const {referenceBytes,...data}=base;writeFileSync(reference,referenceBytes);
    writeFileSync(input,JSON.stringify({...data,assignments:[assignments[1]]}));
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/reference-observation-coverage.mjs',import.meta.url)),'--input',input,'--reference',reference],{encoding:'utf8'});
    assert.equal(result.status,2);const report=JSON.parse(result.stdout);assert.equal(report.status,'fail');assert.equal(report.generationCalls,0);
    assert(!result.stdout.includes(dir));
  } finally {unlinkSync(input);unlinkSync(reference);rmdirSync(dir);}
});
test('new-brief preflight produces the exact scopes used for source planning and stops when uncovered',()=>{
  const dir=mkdtempSync(join(tmpdir(),'scene-brief-coverage-')),brief=join(dir,'brief.json'),obs=join(dir,'observations.json'),reference=join(dir,'reference.bin');
  try {
    writeFileSync(brief,JSON.stringify({requirements:unseal(requirements),sourceScopes:[]}));writeFileSync(reference,base.referenceBytes);
    const input={requiredObservationIds:base.requiredObservationIds,observations,assignments};writeFileSync(obs,JSON.stringify(input));
    const run=()=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/reference-observation-from-brief.mjs',import.meta.url)),
      '--brief',brief,'--observations',obs,'--reference',reference],{encoding:'utf8'});
    const ok=run();assert.equal(ok.status,0);const output=JSON.parse(ok.stdout);
    assert.equal(output.requirements.sha256,requirements.sha256);assert.equal(output.sourceScopes.sha256,sourceScopes.sha256);
    assert.equal(output.report.status,'pass');assert.equal(output.report.sourceScopesSha256,output.sourceScopes.sha256);
    writeFileSync(obs,JSON.stringify({...input,assignments:[assignments[1]]}));const failed=run();
    assert.equal(failed.status,2);assert.equal(JSON.parse(failed.stdout).report.status,'fail');
  } finally {unlinkSync(brief);unlinkSync(obs);unlinkSync(reference);rmdirSync(dir);}
});
test('source-review preflight consumes the exact sealed scope and reference files',()=>{
  const dir=mkdtempSync(join(tmpdir(),'scene-review-coverage-')),req=join(dir,'requirements.json'),scope=join(dir,'source-scopes.json'),obs=join(dir,'observations.json'),reference=join(dir,'reference.bin');
  try {
    writeFileSync(req,JSON.stringify(requirements));writeFileSync(scope,JSON.stringify(sourceScopes));writeFileSync(reference,base.referenceBytes);
    writeFileSync(obs,JSON.stringify({requiredObservationIds:base.requiredObservationIds,observations,assignments}));
    const run=()=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/reference-observation-coverage.mjs',import.meta.url)),
      '--requirements',req,'--scopes',scope,'--observations',obs,'--reference',reference],{encoding:'utf8'});
    const ok=run();assert.equal(ok.status,0);assert.equal(JSON.parse(ok.stdout).sourceScopesSha256,sourceScopes.sha256);
    writeFileSync(obs,JSON.stringify({requiredObservationIds:base.requiredObservationIds,observations,assignments:[assignments[1]]}));
    const fail=run();assert.equal(fail.status,2);assert.equal(JSON.parse(fail.stdout).status,'fail');
  } finally {for(const path of [req,scope,obs,reference])unlinkSync(path);rmdirSync(dir);}
});
