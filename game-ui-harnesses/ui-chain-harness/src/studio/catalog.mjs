import {studioMotionAssets} from './motion-assets.mjs';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readSafe,hash} from '../skins/package.mjs';
import {inspectConsumer} from '../runtime/consumer-tools.mjs';
let sizeEditorBundle,copyPreviewBundle;

// Only explicit work-relative directories are read. HTTP receives a frozen allowlist.
export async function studioSnapshot(root,project){
  if(project.version!=='0.1'||typeof project.name!=='string'||!Array.isArray(project.artifacts))throw Error('STUDIO_PROJECT_INVALID');
  const files=new Map(),items=[],ids=new Set();
  for(const item of project.artifacts){
    if(!/^[a-z][a-z0-9-]{0,48}$/.test(item.id)||ids.has(item.id)||typeof item.name!=='string'||!/^work\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(item.directory))throw Error('STUDIO_ENTRY_INVALID');
    ids.add(item.id);
    const directory=join(root,item.directory),prefix=`artifacts/${item.id}/`;
    let snapshot,entry,checks=null;
    if(item.type==='components'){
      snapshot=await inspectConsumer(directory);snapshot.files.set('manifest.json',await readSafe(directory,'manifest.json'));entry='index.html';
    }else if(item.type==='panel'){
      const report=JSON.parse(await readSafe(directory,'report.json'));
      if(!['settings-panel-preview','action-panel-preview'].includes(report.kind)||!Array.isArray(report.files))throw Error('STUDIO_REPORT_INVALID');
      snapshot={files:new Map()};
      for(const f of report.files){
        const bytes=await readSafe(directory,f.file);
        if(hash(bytes)!==f.sha256||snapshot.files.has(f.file))throw Error('STUDIO_FILE_CHANGED');
        snapshot.files.set(f.file,bytes);
      }
      snapshot.files.set('report.json',await readSafe(directory,'report.json'));entry='preview.html';
      if(!snapshot.files.has(entry))throw Error('STUDIO_PREVIEW_MISSING');
      try{
        const record=JSON.parse(await readSafe(directory,'checks.json'));
        if(record.previewSha256!==hash(snapshot.files.get(entry)))throw Error('STUDIO_CHECK_CHANGED');
        checks={status:record.status,count:Array.isArray(record.checks)?record.checks.length:0,errors:record.errors?.length??0,semanticIssues:record.semanticIssues?.length??0};
      }catch(e){if(e.code!=='ENOENT')throw e;}
    }else throw Error('STUDIO_TYPE_INVALID');
    for(const [name,bytes] of snapshot.files)files.set(prefix+name,bytes);
    items.push({id:item.id,name:item.name,type:item.type,url:'/'+prefix+entry,checks,
      source:item.directory,downloads:[...snapshot.files.keys()].filter(f=>['kit.json','landscape.panel.json','portrait.panel.json','content.json','text-readability.json'].includes(f)).map(f=>({name:f,url:'/'+prefix+f}))});
  }
  files.set('catalog.json',Buffer.from(JSON.stringify({name:project.name,items})));
  files.set('index.html',await readSafe(join(root,'src/studio'),'index.html'));
  files.set('studio.mjs',await readSafe(join(root,'src/studio'),'studio.mjs'));
  for(const name of ['project.mjs','project-ui.mjs','tasks-ui.mjs','generation-ui.mjs','history-ui.mjs','pipeline-ui.mjs','panel-completion.mjs','confirm-ui.mjs','progress.mjs','progress-ui.mjs','studio.css','component-canvas.html','component-canvas.mjs','canvas-contrast.mjs','canvas-resolution.mjs'])files.set(name,await readSafe(join(root,'src/studio'),name));
  files.set('runtime/inventory-policy.mjs',await readFile(new URL('../runtime/inventory-policy.mjs',import.meta.url)));
  await studioMotionAssets(files);
  sizeEditorBundle??=build({entryPoints:[fileURLToPath(new URL('./panel-size.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'}).then(result=>result.outputFiles[0].contents);
  files.set('panel-size.mjs',Buffer.from(await sizeEditorBundle));
  for(const name of ['panel-size.html','panel-size.css'])files.set(name,await readSafe(join(root,'src/studio'),name));
  copyPreviewBundle??=build({entryPoints:[fileURLToPath(new URL('./panel-copy.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'}).then(result=>result.outputFiles[0].contents);
  files.set('panel-copy.mjs',Buffer.from(await copyPreviewBundle));
  for(const name of ['panel-copy.html','panel-copy.css'])files.set(name,await readSafe(join(root,'src/studio'),name));
  return {files,items};
}
