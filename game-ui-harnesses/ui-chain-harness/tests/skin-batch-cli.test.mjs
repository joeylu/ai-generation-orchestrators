import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults} from '../src/contracts/build.mjs';
import {buildTemplates} from '../src/templates/build.mjs';
import {encodePng} from '../src/skins/png.mjs';
import {json} from '../src/skins/package.mjs';
import {prepareSkinBatch,verifySkinBatch} from '../scripts/skin-batch.mjs';

test('offline batch preparation keeps four-sheet compatibility and binds the optional material plan',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ui-batch-cli-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const contracts={};for(const key of ['template','registry','usage']){contracts[key]=join(directory,key+'.json');await writeFile(contracts[key],await readFile(defaults[key]));}
 const templateOutput=join(directory,'templates');
 await buildTemplates({config:contracts.template,output:templateOutput,render:async({spec,directory:out})=>{
  const width=spec.coordinates.width*spec.coordinates.outputScale,height=spec.coordinates.height*spec.coordinates.outputScale;
  const png=encodePng({width,height,pixels:Buffer.alloc(width*height*4)}),files=[];
  for(const sheet of spec.sheets)for(const role of ['clean','review']){const file=sheet.filePrefix+'.'+role+'.png';await writeFile(join(out,file),png);files.push({file});}
  return {renderer:'offline-test-double',files};
 }});
 const reference=join(directory,'reference.png'),style=join(directory,'style.json');
 await writeFile(reference,encodePng({width:8,height:8,pixels:Buffer.alloc(8*8*4,255)}));
 await writeFile(style,json({kind:'ui_skin_style_draft',version:'0.1',id:'test-materials',revision:1,status:'draft',name:'Offline material style',referenceSummary:'Synthetic reference',palette:{basis:'visual-estimate-not-colorimetric-sampling',colors:{base:'#888888'}},observedRules:['Muted material.'],extensionRules:['Extend consistently.'],partRules:[{match:{assetPrefix:'slider.'},appearance:'Round thumb.'}]}));
 const args={reference,style,contracts,templateOutput};
 const old=await prepareSkinBatch({...args,output:join(directory,'old')});
 assert.equal(old.sheets,4);assert.equal(old.assets,30);assert.equal(old.computeAuthorized,false);
 assert.equal((await verifySkinBatch({...old,contracts})).sheets,4);
 const current=await prepareSkinBatch({...args,output:join(directory,'new'),materials:true});
 assert.equal(current.sheets,5);assert.equal(current.assets,33);assert.equal(current.computeAuthorized,false);
 const batch=JSON.parse(await readFile(join(current.directory,'batch.json')));
 assert.equal(batch.plans.at(-1).sheetId,'S05');assert.equal(batch.plans.at(-1).assets,3);
 assert.deepEqual(batch.policy,{callsPerPlan:1,automaticRetry:false,review:'whole-batch',productionReady:false});
 assert.match(await readFile(join(current.directory,'review.md'),'utf8'),/30 个基础部件 \+ 3 个材质/);
 const materialPlan=join(current.directory,'../../plans',batch.plans.at(-1).sha256);
 await writeFile(join(materialPlan,'inputs/material-template.json'),'{}');
 await assert.rejects(()=>verifySkinBatch({...current,contracts}),/frozen plan resource changed/);
});
