import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {hash,json,readSafe} from '../src/skins/package.mjs';
import {decodePng} from '../src/skins/png.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {inspectAssembly} from '../src/skins/postprocess.mjs';
import {consumerServer} from '../src/runtime/consumer-tools.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'work/asset-workbench'),pointer=join(out,'current.json');
const local=p=>{const q=resolve(root,p),r=relative(join(root,'work'),q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Use work/');return q;};
try{
  if(process.argv[2]==='build'){
    const config=JSON.parse(await readFile(join(root,'configs/skin-review.json'))),inputs=await readContracts(defaults),dir=join(out,randomUUID());await mkdir(join(dir,'sources'),{recursive:true});
    const files=new Map(),sources=[],skins=[];
    for(const skin of config.skins){
      const path=local(skin.assembly),bytes=await readFile(path),assembly=JSON.parse(bytes);await inspectAssembly(path,inputs);skins.push({id:skin.id,label:skin.label,config:assembly});
      for(const file of new Set(Object.values(assembly.parts).map(p=>p.file))){const b=await readSafe(resolve(path,'..'),file),sha256=hash(b),image=decodePng(b),png='sources/'+sha256+'.png',rgba='sources/'+sha256+'.rgba';files.set(png,b);files.set(rgba,image.pixels);sources.push({key:skin.id+'/'+file,sha256,width:image.width,height:image.height,png,rgba});}
    }
    const bundle=await build({entryPoints:[join(root,'web/asset-workbench.mjs')],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
    files.set('workbench.mjs',bundle.outputFiles[0].contents);files.set('index.html',await readFile(join(root,'web/asset-workbench.html')));files.set('data.json',Buffer.from(json({template:inputs.template,templateSha256:hash(inputs.bytes.template),sources,skins})));
    for(const[f,b]of files)await writeFile(join(dir,f),b,{flag:'wx'});
    const manifest=Buffer.from(json({kind:'ui_asset_workbench',version:'1.0',files:[...files].map(([file,b])=>({file,sha256:hash(b)}))}));await writeFile(join(dir,'manifest.json'),manifest,{flag:'wx'});
    const temp=pointer+'.'+randomUUID()+'.tmp';await writeFile(temp,json({directory:relative(root,dir),sha256:hash(manifest)}));await rename(temp,pointer);console.log(dir);
  }else if(process.argv[2]==='serve'){
    const current=JSON.parse(await readFile(pointer)),dir=local(current.directory),bytes=await readSafe(dir,'manifest.json');if(hash(bytes)!==current.sha256)throw Error('Workbench manifest changed');const files=new Map();
    for(const f of JSON.parse(bytes).files){const b=await readSafe(dir,f.file);if(hash(b)!==f.sha256||files.has(f.file))throw Error('Workbench resource changed');files.set(f.file,b);}
    const server=consumerServer({files},4195);server.on('error',e=>{console.error(e.message);process.exitCode=1;});server.listen(4195,'127.0.0.1',()=>console.log('http://127.0.0.1:4195/'));
  }else throw Error('Use npm run assets:workbench -- build|serve');
}catch(e){console.error(e.message);process.exitCode=1;}
