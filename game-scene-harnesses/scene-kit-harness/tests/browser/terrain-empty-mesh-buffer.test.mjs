import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {delimiter} from 'node:path';
import {dependency,packageRoot} from '../../scripts/studio-build.mjs';

// Minimal real WebGL regression. No kit, generated media, workflow or existing
// Studio is loaded. All glDrawElements calls pass through unchanged; the probe
// records byte ranges and checks the actual GL error and browser warnings.
test('empty batched meshes cannot become full-buffer draws across Pixi batch breaks',{timeout:120000},async t=>{
  const roots=(process.env.SCENE_KIT_DEPENDENCIES??'').split(delimiter).filter(Boolean),
    {build}=dependency('esbuild',roots).require('esbuild'),pixi=dependency('pixi.js',roots),
    {chromium}=dependency('playwright',roots).require('playwright');
  const result=await build({stdin:{resolveDir:packageRoot,sourcefile:'synthetic-empty-mesh.mjs',contents:`
    import {Application,Mesh,MeshGeometry,Texture} from 'pixi.js';
    import {hasDrawableTriangles} from './src/pixi/mesh-geometry.mjs';
    const app=new Application();await app.init({width:64,height:64,preference:'webgl',antialias:false,background:'#1d2b3b'});
    document.body.append(app.canvas);app.stop();
    const gl=app.renderer.gl,calls=[],draw=gl.drawElements.bind(gl);
    gl.drawElements=(mode,count,type,offset)=>{
      const bytes=gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER,gl.BUFFER_SIZE),elementBytes=type===gl.UNSIGNED_SHORT?2:4;
      calls.push({count,offsetBytes:offset,indexBufferBytes:bytes,requestedBytes:count*elementBytes});
      return draw(mode,count,type,offset);
    };
    const quad=x=>({positions:[x,0,x+8,0,x+8,8,x,8],uvs:[0,0,1,0,1,1,0,1],indices:[0,1,2,0,2,3]});
    const large=x=>{const p=[],u=[],indices=[];for(let i=0;i<28;i++){const a=quad(x),n=p.length/2;p.push(...a.positions);u.push(...a.uvs);indices.push(...a.indices.map(v=>v+n));}return {positions:p,uvs:u,indices};};
    const inputs=[quad(0),large(8),{positions:[],uvs:[],indices:[]},large(16),quad(24)],
      guarded=new URL(location.href).searchParams.get('guard')==='true';
    let skipped=0;const submitted=[];
    for(const data of inputs){if(guarded&&!hasDrawableTriangles(data)){skipped++;continue;}
      const geometry=new MeshGeometry({positions:new Float32Array(data.positions),uvs:new Float32Array(data.uvs),indices:new Uint32Array(data.indices)}),
        mesh=new Mesh({geometry,texture:Texture.WHITE});submitted.push({vertices:data.positions.length/2,indices:data.indices.length,batched:mesh.batched});app.stage.addChild(mesh);}
    app.renderer.render(app.stage);const glError=gl.getError(),d=gl.getExtension('WEBGL_debug_renderer_info'),
      renderer=d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    window.meshProbe={guarded,skipped,submitted,calls,glError,renderer};document.body.dataset.ready='true';
  `},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',alias:{'pixi.js':pixi.entry},logLevel:'silent'});
  const script=result.outputFiles[0].contents,html=Buffer.from('<!doctype html><script type="module" src="/app.js"></script>');
  const server=createServer((req,res)=>{
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    if(req.method!=='GET'||!['/','/app.js','/favicon.ico'].includes(path)){res.writeHead(404);return res.end();}
    if(path==='/favicon.ico'){res.writeHead(204);return res.end();}
    res.writeHead(200,{'Content-Type':path==='/app.js'?'text/javascript':'text/html','Cache-Control':'no-store'});res.end(path==='/app.js'?script:html);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,
    channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  t.after(()=>browser.close());
  async function probe(guarded){
    const page=await browser.newPage({viewport:{width:320,height:240},serviceWorkers:'block'}),warnings=[],errors=[],external=[];
    page.on('console',m=>{if(m.type()==='warning')warnings.push(m.text());if(m.type()==='error')errors.push(m.text());});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>new URL(r.request().url()).origin===origin&&r.request().method()==='GET'?r.continue():(external.push(r.request().url()),r.abort()));
    await page.goto(origin+'/?guard='+guarded);await page.waitForSelector('body[data-ready="true"]');
    const result=await page.evaluate(()=>window.meshProbe);await page.close();
    assert.match(result.renderer,/swiftshader/i);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    return {...result,warnings};
  }
  const raw=await probe(false),guarded=await probe(true);
  assert.equal(raw.glError,0x0502,'the unguarded zero batch must reproduce INVALID_OPERATION');
  assert(raw.calls.some(c=>c.offsetBytes+c.requestedBytes>c.indexBufferBytes),'the original zero-sized batch overruns its real index buffer');
  assert(raw.warnings.some(w=>/Insufficient buffer size/.test(w)),'the real browser must report the original failure');
  assert.equal(guarded.glError,0);assert.deepEqual(guarded.warnings,[]);assert.equal(guarded.skipped,1);
  assert(guarded.submitted.every(m=>m.indices>0));
  assert(guarded.calls.every(c=>c.offsetBytes+c.requestedBytes<=c.indexBufferBytes));
  assert.deepEqual(guarded.submitted,raw.submitted.filter(m=>m.indices>0),'all nonempty geometry and batching choices stay unchanged');
});
