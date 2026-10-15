import {motionSelection} from '../src/panel/motion-profile.mjs';
// Offline UX acceptance server. All model and pipeline operations are in-memory test doubles.
import {fileURLToPath} from 'node:url';
import {readSafe} from '../src/skins/package.mjs';
import {studioSnapshot} from '../src/studio/catalog.mjs';
import {studioStyles} from '../src/studio/styles.mjs';
import {studioPanelPresets} from '../src/studio/panel-presets.mjs';
import {studioServer} from '../src/studio/tasks.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),port=Number(process.argv[2]||4211);
const config=JSON.parse(await readSafe(root,'work/studio/project.json'));
// Optional checked candidate for validating a runtime update in the same UX flow.
if(process.argv[3])config.artifacts.find(x=>x.type==='components').directory=process.argv[3];
const snapshot=await studioSnapshot(root,config);await studioStyles(root,snapshot);
studioPanelPresets(snapshot);
const component=snapshot.items.find(x=>x.type==='components'),panel=snapshot.items.find(x=>x.type==='panel');
const image=snapshot.files.get('styles/pixel-cartoon.png');for(let i=1;i<=4;i++)snapshot.files.set('fixture-S0'+i+'.png',image);
let project=null,fullCalls=0,panelCalls=0,localCalls=0;
const finish=()=>{project.busy=false;project.phase='components-ready';project.processingFinishedAt=new Date().toISOString();project.task.nodes.forEach(n=>n.status='passed');project.message='离线夹具：组件完成';project.skin={artifactId:component.id,url:component.url,version:'f'.repeat(64),downloads:component.downloads,thumbnails:[]};};
const processLocal=()=>{
 project.generationRunning=false;project.batchReady=true;project.state.operation='finished';project.busy=true;project.phase='processing';project.processingStartedAt=new Date().toISOString();localCalls++;
 project.task={nodes:[...['source-s01','source-s02','source-s03','source-s04'].map(id=>({id,kind:'source',status:'passed'})),...['locate','metadata','content-insets','postprocess'].map(id=>({id,kind:id,status:'waiting'}))]};
 for(const [i,id]of ['locate','metadata','content-insets'].entries())setTimeout(()=>{project.task.nodes.find(n=>n.id===id).status='passed';},900*(i+1));
 setTimeout(finish,4000);
};
const generation={async action(action,data){if(!project||data.id!==project.generationId)throw Error('UNKNOWN');if(action==='status')return project.state;if(action==='preflight')return {token:'fixture-token'};if(action==='start'){if(fullCalls||data.token!=='fixture-token'||data.confirmed!==project.batchSha256)throw Error('CONFIRMATION');fullCalls++;project.generationRunning=true;project.state.fresh=false;project.state.operation='running';project.state.nodes.forEach((n,i)=>{n.status='indeterminate';n.outcomeRecorded=false;n.submittedAt=new Date().toISOString();setTimeout(()=>{n.status='received';n.outcomeRecorded=true;n.receivedAt=new Date().toISOString();n.preview='/fixture-'+n.sheetId+'.png';if(i===3)processLocal();},500*(i+1));});return {operation:'running'};}throw Error('UNSUPPORTED');}};
const pipeline={async action(action,data){if(action==='status')return project;if(action==='component-motion'){if(!project.skin||data.expectedSkinSha256!==project.skin.version)throw Error('INVALID');project.skin.motion={...motionSelection(data.style,'components'),skinSha256:project.skin.version};return {motion:project.skin.motion};}if(action==='panel-motion'){const job=project.panels.find(j=>j.id===data.panelId);if(!job||job.status!=='ready'||job.deletedAt||job.sha256!==data.expectedSha256)throw Error('INVALID');job.motion=motionSelection(data.style);return {status:'saved',motion:job.motion};}if(action==='panel-delete'||action==='panel-restore'){const job=project.panels.find(j=>j.id===data.panelId);if(!job||job.status==='running'||job.sha256!==data.expectedSha256)throw Error('INVALID');if(action==='panel-delete')job.deletedAt=new Date().toISOString();else delete job.deletedAt;return {status:job.deletedAt?'deleted':'restored'};}if(action==='panel-prepare'){if(!project.skin)throw Error('NOT_READY');const job={id:'fixture-panel',kind:data.kind,text:data.text,orientation:data.orientation,canvasSelection:true,skinVersion:project.skin.version,sha256:'e'.repeat(64),status:'prepared'};project.panels.push(job);return job;}if(action==='panel-start'){const job=project.panels.find(j=>j.id===data.panelId);if(!job||job.status!=='prepared'||data.confirmed!==job.sha256)throw Error('CONFIRMATION');panelCalls++;job.status='running';job.stage='planning';job.startedAt=new Date().toISOString();setTimeout(()=>job.stage='rendering',700);setTimeout(()=>job.stage='publishing',1400);setTimeout(()=>{job.status='ready';job.stage='ready';job.finishedAt=new Date().toISOString();job.artifact=panel;job.url=panel.url;job.downloads=panel.downloads;},2000);return {status:'started'};}throw Error('UNSUPPORTED');}};
const planner=async({project:p})=>{project={id:'offline-ux-project',generationId:'offline-generation',batchSha256:'d'.repeat(64),name:p.name,description:p.description,current:true,automaticProcessing:true,phase:'not-started',state:{fresh:true,operation:'idle',nodes:['S01','S02','S03','S04'].map(sheetId=>({sheetId,status:'awaiting-authorization'}))},panels:[],reference:'/styles/'+(p.style?.id??'pixel-cartoon')+'.png'};return {generationId:project.generationId,batchSha256:project.batchSha256,sheets:project.state.nodes};};
const server=studioServer(snapshot,port,async()=>[],undefined,planner,generation,async()=>({plans:project?[project]:[]}),pipeline,async()=>({projects:project?[project]:[],truncated:false}));
server.prependListener('request',(req)=>{if(req.url==='/library.json')snapshot.files.set('fixture-counts.json',Buffer.from(JSON.stringify({fullCalls,panelCalls,localCalls})));});
server.listen(port,'127.0.0.1',()=>console.log('Offline fixture: http://127.0.0.1:'+port));
