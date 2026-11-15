import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSceneKit } from '../kit.mjs';
import { contextFor } from '../kit.mjs';
import { createEditor } from '../editor.mjs';
import { exportSceneArchive } from '../persistence.mjs';
import { assertTerrainStudyPreview } from '../terrain-proof/preview.mjs';
import { check } from '../generation/common.mjs';
import {studioKitSnapshot} from './kit-snapshot.mjs';
import {createProjectWorkspace,ProjectError} from './projects.mjs';
import { objectEditPatch, objectEditResponse } from './object-edit-patch.mjs';
import { terrainEditPatch } from './terrain-edit-patch.mjs';
import { terrainEditResponse } from './terrain-edit-wire.mjs';
import { terrainStudyTextureKey } from '../pixi/terrain-appearance.mjs';
import { openEnvironmentLibraryExchange } from '../generation/environment-library-exchange.mjs';
import { subjectPngLimit, validateEnvironmentStyle } from '../generation/environment-library-plan.mjs';
import { exportEnvironmentAnimationPlan, readEnvironmentAnimationPlan } from '../generation/environment-animation-plan.mjs';
import { openEnvironmentAnimationExchange } from '../generation/environment-animation-exchange.mjs';
import { supportsEnvironmentAnimation } from '../environment-animation.mjs';

const LIMIT = 2097152;
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));

// Startup-configured kit and optional bounded local workspace; HTTP never chooses paths.
export async function startStudio({ root, staticRoot, port = 0, terrainPreview = null, initialDocument, workspaceRoot, projectName, environmentLibrary, animationExchangeRoot, releaseCommit = null } = {}) {
  check(!(workspaceRoot&&terrainPreview),'PROJECT_APPEARANCE_UNBOUND');
  check(!environmentLibrary || workspaceRoot, 'ENVIRONMENT_WORKSPACE_REQUIRED');
  check(!animationExchangeRoot || workspaceRoot, 'ENVIRONMENT_WORKSPACE_REQUIRED');
  const handle = loadSceneKit(root);
  const context = contextFor(handle);
  let editor = createEditor(handle, initialDocument), revision = 0;
  if (terrainPreview) {
    assertTerrainStudyPreview(terrainPreview);
    check(context.kit.grid.width === 64 && context.kit.grid.height === 64
      && context.kit.pixelsPerUnit.numerator === 1 && context.kit.pixelsPerUnit.denominator === 1, 'TERRAIN_PREVIEW_GEOMETRY');
    check(context.catalog.modules.filter(module => module.kind === 'terrain').every(module =>
      module.pixelSize.width === 64 && module.pixelSize.height === 64 && module.anchorPx.x === 0 && module.anchorPx.y === 0
      && module.visualOffset.x === 0 && module.visualOffset.y === 0), 'TERRAIN_PREVIEW_GEOMETRY');
    for (const layer of editor.getScene().layers) for (const node of layer.nodes) terrainStudyTextureKey(node);
  }
  const staticFiles = new Map([
    ['/', ['text/html; charset=utf-8', readFileSync(join(staticRoot, 'index.html'))]],
    ['/app.js', ['text/javascript; charset=utf-8', readFileSync(join(staticRoot, 'app.js'))]],
    ['/style.css', ['text/css; charset=utf-8', readFileSync(join(staticRoot, 'style.css'))]],
  ]);
  const {metadata,assets}=studioKitSnapshot(handle,{terrainPreview});
  const workspace=workspaceRoot?createProjectWorkspace({root:workspaceRoot,handle,initialDocument,projectName}):null;
  if(environmentLibrary)validateEnvironmentStyle(environmentLibrary.style);
  const exchange=environmentLibrary?openEnvironmentLibraryExchange(environmentLibrary.root):null;
  const animationExchange = animationExchangeRoot ? openEnvironmentAnimationExchange(animationExchangeRoot) : null;
  const animationEndpoint = '/api/environment-animation/generation';
  let pendingAnimation = null;
  function environmentBinding(asset){
    if(!exchange||!asset)return null;
    const style=environmentLibrary.style, context=contextFor(asset.handle);
    const module=context.modules.get(style.anchorAssetId);
    return context.kit.kitId===style.kitId&&module?.kind==='environment'&&module.source.sha256===style.anchorSha256
      ?{style,anchor:context.files.get(module.source.path)}:null;
  }
  staticFiles.set('/editor',staticFiles.get('/'));
  if(workspace){
    staticFiles.set('/',['text/html; charset=utf-8',readFileSync(join(staticRoot,'projects.html'))]);
    staticFiles.set('/projects.js',['text/javascript; charset=utf-8',readFileSync(join(staticRoot,'projects.js'))]);
    staticFiles.set('/projects.css',['text/css; charset=utf-8',readFileSync(join(staticRoot,'projects.css'))]);
  }
  const projectSnapshots=new Map();
  function projectSnapshot(){const {project,asset}=workspace.current();if(!asset)return {metadata:{kit:null,modules:[],brushes:[],presets:[]},assets:new Map()};
    if(projectSnapshots.get(project.projectId)?.hash!==asset.hash)projectSnapshots.set(project.projectId,{
      hash:asset.hash,snapshot:studioKitSnapshot(asset.handle,{assetPrefix:`/assets/${project.projectId}/${asset.hash}`})});
    return projectSnapshots.get(project.projectId).snapshot;
  }
  function fullState(){
    if(!workspace)return {...metadata,...state()};
    const binding=environmentBinding(workspace.current().asset);
    return {...projectSnapshot().metadata,...workspace.state(),...(binding?{environmentLibrary:{styleName:binding.style.name}}:{}),
      ...(animationExchange ? { animationGeneration: true } : {})};
  }
  const state = () => ({ revision, document: editor.getDocument(), scene: editor.getScene(), history: editor.history() });
  let origin;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };
    try {
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)
        || request.headers['sec-fetch-site'] === 'cross-site') return send(403, { code: 'ORIGIN_REJECTED' });
      if (request.url === '/api/studio-version' && request.method === 'GET') {
        return send(200, { releaseCommit, mode: workspace ? 'project' : 'review' });
      }
      if (request.url === '/api/state' && request.method === 'GET') return send(200, fullState());
      if (animationExchange && request.method === 'GET') {
        const preview = /^\/api\/environment-animation\/generation\/([a-f0-9]{64})\.png$/.exec(request.url);
        if (request.url === animationEndpoint || preview) {
          const { project, asset } = workspace.current(), kitSha256 = asset?.handle.bundleSha256;
          if (!preview) return send(200, {
            available: animationExchange.available(), current: animationExchange.get(project.projectId, kitSha256),
          });
          const bytes = animationExchange.preview(project.projectId, kitSha256, preview[1]);
          response.writeHead(200, { 'Content-Type': 'image/png' }); return response.end(bytes);
        }
      }
      if (workspace && request.method === 'POST' && (['/api/environment-animation', '/api/environment-animation/plan'].includes(request.url)
        || (animationExchange && request.url === animationEndpoint))) {
        if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json')
          return send(403, { code: 'ORIGIN_REJECTED' });
        const generating = request.url === animationEndpoint;
        const planning = generating || request.url.endsWith('/plan'), limit = planning ? 8192 : 24 * 1024 * 1024;
        const chunks = []; let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > limit) { send(413, { code: 'BODY_LIMIT' }); request.resume(); return; }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return send(400, { code: 'INVALID_JSON' }); }
        if (!planning) { workspace.setEnvironmentAnimation(body); return send(200, fullState()); }
        if (generating && body?.action === 'confirm') {
          if (!exact(body, ['action', 'revision', 'assetId', 'planSha256'])) return send(400, { code: 'REQUEST_SHAPE' });
          workspace.guard(body.revision);
          const { project, asset } = workspace.current();
          check(pendingAnimation?.plan.sha256 === body.planSha256 && pendingAnimation.plan.assetId === body.assetId
            && pendingAnimation.plan.projectId === project.projectId && pendingAnimation.plan.kitSha256 === asset?.handle.bundleSha256,
          'ANIMATION_PLAN_CHANGED');
          return send(202, animationExchange.submit(pendingAnimation.archive, body.planSha256));
        }
        if (generating && (!exact(body, ['action', 'revision', 'assetId', 'input']) || body.action !== 'prepare'))
          return send(400, { code: 'REQUEST_SHAPE' });
        if (generating) delete body.action;
        if (!exact(body, ['revision', 'assetId', 'input']) || typeof body.assetId !== 'string') return send(400, { code: 'REQUEST_SHAPE' });
        workspace.guard(body.revision);
        const { project, asset } = workspace.current();
        const context = asset && contextFor(asset.handle), module = context?.modules.get(body.assetId);
        if (!supportsEnvironmentAnimation(module)) return send(422, { code: 'ANIMATION_MODULE_KIND' });
        const archive = exportEnvironmentAnimationPlan(project.projectId, asset.handle.bundleSha256, module.assetId, body.input, context.files.get(module.source.path));
        if (generating) {
          check(animationExchange.available(), 'ANIMATION_WORKER_OFFLINE');
          const { plan } = readEnvironmentAnimationPlan(archive);
          pendingAnimation = { archive, plan };
          return send(200, { planSha256: plan.sha256, input: plan.input });
        }
        response.writeHead(200, { 'Content-Type': 'application/zip' });
        return response.end(archive);
      }
      if(exchange&&(request.url==='/api/environment-library'||/^\/environment-candidates\/[a-f0-9-]{36}\/[a-f0-9]{64}\.png$/.test(request.url))){
        let current=workspace.current(),binding=environmentBinding(current.asset);
        if(!binding)return send(409,{code:'ENVIRONMENT_STYLE_UNBOUND'});
        if(request.method==='GET'&&request.url==='/api/environment-library')return send(200,exchange.get(current.project.projectId));
        if(request.method==='GET'){
          const [, ,jobId,file]=request.url.split('/');
          const bytes=exchange.preview(current.project.projectId,jobId,file.slice(0,-4));
          response.writeHead(200,{'Content-Type':'image/png'});return response.end(bytes);
        }
        if(request.method!=='POST'||request.url!=='/api/environment-library')return send(405,{code:'METHOD_REJECTED'});
        if(request.headers.origin!==origin||request.headers['content-type']!=='application/json')return send(403,{code:'ORIGIN_REJECTED'});
        const chunks=[];let size=0;
        for await(const chunk of request){
          size+=chunk.length;
          if(size>Math.ceil(subjectPngLimit/3)*4+8192){send(413,{code:'ENVIRONMENT_REFERENCE_LIMIT'});request.resume();return;}
          chunks.push(chunk);
        }
        let body;
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{code:'INVALID_JSON'});}
        const fields={
          prepare:['prompt','reference'],generate:['prompt','reference'],authorize:['jobId','targetSha256'],
          abandon:['jobId'],recheckMargin:['jobId'],adopt:['jobId','spriteSha256'],
        }[body?.action];
        const creating=body?.action==='prepare'||body?.action==='generate';
        const destination=creating&&Object.hasOwn(body,'placementRole')?['placementRole']:[];
        if(!Array.isArray(fields)||!exact(body,['action','revision',...fields,...destination]))return send(400,{code:'REQUEST_SHAPE'});
        workspace.guard(body.revision);
        current=workspace.current();binding=environmentBinding(current.asset);
        if(!binding)return send(409,{code:'ENVIRONMENT_STYLE_UNBOUND'});
        const {projectId}=current.project,kitSha256=current.asset.handle.bundleSha256;
        if(creating){
          if(body.reference!==null&&(typeof body.reference!=='string'||!(/^[A-Za-z0-9+/]+={0,2}$/).test(body.reference)))
            return send(422,{code:'ENVIRONMENT_REFERENCE_PNG'});
          const reference=body.reference===null?null:Buffer.from(body.reference,'base64');
          return send(200,exchange.create({projectId,kitSha256,...binding,prompt:body.prompt,reference,
            placementRole:body.placementRole,automatic:body.action==='generate'}));
        }
        if(body.action==='authorize')return send(200,exchange.authorize({projectId,kitSha256,style:binding.style,jobId:body.jobId,targetSha256:body.targetSha256}));
        if(body.action==='abandon')return send(200,exchange.abandon(projectId,body.jobId));
        if(body.action==='recheckMargin')return send(200,exchange.recheckMargin({projectId,kitSha256,jobId:body.jobId}));
        workspace.addEnvironment(exchange.accept({projectId,jobId:body.jobId,spriteSha256:body.spriteSha256}),body.revision);
        return send(200,fullState());
      }
      if(workspace&&request.method==='GET'&&request.url==='/api/projects')return send(200,workspace.overview());
      if(workspace&&request.method==='GET'&&/^\/project-previews\/[a-f0-9-]{36}\.png$/.test(request.url)){
        const bytes=workspace.preview(request.url.slice('/project-previews/'.length,-4));if(!bytes)return send(404,{code:'NOT_FOUND'});response.writeHead(200,{'Content-Type':'image/png'});return response.end(bytes);
      }
      // The UI fetches ZIP bytes before naming a Blob download. An attachment
      // disposition can turn that fetch into an empty 204 in some browsers.
      if(workspace&&request.method==='GET'&&/^\/api\/projects\/[a-f0-9-]{36}\/export\?revision=\d+$/.test(request.url)){
        const projectId=request.url.split('/')[3],bytes=workspace.exportProject(Number(request.url.split('=')[1]),projectId);response.writeHead(200,{'Content-Type':'application/zip'});return response.end(bytes);
      }
      if(workspace&&request.method==='GET'&&/^\/api\/projects\/export\?revision=\d+$/.test(request.url)){
        const bytes=workspace.exportProject(Number(request.url.split('=')[1]));response.writeHead(200,{'Content-Type':'application/zip'});return response.end(bytes);
      }
      if(workspace&&request.method==='POST'&&(request.url==='/api/projects'||/^\/api\/projects\/(assets|import)\?revision=\d+$/.test(request.url))){
        const binary=request.url!=='/api/projects';
        if(request.headers.origin!==origin||request.headers['content-type']!==(binary?'application/zip':'application/json'))return send(403,{code:'ORIGIN_REJECTED'});
        const chunks=[];let length=0;const limit=binary?128*1024*1024:LIMIT;
        for await(const chunk of request){length+=chunk.length;if(length>limit){send(413,{code:'BODY_LIMIT'});request.resume();return;}chunks.push(chunk);}
        const bytes=Buffer.concat(chunks);
        if(binary){const expected=Number(request.url.split('=')[1]);if(request.url.startsWith('/api/projects/assets?'))workspace.importAssets(bytes,expected);else workspace.importProject(bytes,expected);}
        else{let body;try{body=JSON.parse(bytes.toString('utf8'));}catch{return send(400,{code:'INVALID_JSON'});}
          const result=workspace.operate(body);
          if(body.action==='rename-asset')return send(200,{revision:result.revision,assetNames:result.assetNames});
        }
        return send(200,fullState());
      }
      if (request.method === 'GET' && /^\/api\/export\?revision=\d+$/.test(request.url)) {
        if (Number(request.url.split('=')[1]) !== (workspace?workspace.state().revision:revision)) return send(409, { code: 'STALE_REVISION' });
        const bytes = workspace?workspace.exportMap(Number(request.url.split('=')[1])):exportSceneArchive(handle, editor.getDocument());
        response.writeHead(200, { 'Content-Type': 'application/zip' });
        return response.end(bytes);
      }
      if (request.url === '/api/edit' && request.method === 'POST') {
        if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') return send(403, { code: 'ORIGIN_REJECTED' });
        const chunks = []; let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > LIMIT) { send(413, { code: 'BODY_LIMIT' }); request.resume(); return; }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return send(400, { code: 'INVALID_JSON' }); }
        const fields = body?.action === 'commands' ? ['revision', 'action', 'commands']
          : body?.action === 'import' ? ['revision', 'action', 'document'] : ['revision', 'action'];
        if (!exact(body, fields) || !Number.isSafeInteger(body.revision)) return send(400, { code: 'REQUEST_SHAPE' });
        const terrainBase = request.headers.accept === terrainEditResponse && request.headers['x-scene-kit-base'];
        const wantsPatch = (request.headers.accept === objectEditResponse || terrainBase) && body.action !== 'import';
        if (!workspace && body.revision !== revision) return send(409, { code: 'STALE_REVISION' });
        const before = wantsPatch && (workspace ? workspace.state() : state());
        if (before && terrainBase && terrainBase !== before.scene?.contentSha256) {
          return send(409, { code: 'STALE_REVISION' });
        }
        const respond = next => {
          const scenePatch = before && objectEditPatch(before, next);
          const terrainPatch = !scenePatch && before && terrainBase && terrainEditPatch(before.scene, next.scene);
          if (!scenePatch && !terrainPatch) return send(200, next);
          const { scene, ...rest } = next;
          return send(200, scenePatch ? { ...rest, scenePatch } : { ...rest, terrainPatch });
        };
        if (workspace) return respond(workspace.edit(body));
        let changed,candidate;
        if (body.action === 'commands') {candidate=editor.fork();changed = candidate.execute(body.commands).changed;}
        else if (body.action === 'undo' || body.action === 'redo') {candidate=editor.fork();changed = candidate[body.action]().changed;}
        else if (body.action === 'import') {
          candidate = createEditor(handle, body.document);changed = true;
        } else return send(400, { code: 'ACTION_UNSUPPORTED' });
        if(!changed)return respond(state());
        const next={revision:revision+1,document:candidate.getDocument(),scene:candidate.getScene(),history:candidate.history()};
        // The complete checked result is prepared before revision advances.
        editor=candidate;revision=next.revision;
        return respond(next);
      }
      if(workspace&&request.method==='GET'){const image=projectSnapshot().assets.get(request.url);if(image){response.writeHead(200,{'Content-Type':'image/png'});return response.end(image);}}
      if (request.method === 'GET' && staticFiles.has(request.url)) {
        const [mime, bytes] = staticFiles.get(request.url);
        response.writeHead(200, { 'Content-Type': mime }); return response.end(bytes);
      }
      if (!workspace && request.method === 'GET' && assets.has(request.url)) {
        response.writeHead(200, { 'Content-Type': 'image/png' }); return response.end(assets.get(request.url));
      }
      if (request.method === 'GET' && request.url === '/favicon.ico') { response.writeHead(204); return response.end(); }
      send(404, { code: 'NOT_FOUND' });
    } catch (error) {
      if(error instanceof ProjectError)return send(error.status,{code:error.code,message:error.message});
      if((request.url==='/api/environment-library'||request.url.startsWith('/environment-candidates/'))&&error.errors?.[0])
        return send(422,{code:error.errors[0].code});
      send(error?.errors ? 422 : 500, error?.errors
        ? { code: 'EDIT_REJECTED', errors: error.errors }
        : { code: 'STUDIO_FAILURE' });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxConnections = 32;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  // The host only adopts received bytes. The CLI remains the only process
  // that can reserve and dispatch model requests.
  const settle = exchange ? setInterval(() => {
    try {
      exchange.settleAutomatic(candidate => workspace.addEnvironment(candidate, workspace.state().revision, { background: true }));
    } catch {
      // A failed receipt write is retried through idempotent project adoption.
      // The exchange still exposes any malformed record to the status route.
    }
  }, 500) : null;
  settle?.unref();
  server.once('close', () => clearInterval(settle));
  return { url: origin, close: () => {
    clearInterval(settle);
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
