import { parseArgs } from 'node:util';
import { createServer } from 'node:http';
import { join,resolve,relative,isAbsolute,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSafe,hash } from '../src/skins/package.mjs';
import { previewHeaders } from '../src/editor/policy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
try{
  const {values:v}=parseArgs({options:{out:{type:'string'},port:{type:'string',default:'4176'}}});
  const out=resolve(v.out??join(root,'work/skin-pilot')),rel=relative(join(root,'work'),out),port=Number(v.port);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)||!Number.isInteger(port)||port<1024||port>65535)throw Error('Use a private work/ directory and valid port.');
  const c=JSON.parse(await readSafe(out,'current.json',4096));
  if(c.kind!=='ui_skin_pilot_current'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.buildId))throw Error('Invalid pointer.');
  const dir=join(out,'builds',c.buildId),rBytes=await readSafe(dir,'build-record.json');
  if(hash(rBytes)!==c.recordSha256)throw Error('Build record changed.');
  const r=JSON.parse(rBytes);let html;
  for(const f of r.files){const b=await readSafe(dir,f.file);if(b.length!==f.bytes||hash(b)!==f.sha256)throw Error('Artifact changed.');if(f.file==='preview.html')html=b;}
  for(const f of r.source)if(hash(await readSafe(root,f.file))!==f.sha256)throw Error('Preview is stale; rebuild the pilot.');
  if(!html)throw Error('Missing preview.');
  const server=createServer((req,res)=>{
    if(!['GET','HEAD'].includes(req.method)||req.url!=='/'||![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(404);res.end();return;}
    res.writeHead(200,previewHeaders);res.end(req.method==='HEAD'?undefined:html);
  });
  server.listen(port,'127.0.0.1',()=>console.log(`S03 component pilot: http://127.0.0.1:${port}/`));
}catch(e){console.error(e.message);process.exitCode=1;}
