import {createServer} from 'node:http';
import {hash,readSafe} from '../skins/package.mjs';
export async function inspectConsumer(directory,expectedSha256){
  const bytes=await readSafe(directory,'manifest.json'),digest=hash(bytes),manifest=JSON.parse(bytes);
  if(expectedSha256&&digest!==expectedSha256)throw Error('CONSUMER_MANIFEST_CHANGED');
  if(manifest.kind!=='ui_component_consumer_candidate'||manifest.version!=='0.1'||manifest.components!==16||!Array.isArray(manifest.files))throw Error('CONSUMER_MANIFEST_INVALID');
  const files=new Map(),names=new Set();
  for(const entry of manifest.files){
    if(typeof entry.file!=='string'||names.has(entry.file.toLowerCase())||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('CONSUMER_MANIFEST_INVALID');
    names.add(entry.file.toLowerCase());const data=await readSafe(directory,entry.file);
    if(hash(data)!==entry.sha256)throw Error('CONSUMER_FILE_CHANGED');files.set(entry.file,data);
  }
  for(const name of ['index.html','runtime.mjs','kit.json'])if(!files.has(name))throw Error('CONSUMER_FILE_MISSING');
  return {manifest,manifestSha256:digest,files};
}
// Serve an already verified snapshot, never arbitrary disk paths or a changed file.
export function consumerServer(snapshot,port,{allowFrames=false}={}){
  return createServer((req,res)=>{
    const file=req.url==='/'?'index.html':req.url?.slice(1);
    if(req.headers.host!==`127.0.0.1:${port}`||!['GET','HEAD'].includes(req.method)||!snapshot.files.has(file)){
      res.writeHead(404);res.end();return;
    }
    const archive=file.endsWith('.zip');
    const type=file.endsWith('.mjs')?'text/javascript; charset=utf-8':file.endsWith('.json')||file.endsWith('/download')?'application/json':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.png')?'image/png':archive?'application/zip':'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'Content-Length':snapshot.files.get(file).length,...(archive?{'Content-Disposition':'attachment; filename="ui-studio-delivery.zip"'}:{}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; font-src data: blob:; frame-src "+(allowFrames?"'self'":"'none'")+"; frame-ancestors "+(allowFrames?"'self'":"'none'")+"; base-uri 'none'; form-action 'none'"});
    res.end(req.method==='HEAD'?undefined:snapshot.files.get(file));
  });
}
