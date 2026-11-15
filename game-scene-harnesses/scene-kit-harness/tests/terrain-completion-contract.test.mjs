import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as flow from '../src/generation/index.mjs';
import {coherentBrief,setupCoherent} from './helpers/coherent.mjs';
import {COMPLETE_TERRAIN_ROLES,TERRAIN_COMPLETION_POLICY} from '../src/terrain-perimeter-contract.mjs';
import {jsonBytes,seal,unseal} from '../src/generation/common.mjs';

const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(v=>v.code===code));
const study={profile:'reference-terrain-intent-v2',contour:'authored',notes:'Only a limited material study is requested.',usage:'material-study'};
const scope=i=>({subjectId:'ground',content:'Continuous surface/body material.',exclusions:['Complete platforms'],parentRole:'main',terrainIntent:i});
test('CLI default refuses v1 and accepts explicit v2 usage before any compute',t=>{
  const parent=mkdtempSync(join(tmpdir(),'terrain-completion-cli-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const path=join(parent,'brief.json'),brief=coherentBrief(),cwd=fileURLToPath(new URL('..',import.meta.url));
  brief.sourceScopes=[scope({profile:'reference-terrain-intent-v1',contour:'authored',notes:'Historical contour only.'})];writeFileSync(path,jsonBytes(brief));
  const run=out=>spawnSync(process.execPath,['scripts/coherent.mjs','init','--brief',path,'--out',out],{cwd,encoding:'utf8'});
  const rejected=run(join(parent,'old'));assert.equal(rejected.status,1);assert.equal(JSON.parse(rejected.stderr).code,'TERRAIN_COMPLETION_REQUIRED');assert(!existsSync(join(parent,'old')));
  brief.sourceScopes=[scope(study)];writeFileSync(path,jsonBytes(brief));const accepted=run(join(parent,'new'));
  assert.equal(accepted.status,0,accepted.stderr);const status=JSON.parse(accepted.stdout);assert.equal(status.terrainIntentPolicy,TERRAIN_COMPLETION_POLICY);assert.equal(status.terrainCompletion.usage,'material-study');
  assert.equal(status.stage,'awaiting-design-review');
});

test('a frozen complete brush cannot revise away its responsibilities or downgrade to a limited study',t=>{
  const f=setupCoherent(t),i={...study,usage:'complete-brush',notes:'Complete arbitrary painting requested.',perimeter:{surfaceFamily:'natural',items:COMPLETE_TERRAIN_ROLES.map(role=>({role,content:'Bare mineral '+role+'.',exclusions:['Vegetation'],sourceAppearance:{format:'ai_scene_source_appearance_v1',profile:'source-owned-appearance-v1',rules:['Bare sandstone matching the reference.']}}))}};
  const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements,[scope(i)])}),p=batch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(plan=>plan.instanceBinding.role==='material');
  assert.match(p.compiler,/-reference-terrain-intent-v2$/);
  const {terrainIntent:removed,...base}=unseal(p.recipe.sourceScope);
  for(const [index,changed] of [base,{...base,terrainIntent:study},{...base,terrainIntent:{profile:'reference-terrain-intent-v1',contour:'authored',notes:'Downgrade'}}].entries()){
    const before=flow.inspectWorkflow(f.workflow);
    rejects(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'downgrade.'+index,replacements:[{assetId:p.recipe.assetId,planId:'material.revision.'+index,intent:'isolated-layer-v4',sourceScope:seal(changed)}]}),'TERRAIN_COMPLETION_REVISION_REQUIRED');
    assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  }
});
