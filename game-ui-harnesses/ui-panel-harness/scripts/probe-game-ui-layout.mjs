/** Synthetic geometry/localization stress based on eight saved outputs; not a skill/model evaluation. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestJson,digestBytes} from '../src/canonical.mjs';
import {validateCodexReceipt} from '../src/codex-planner.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--run'&&args[2]==='--output');
const run=resolve(args[1]),original=await readJson(join(run,'input-adaptability-report.json'));
assert.equal(original.cohort,'reference-eight-v1');assert.equal(original.pass,8);
const output=await createOutputDirectory(args[3]),core=await loadWorkspaceCore(),results=[];
const sizes=[{name:'reference',width:960,height:800},{name:'phone-portrait',width:390,height:844},
  {name:'phone-landscape',width:844,height:390},{name:'wide',width:1280,height:720}];
for(const item of original.results){
  const names=(await readdir(join(run,item.id))).filter(n=>n.startsWith('codex-'));assert.equal(names.length,1);
  const attempt=join(run,item.id,names[0]),context=await readJson(join(attempt,'planning-context.json')),
    proposal=await readJson(join(attempt,'proposal.json')),receipt=await readJson(join(attempt,'codex-receipt.json')),
    native=await readJson(join(attempt,'panel-intent.json'));
  validateCodexReceipt(receipt,{contextSha256:context.sha256,proposalSha256:await digestJson(proposal)});assert.deepEqual(receipt,item.receipt);
  for(const size of sizes)for(const variant of ['original-copy','long-copy']){
    const intent=structuredClone(native);
    // Synthetic test inputs deliberately change layout/copy, not the saved evidence.
    intent.panel.layout={...intent.panel.layout,width:null,canvasWidth:size.width,canvasHeight:size.height,maxHeight:Math.max(160,size.height-120)};
    if(variant==='long-copy'){
      intent.panel.title+=' · Options et informations complémentaires';
      const visit=node=>{for(const row of node.rows??[]){if(row.kind==='button')row.label+=' — Continuer sans quitter cette session';
        if(row.kind==='text')row.text+=' · Informations complémentaires pour le joueur';}
        for(const child of node.children??[])visit(child);for(const page of node.pages??[])visit(page.body);};
      visit(intent.panel.body);
    }
    const entry={id:item.id,size,variant,status:'UNKNOWN'};
    try{
      const lowered=await materializePanelIntent(context,intent);assert(lowered.spec,'PROBE_UNEXPECTED_CLARIFICATION');
      const bundle=await createPanelBundle(lowered.spec,context.catalog,core);
      entry.status='COMPILED';entry.panelWidth=bundle.spec.layout.width;entry.compilerVersion=bundle.compilerVersion;
    }catch(error){entry.status='REJECTED';entry.code=error.code??'PROBE_FAILED';entry.path=error.path??null;
      await writeNewJson(output,`${item.id}-${size.name}-${variant}.input.json`,{kind:'SYNTHETIC_GEOMETRY_COPY_STRESS',contextSha256:context.sha256,intent});}
    results.push(entry);
  }
}
const summary={kind:'DETERMINISTIC_GEOMETRY_STRESS_NOT_SKILL_OR_MODEL_COMPARISON',realModelCalls:0,
  sourceReportSha256:await digestBytes(await readFile(join(run,'input-adaptability-report.json'))),cases:results.length,
  compiled:results.filter(x=>x.status==='COMPILED').length,rejected:results.filter(x=>x.status==='REJECTED').length,
  scope:'Logical canvas reflow plus synthetic long copy. Not viewport scaling, screenshot review or browser/gamepad acceptance.',results};
await writeNewJson(output,'probe-report.json',summary);
console.log(JSON.stringify({cases:summary.cases,compiled:summary.compiled,rejected:summary.rejected,realModelCalls:0,
  bySize:sizes.map(size=>({size:size.name,compiled:results.filter(x=>x.size.name===size.name&&x.status==='COMPILED').length,rejected:results.filter(x=>x.size.name===size.name&&x.status==='REJECTED').length}))}));
