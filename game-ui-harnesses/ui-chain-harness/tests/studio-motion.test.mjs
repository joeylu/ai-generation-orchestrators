import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pipelineController} from '../src/studio/pipeline.mjs';
import {motionChoices,motionSelection} from '../src/panel/motion-profile.mjs';
import {getMotionStyle} from '../../ui-component-harness/src/motion-system.ts';
import {motionDesign,MOTION_DESIGN_VERSION} from '../src/panel/motion-design.mjs';
import {hash} from '../src/skins/package.mjs';

test('stable style IDs resolve versioned distinct recipes over upstream base tokens',()=>{
 assert.deepEqual(motionChoices.map(x=>x.id),['original','playful','premium','corporate']);
 assert.equal(motionSelection('original').profile,null);
 for(const style of ['playful','premium','corporate']){assert.deepEqual(motionSelection(style).profile,{...getMotionStyle(style),...motionDesign(style)});assert.equal(motionSelection(style).designVersion,MOTION_DESIGN_VERSION);}
 assert.deepEqual(['playful','premium','corporate'].map(s=>motionSelection(s).profile.recipe.kind),['pop','layered','slide']);
 const changed=motionSelection('playful');changed.profile.recipe.kind='changed';assert.equal(motionSelection('playful').profile.recipe.kind,'pop');
 assert.throws(()=>motionSelection('unknown'),/STYLE_INVALID/);
 assert.equal(motionSelection('playful','components').kind,'ui_chain_component_motion');
 assert.throws(()=>motionSelection('playful','unknown'),/SCOPE_INVALID/);
});
test('component project motion saves by verified skin and leaves panel selections independent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'component-motion-')),dir='work/studio/projects/fixture';
 try{
  await mkdir(join(root,dir),{recursive:true});
  const original={version:'1.0',panels:[{id:'panel',status:'ready',motion:motionSelection('premium')}],taskDirectory:'work/task'};
  await writeFile(join(root,dir,'flow.json'),JSON.stringify(original));
  let verified=0;
  const make=(failure=false)=>pipelineController(root,{resolve:()=>({directory:dir+'/batches/digest'})},{files:new Map(),items:[]},{resolveComponentSkin:async flow=>{assert.equal(flow.taskDirectory,'work/task');verified++;if(failure)throw Error('SKIN_NOT_CHECKED');return {manifestSha256:'verified-skin'};}});
  const input={id:'project',expectedSkinSha256:'verified-skin',style:'playful'};
  await assert.rejects(make().action('component-motion',{...input,expectedSkinSha256:'stale'}),/COMPONENT_SKIN_CHANGED/);
  assert.deepEqual(JSON.parse(await readFile(join(root,dir,'flow.json'))),original);
  for(const style of motionChoices.map(c=>c.id)){
   const result=await make().action('component-motion',{...input,style}),flow=JSON.parse(await readFile(join(root,dir,'flow.json')));
   assert.deepEqual(flow.panels,original.panels);assert.deepEqual(flow.componentMotion,{...motionSelection(style,'components'),skinSha256:'verified-skin'});assert.deepEqual(result.motion,flow.componentMotion);
  }
  const before=await readFile(join(root,dir,'flow.json'),'utf8');
  await assert.rejects(make(true).action('component-motion',input),/SKIN_NOT_CHECKED/);
  await assert.rejects(make().action('component-motion',{...input,style:'arbitrary'}),/STYLE_INVALID/);
  assert.equal(await readFile(join(root,dir,'flow.json'),'utf8'),before);assert.equal(verified,6);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('saving panel motion is durable, source-bound and never rewrites the original delivery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-motion-')),dir='work/studio/projects/fixture';
 try{
  await mkdir(join(root,dir),{recursive:true});await mkdir(join(root,'work/panel'),{recursive:true});await mkdir(join(root,'src/studio'),{recursive:true});
  for(const name of ['index.html','studio.mjs','project.mjs','project-ui.mjs','tasks-ui.mjs','generation-ui.mjs','history-ui.mjs','pipeline-ui.mjs','panel-completion.mjs','confirm-ui.mjs','progress.mjs','progress-ui.mjs','studio.css','component-canvas.html','component-canvas.mjs','material-canvas.mjs','canvas-contrast.mjs','canvas-resolution.mjs','panel-size.html','panel-size.css','panel-copy.html','panel-copy.css'])await writeFile(join(root,'src/studio',name),'fixture');
  const bytes=Buffer.from('immutable preview'),report={kind:'action-panel-preview',files:[{file:'preview.html',sha256:hash(bytes)}]};
  await writeFile(join(root,'work/panel/preview.html'),bytes);await writeFile(join(root,'work/panel/report.json'),JSON.stringify(report));
  const job={id:'panel',status:'ready',sha256:'digest',artifact:{id:'panel',name:'Fixture',type:'panel',directory:'work/panel'}},flow={version:'1.0',panels:[job]};
  await writeFile(join(root,dir,'flow.json'),JSON.stringify(flow));
  const controller=()=>pipelineController(root,{resolve:()=>({directory:dir+'/batches/digest'})},{files:new Map([['catalog.json',Buffer.from('{"items":[]}')]]),items:[]});
  const input={id:'project',panelId:'panel',expectedSha256:'digest',style:'playful'};
  await assert.rejects(controller().action('panel-motion',{...input,style:'invalid'}),/STYLE_INVALID/);
  await assert.rejects(controller().action('panel-motion',{...input,expectedSha256:'stale'}),/PANEL_CHANGED/);
  for(const style of motionChoices.map(c=>c.id)){
   assert.deepEqual((await controller().action('panel-motion',{...input,style})).motion,motionSelection(style));
   const saved=JSON.parse(await readFile(join(root,dir,'flow.json')));assert.deepEqual(saved.panels[0],{...job,motion:motionSelection(style)});
  }
  assert.deepEqual(await readFile(join(root,'work/panel/preview.html')),bytes);
  assert.deepEqual(JSON.parse(await readFile(join(root,'work/panel/report.json'))),report);
  for(const change of [{deletedAt:'today'},{status:'running'},{status:'needs-input'}]){
   await writeFile(join(root,dir,'flow.json'),JSON.stringify({...flow,panels:[{...job,...change}]}));await assert.rejects(controller().action('panel-motion',input),/PANEL_NOT_READY/);
  }
  await writeFile(join(root,dir,'flow.json'),JSON.stringify(flow));await writeFile(join(root,'work/panel/preview.html'),'corrupt');
  await assert.rejects(controller().action('panel-motion',input),/STUDIO_FILE_CHANGED/);
  assert.deepEqual(JSON.parse(await readFile(join(root,dir,'flow.json'))),flow);
 }finally{await rm(root,{recursive:true,force:true});}
});
