import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {studioSnapshot} from '../src/studio/catalog.mjs';
import {hash} from '../src/skins/package.mjs';
test('Studio validates snapshot and binds checks to exact preview',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-test-'));
 try{
  await mkdir(join(root,'work/panel'),{recursive:true});await mkdir(join(root,'src/studio'),{recursive:true});
  for(const name of ['index.html','studio.mjs','project.mjs','project-ui.mjs','tasks-ui.mjs','generation-ui.mjs','history-ui.mjs','pipeline-ui.mjs','panel-completion.mjs','confirm-ui.mjs','progress.mjs','progress-ui.mjs','studio.css','component-canvas.html','component-canvas.mjs','canvas-contrast.mjs','canvas-resolution.mjs','panel-size.html','panel-size.css','panel-copy.html','panel-copy.css'])await writeFile(join(root,'src/studio',name),'fixture');
  const preview=Buffer.from('<h1>Fixture</h1>'),dir=join(root,'work/panel');
  await writeFile(join(dir,'preview.html'),preview);
  await writeFile(join(dir,'report.json'),JSON.stringify({kind:'settings-panel-preview',files:[{file:'preview.html',sha256:hash(preview)}]}));
  const project={version:'0.1',name:'Fixture',artifacts:[{id:'panel',name:'Panel',type:'panel',directory:'work/panel'}]};
  const snapshot=await studioSnapshot(root,project);assert.equal(snapshot.items[0].checks,null);assert.equal(snapshot.files.has('artifacts/panel/preview.html'),true);assert.equal(snapshot.files.has('artifacts/panel/report.json'),true);for(const name of ['panel-copy.html','panel-copy.css','panel-copy.mjs'])assert.equal(snapshot.files.has(name),true);
  const cleared=await studioSnapshot(root,{version:'0.1',name:'Empty Studio',artifacts:[]});
  assert.deepEqual(cleared.items,[]);assert.deepEqual(JSON.parse(cleared.files.get('catalog.json')).items,[]);
  assert(cleared.files.has('index.html'));assert(cleared.files.has('studio.mjs'));
  // Modules served without bundling must include their relative dependency
  // closure, otherwise the entire pipeline UI fails to load in the browser.
  const pending=['runtime/inventory-policy.mjs'],visited=new Set();
  while(pending.length){const file=pending.pop();if(visited.has(file))continue;visited.add(file);assert(cleared.files.has(file),'Missing browser module '+file);
   for(const match of cleared.files.get(file).toString('utf8').matchAll(/(?:from\s*|import\s*)['"](\.\.?\/[^'"]+\.mjs)['"]/g))pending.push(new URL(match[1],'http://snapshot.local/'+file).pathname.slice(1));
  }
  await writeFile(join(dir,'checks.json'),JSON.stringify({previewSha256:'bad',status:'passed',checks:[]}));
  await assert.rejects(()=>studioSnapshot(root,project),/STUDIO_CHECK_CHANGED/);
  await rm(join(dir,'checks.json'));
  await writeFile(join(dir,'preview.html'),'changed');await assert.rejects(()=>studioSnapshot(root,project),/STUDIO_FILE_CHANGED/);
  await assert.rejects(()=>studioSnapshot(root,{...project,artifacts:[{...project.artifacts[0],directory:'work/../../private'}]}),/STUDIO_ENTRY_INVALID/);
 }finally{await rm(root,{recursive:true,force:true});}
});
