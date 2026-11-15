import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
test('paint CLI help is offline and exposes no provider-submission command',()=>{
  const p=spawnSync(process.execPath,['scripts/paint-source.mjs','--help'],{cwd:root,encoding:'utf8'});
  assert.equal(p.status,0);assert.match(p.stdout,/No command submits provider jobs/);assert.equal(p.stderr,'');
  assert.match(p.stdout,/material-plan/);assert.match(p.stdout,/review-coverage/);
});
test('implicit yes and unsupported run cannot create or operate a workflow',()=>{
  const missing='tests/fixtures/paint-cli-no-workflow';assert(!existsSync(new URL('fixtures/paint-cli-no-workflow',import.meta.url)));
  for(const args of [['plan','--workflow',missing,'--options','missing.json','--out','unused','--yes','true'],['run','--workflow',missing]]){
    const p=spawnSync(process.execPath,['scripts/paint-source.mjs',...args],{cwd:root,encoding:'utf8'});
    assert.equal(p.status,1);assert.equal(JSON.parse(p.stderr).code,'PAINT_CLI_ARGUMENTS');
  }
  assert(!existsSync(new URL('fixtures/paint-cli-no-workflow',import.meta.url)));
});
