import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,renameSync,rmSync,realpathSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createEditor} from '../editor.mjs';
import {readMap,contextFor} from '../kit.mjs';
import {exportSceneArchive,openSceneExport} from '../persistence.mjs';
import {readStoredArchive,storeArchive} from '../archive.mjs';
import {canonicalJson} from '../document.mjs';
import {sha256} from '../validate.mjs';
import {appendEnvironmentModule,updateEnvironmentAnimation} from './environment-kit.mjs';
import {generatedEnvironmentId} from './generated-environment-id.mjs';

const ASSET_LIMIT=64*1024*1024,UPLOAD_LIMIT=128*1024*1024,JSON_LIMIT=16*1024*1024;
const id=()=>randomUUID(),uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,digest=/^[a-f0-9]{64}$/;
const bytes=value=>Buffer.from(canonicalJson(value)+'\n');
export class ProjectError extends Error {constructor(code,message,status=422){super(message);this.code=code;this.status=status;}}
const need=(value,code='PROJECT_INVALID',message='项目文件不完整或不受支持。',status=422)=>{if(!value)throw new ProjectError(code,message,status);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function name(v){need(typeof v==='string'&&v.trim().length>0&&v.trim().length<=60&&!/[\x00-\x1f\x7f]/.test(v),'NAME_INVALID','名称须为1至60个可见字符。');return v.trim();}
function assetNames(value, asset) {
  need(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 1024, 'NAME_INVALID');
  const modules = asset && contextFor(asset.handle).modules;
  return Object.fromEntries(Object.entries(value).map(([id, label]) => {
    need(modules?.has(id) && modules.get(id).kind !== 'terrain', 'PROJECT_ASSET_NOT_FOUND','当前项目没有这份可命名素材。');
    return [id, name(label)];
  }));
}
function json(buffer){try{return JSON.parse(buffer.toString('utf8'));}catch{throw new ProjectError('PROJECT_INVALID','项目 JSON 无效。');}}
function regular(path,max){need(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink(),'WORKSPACE_INVALID');const size=lstatSync(path).size;need(size<=max,'PROJECT_LIMIT','文件超过项目容量限制。');return readFileSync(path);}
function directory(path){mkdirSync(path,{recursive:true});need(lstatSync(path).isDirectory()&&!lstatSync(path).isSymbolicLink(),'WORKSPACE_INVALID');}
function blank(handle,document){const copy=structuredClone(document);copy.mapId=`map.${id()}`;
  for(const key of ['terrainRuns','instances','assemblyInstances','inspectionCases','curveTerrains','terrainConnections','instanceTransforms'])if(Object.hasOwn(copy,key))copy[key]=[];
  delete copy.instanceAppearances;
  return createEditor(handle,copy);
}

// Only the startup owner chooses root. HTTP supplies IDs and bounded bytes.
export function createProjectWorkspace({root,handle,initialDocument,projectName='场景项目'}){
  root=resolve(root);directory(root);root=realpathSync(root);const assetRoot=join(root,'assets');directory(assetRoot);
  const snapshot=join(root,'workspace.json'),cache=new Map();let data,revision=0;
  function decodeAsset(buffer){
    if(data)for(const hash of cache.keys())if(!data.projects.some(p=>p.assetSha256===hash))cache.delete(hash);
    need(buffer.length<=ASSET_LIMIT,'PROJECT_LIMIT','资产包上限为64 MiB。');const hash=sha256(buffer);if(cache.has(hash))return cache.get(hash);
    need([...cache.values()].reduce((n,a)=>n+a.bytes.length,0)+buffer.length<=256*1024*1024,'PROJECT_LIMIT','工作区资产总量超过256 MiB。');
    const files=readStoredArchive(buffer,{maxBytes:ASSET_LIMIT});let temp;
    try{
      temp=mkdtempSync(join(root,'.verify-'));
      for(const [path,content]of files){const target=resolve(temp,...path.split('/')),rel=relative(temp,target);need(!rel.startsWith('..')&&!isAbsolute(rel),'PROJECT_INVALID');mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content,{flag:'wx'});}
      const opened=openSceneExport(temp),asset={hash,bytes:Buffer.from(buffer),handle:opened.handle,document:opened.document};cache.set(hash,asset);return asset;
    }finally{if(temp&&dirname(resolve(temp))===root)rmSync(temp,{recursive:true,force:true});}
  }
  function getAsset(hash){if(cache.has(hash))return cache.get(hash);need(digest.test(hash),'WORKSPACE_INVALID');const buffer=regular(join(assetRoot,hash+'.zip'),ASSET_LIMIT);need(sha256(buffer)===hash,'WORKSPACE_INVALID','本机资产包校验失败。');return decodeAsset(buffer);}
  function storeAsset(asset){const path=join(assetRoot,asset.hash+'.zip');if(existsSync(path)){need(sha256(regular(path,ASSET_LIMIT))===asset.hash,'WORKSPACE_INVALID');return;}writeFileSync(path,asset.bytes,{flag:'wx'});}
  function serialized(value,nextRevision=revision){return {format:'ai_scene_workspace_v1',revision:nextRevision,activeProjectId:value.activeProjectId,projects:value.projects.map(p=>({projectId:p.projectId,name:p.name,assetSha256:p.assetSha256,activeMapId:p.activeMapId,
    ...(p.assetNames&&Object.keys(p.assetNames).length?{assetNames:p.assetNames}:{}),maps:p.maps.map(m=>({mapId:m.mapId,name:m.name,document:m.editor?.getDocument()??null}))}))};}
  function save(value,nextRevision=revision){
    const buffer=bytes(serialized(value,nextRevision));need(buffer.length<=JSON_LIMIT,'PROJECT_LIMIT','项目布局总量超过16 MiB。');
    const hashes=[...new Set(value.projects.map(p=>p.assetSha256).filter(Boolean))];need(hashes.reduce((n,h)=>n+getAsset(h).bytes.length,0)<=256*1024*1024,'PROJECT_LIMIT','工作区资产总量超过256 MiB。');
    const temp=join(root,`.save-${id()}.tmp`);let fd;
    try{fd=openSync(temp,'wx');writeFileSync(fd,buffer);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,snapshot);}
    catch(error){const failure=new ProjectError('PROJECT_SAVE_FAILED','本机保存失败，原地图和撤销历史已保留。',503);failure.causeCode=error.code;throw failure;}
    finally{if(fd!==undefined)closeSync(fd);if(existsSync(temp))rmSync(temp);}
  }
  function validateProject(p){
    need(exact(p,['projectId','name','assetSha256','activeMapId','maps',...(p&&Object.hasOwn(p,'assetNames')?['assetNames']:[])])&&uuid.test(p.projectId)&&uuid.test(p.activeMapId));
    name(p.name);need(p.assetSha256===null||digest.test(p.assetSha256));need(Array.isArray(p.maps)&&p.maps.length>0&&p.maps.length<=16,'PROJECT_LIMIT','每个项目最多16张地图。');
    const asset=p.assetSha256?getAsset(p.assetSha256):null,seen=new Set();
    const maps=p.maps.map(m=>{need(exact(m,['mapId','name','document'])&&uuid.test(m.mapId)&&!seen.has(m.mapId));seen.add(m.mapId);name(m.name);need(asset?m.document!==null:m.document===null);
      return {mapId:m.mapId,name:m.name,editor:asset?createEditor(asset.handle,m.document):null};});need(seen.has(p.activeMapId));return {...p,maps,assetNames:assetNames(Object.hasOwn(p,'assetNames')?p.assetNames:{},asset)};
  }
  if(existsSync(snapshot)){
    const raw=json(regular(snapshot,JSON_LIMIT));need(exact(raw,['format','revision','activeProjectId','projects'])&&raw.format==='ai_scene_workspace_v1'&&Number.isSafeInteger(raw.revision)&&raw.revision>=0&&uuid.test(raw.activeProjectId));revision=raw.revision;
    need(Array.isArray(raw.projects)&&raw.projects.length>0&&raw.projects.length<=8);const projects=raw.projects.map(validateProject);
    need(new Set(projects.map(p=>p.projectId)).size===projects.length&&projects.some(p=>p.projectId===raw.activeProjectId));data={activeProjectId:raw.activeProjectId,projects};
  }else{
    const buffer=exportSceneArchive(handle,readMap(handle));const asset={hash:sha256(buffer),bytes:buffer,handle,document:readMap(handle)};need(buffer.length<=ASSET_LIMIT,'PROJECT_LIMIT');cache.set(asset.hash,asset);storeAsset(asset);
    const projectId=id(),mapId=id();data={activeProjectId:projectId,projects:[{projectId,name:name(projectName),assetSha256:asset.hash,activeMapId:mapId,maps:[{mapId,name:'主场景',editor:createEditor(handle,initialDocument)}]}]};save(data);
  }
  const currentOf=value=>{const project=value.projects.find(p=>p.projectId===value.activeProjectId),map=project.maps.find(m=>m.mapId===project.activeMapId);return {project,map,asset:project.assetSha256?getAsset(project.assetSha256):null};};
  const current=()=>currentOf(data);
  const guard=expected=>need(Number.isSafeInteger(expected)&&expected===revision,'STALE_REVISION','另一个窗口已更新项目，请刷新后继续。',409);
  function commit(next){need(next.projects.length<=8,'PROJECT_LIMIT','工作区最多8个项目。');for(const p of next.projects)need(p.maps.length<=16,'PROJECT_LIMIT','每个项目最多16张地图。');
    const prepared=stateOf(next,revision+1);save(next,revision+1);data=next;revision++;return prepared;}
  function view(value=data){return {format:'ai_scene_workspace_view_v1',activeProjectId:value.activeProjectId,activeMapId:currentOf(value).map.mapId,projects:value.projects.map(p=>({projectId:p.projectId,name:p.name,hasAssets:!!p.assetSha256,kitSha256:p.assetSha256?getAsset(p.assetSha256).handle.bundleSha256:null,maps:p.maps.map(m=>({mapId:m.mapId,name:m.name}))})),persistence:'local-files',generationCalls:0};}
  function stateOf(value,nextRevision){const {project,map}=currentOf(value);return {revision:nextRevision,workspace:view(value),assetNames:project.assetNames??{},document:map.editor?.getDocument()??null,scene:map.editor?.getScene()??null,history:map.editor?.history()??{undoDepth:0,redoDepth:0}};}
  const state=()=>stateOf(data,revision);
  function replaceMap(editor){const {project,map}=current();return {...data,projects:data.projects.map(p=>p===project?{...p,maps:p.maps.map(m=>m===map?{...m,editor}:m)}:p)};}
  function cover(project){if(!project.assetSha256)return null;const c=contextFor(getAsset(project.assetSha256).handle),modules=c.catalog.modules.filter(m=>m.kind!=='terrain');
    const module=modules.find(m=>/sky/i.test(m.assetId))??modules.find(m=>m.kind==='strip')??modules[0];return module?c.files.get(module.source.path):null;}
  function reviseAssets(project, handle, assetNames = project.assetNames) {
    const document = readMap(handle), bytes = exportSceneArchive(handle, document);
    need(bytes.length <= ASSET_LIMIT, 'PROJECT_LIMIT', '资产包上限为64 MiB。');
    const asset = { hash: sha256(bytes), bytes, handle, document };
    const maps = project.maps.map(map => ({ ...map, editor: map.editor.rebind(asset.handle) }));
    storeAsset(asset);
    cache.set(asset.hash, asset);
    try {
      const next = commit({...data,projects:data.projects.map(item=>item===project?{...item,assetSha256:asset.hash,assetNames,maps}:item)});
      for (const hash of cache.keys()) if (!data.projects.some(item => item.assetSha256 === hash)) cache.delete(hash);
      return next;
    } catch (error) {
      if (!data.projects.some(item => item.assetSha256 === asset.hash)) cache.delete(asset.hash);
      throw error;
    }
  }
  return {
    current,state,guard,
    overview(){return {revision,workspace:view(),projects:data.projects.map(p=>{const c=p.assetSha256?contextFor(getAsset(p.assetSha256).handle):null;
      return {projectId:p.projectId,name:p.name,mapCount:p.maps.length,hasAssets:!!c,environmentCount:c?c.catalog.modules.filter(m=>m.kind!=='terrain').length:0,brushCount:c?1:0,presetCount:c?c.library.presets.length:0,coverUrl:cover(p)?`/project-previews/${p.projectId}.png`:null};}),generationCalls:0};},
    preview(projectId){const project=data.projects.find(p=>p.projectId===projectId);return project?cover(project):null;},
    edit(body){guard(body.revision);const {asset,map}=current();need(asset,'PROJECT_NEEDS_ASSETS','请先为该项目导入资产包。',409);let editor=map.editor.fork(),changed;
      if(body.action==='commands')changed=editor.execute(body.commands).changed;
      else if(['undo','redo'].includes(body.action))changed=editor[body.action]().changed;
      else throw new ProjectError('ACTION_UNSUPPORTED','请将 JSON 导入为新地图。',400);
      return changed?commit(replaceMap(editor)):state();
    },
    operate(body){need(body&&typeof body==='object','REQUEST_SHAPE','项目操作参数无效。',400);guard(body.revision);const {project,map,asset}=current();const fields={
      'create-project':['name','template'],'switch-project':['projectId'],'rename-project':['projectId','name'],'copy-project':['projectId','name'],
      'create-map':['name','template'],'switch-map':['mapId'],'rename-map':['mapId','name'],'import-map':['name','document'],
      'rename-asset':['assetId','name'],
    }[body.action];need(fields&&exact(body,['revision','action',...fields]),'REQUEST_SHAPE','项目操作参数无效。',400);
      if(body.action==='rename-asset'){
        need(typeof body.assetId==='string','REQUEST_SHAPE','素材 ID 无效。',400);
        const names=assetNames({...project.assetNames,[body.assetId]:body.name},asset);
        return commit({...data,projects:data.projects.map(p=>p===project?{...p,assetNames:names}:p)});
      }
      if(body.action==='create-project'){
        need(['empty','current'].includes(body.template),'REQUEST_SHAPE');const projectId=id();
        let maps,activeMapId;
        if(body.template==='current'){maps=project.maps.map(m=>({...m,mapId:id(),editor:m.editor?createEditor(asset.handle,m.editor.getDocument()):null}));activeMapId=maps[project.maps.indexOf(map)].mapId;}
        else{activeMapId=id();maps=[{mapId:activeMapId,name:'主场景',editor:null}];}
        return commit({activeProjectId:projectId,projects:[...data.projects,{projectId,name:name(body.name),assetSha256:body.template==='current'?project.assetSha256:null,assetNames:body.template==='current'?project.assetNames:undefined,activeMapId,maps}]});
      }
      if(body.action==='copy-project'){
        const source=data.projects.find(p=>p.projectId===body.projectId);need(uuid.test(body.projectId)&&source,'PROJECT_NOT_FOUND','项目不存在。',404);
        const sourceAsset=source.assetSha256?getAsset(source.assetSha256):null,projectId=id(),maps=source.maps.map(m=>({...m,mapId:id(),editor:m.editor?createEditor(sourceAsset.handle,m.editor.getDocument()):null})),activeMapId=maps[source.maps.findIndex(m=>m.mapId===source.activeMapId)].mapId;
        return commit({activeProjectId:projectId,projects:[...data.projects,{projectId,name:name(body.name),assetSha256:source.assetSha256,assetNames:source.assetNames,activeMapId,maps}]});
      }
      if(body.action==='switch-project'||body.action==='rename-project'){
        need(uuid.test(body.projectId)&&data.projects.some(p=>p.projectId===body.projectId),'PROJECT_NOT_FOUND','项目不存在。',404);
        return commit(body.action==='switch-project'?{...data,activeProjectId:body.projectId}:{...data,projects:data.projects.map(p=>p.projectId===body.projectId?{...p,name:name(body.name)}:p)});
      }
      if(body.action==='switch-map'||body.action==='rename-map'){
        need(uuid.test(body.mapId)&&project.maps.some(m=>m.mapId===body.mapId),'MAP_NOT_FOUND','该项目没有这张地图。',404);
        return commit({...data,projects:data.projects.map(p=>p===project?{...p,...(body.action==='switch-map'?{activeMapId:body.mapId}:{maps:p.maps.map(m=>m.mapId===body.mapId?{...m,name:name(body.name)}:m)})}:p)});
      }
      const mapId=id();let editor=null;
      if(body.action==='import-map'){need(asset,'PROJECT_NEEDS_ASSETS','请先导入资产包。',409);editor=createEditor(asset.handle,body.document);}
      else{need(['empty','current'].includes(body.template),'REQUEST_SHAPE');if(asset)editor=body.template==='current'?createEditor(asset.handle,{...map.editor.getDocument(),mapId:`map.${id()}`}):blank(asset.handle,map.editor.getDocument());}
      return commit({...data,projects:data.projects.map(p=>p===project?{...p,activeMapId:mapId,maps:[...p.maps,{mapId,name:name(body.name),editor}]}:p)});
    },
    importAssets(buffer,expected){guard(expected);const {project}=current();need(!project.assetSha256,'PROJECT_ASSETS_EXIST','该项目已有素材。请新建空白项目后导入，避免覆盖现有地图。',409);
      const asset=decodeAsset(buffer);storeAsset(asset);
      return commit({...data,projects:data.projects.map(p=>p===project?{...p,assetSha256:asset.hash,maps:p.maps.map((m,i)=>({...m,editor:i===0?createEditor(asset.handle,asset.document):blank(asset.handle,asset.document)}))}:p)});
    },
    setEnvironmentAnimation(body) {
      need(exact(body, ['revision', 'assetId', 'animation']) && typeof body.assetId === 'string', 'REQUEST_SHAPE', '动画配置参数无效。', 400);
      guard(body.revision);
      const { project, asset } = current();
      need(asset, 'PROJECT_NEEDS_ASSETS', '请先为该项目导入资产包。', 409);
      return reviseAssets(project, updateEnvironmentAnimation(asset.handle, body.assetId, body.animation));
    },
    addEnvironment(candidate, expected, { background = false } = {}) {
      guard(expected);
      const project=background?data.projects.find(item=>item.projectId===candidate.projectId):current().project;
      need(project && candidate.projectId===project.projectId,'ENVIRONMENT_PROJECT_CHANGED','请切回该素材所属的项目。',409);
      const asset=project.assetSha256?getAsset(project.assetSha256):null;
      need(asset,'PROJECT_NEEDS_ASSETS','请先为该项目导入资产包。',409);
      const existing=contextFor(asset.handle).modules.get(generatedEnvironmentId(candidate.jobId));
      if(existing){
        need(existing.source.sha256===candidate.sprite.sha256 && existing.placementRole===candidate.placementRole,
          'ENVIRONMENT_ASSET_CONFLICT','同名素材的内容或分组发生变化。',409);
        return state();
      }
      need(asset.handle.bundleSha256===candidate.kitSha256,'ENVIRONMENT_KIT_CHANGED','项目素材包已更新，请重新规划生成。',409);
      const suggested=candidate.prompt?.split(/\r?\n/)[0].replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,60);
      const names=suggested&&Object.keys(project.assetNames??{}).length<1024
        ? {...project.assetNames,[generatedEnvironmentId(candidate.jobId)]:suggested} : project.assetNames;
      return reviseAssets(project, appendEnvironmentModule(asset.handle, candidate), names);
    },
    exportMap(expected){guard(expected);const {asset,map}=current();need(asset,'PROJECT_NEEDS_ASSETS','项目还没有资产包。',409);return exportSceneArchive(asset.handle,map.editor.getDocument());},
    exportProject(expected,projectId=data.activeProjectId){guard(expected);const project=data.projects.find(p=>p.projectId===projectId);need(uuid.test(projectId)&&project,'PROJECT_NOT_FOUND','项目不存在。',404);const asset=project.assetSha256?getAsset(project.assetSha256):null;const descriptor={format:'ai_scene_project_v1',project:serialized({activeProjectId:project.projectId,projects:[project]}).projects[0]};
      const files=new Map([['project.json',bytes(descriptor)],...(asset?[['assets.zip',asset.bytes]]:[])]);
      files.set('manifest.json',bytes({format:'ai_scene_project_archive_v1',files:[...files].map(([path,b])=>({path,byteLength:b.length,sha256:sha256(b)})),generationCalls:0}));return storeArchive(files);
    },
    importProject(buffer,expected){guard(expected);const files=readStoredArchive(buffer,{maxBytes:UPLOAD_LIMIT,maxEntries:3}),manifest=json(files.get('manifest.json')??Buffer.alloc(0));
      need(exact(manifest,['format','files','generationCalls'])&&manifest.format==='ai_scene_project_archive_v1'&&manifest.generationCalls===0&&Array.isArray(manifest.files));
      need(manifest.files.length===files.size-1&&files.has('project.json')&&files.has('manifest.json'));const seen=new Set();
      for(const item of manifest.files){need(exact(item,['path','byteLength','sha256'])&&['project.json','assets.zip'].includes(item.path)&&!seen.has(item.path));seen.add(item.path);const b=files.get(item.path);need(b&&b.length===item.byteLength&&sha256(b)===item.sha256,'PROJECT_CHECKSUM','项目文件校验失败。');}
      const descriptor=json(files.get('project.json'));need(exact(descriptor,['format','project'])&&descriptor.format==='ai_scene_project_v1');const p=descriptor.project;
      need(p&&((p.assetSha256===null&&!files.has('assets.zip'))||(digest.test(p.assetSha256)&&files.has('assets.zip')&&sha256(files.get('assets.zip'))===p.assetSha256)));
      if(p.assetSha256){const asset=decodeAsset(files.get('assets.zip'));storeAsset(asset);}
      const imported=validateProject(p),projectId=id(),maps=imported.maps.map(m=>({...m,mapId:id()}));const activeMapId=maps[imported.maps.findIndex(m=>m.mapId===imported.activeMapId)].mapId;
      return commit({activeProjectId:projectId,projects:[...data.projects,{...imported,projectId,maps,activeMapId}]});
    },
  };
}
