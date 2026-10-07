import {validatePanelBundle} from './panel-bundle.mjs';
import {canonicalJson,digestBytes,digestJson} from './canonical.mjs';
const utf8=text=>new TextEncoder().encode(text),jsonBytes=value=>utf8(canonicalJson(value)+'\n');
const fail=code=>{throw new Error(code);};

export async function createPanelIntegrationContract(input,core){
 const bundle=await validatePanelBundle(input,core),spec=bundle.spec,rows=spec.sections.flatMap(section=>section.rows);
 return{integrationContractVersion:'0.1',panelId:spec.id,panelSha256:bundle.sha256,specSha256:await digestJson(spec),
  fields:spec.state.map(field=>({...field,current:bundle.state[field.id],direction:field.type==='progress'?'from-game':'configured-by-game'})),
  controls:rows.map(row=>({rowId:row.id,kind:row.kind,label:row.label,...(typeof row.enabled==='boolean'?{enabled:row.enabled}:{}),
   ...(typeof row.buttonLabel==='string'?{buttonLabel:row.buttonLabel}:{}),
   ...(row.event?{event:row.event}:{}),...(row.bind?{fieldId:row.bind}:{}),...(row.action?{action:row.action}:{}),
   ...(row.kind==='input'?{input:{readOnly:row.readOnly,inputType:row.inputType,validation:row.validation}}:{})})),
  navigation:spec.tabs??null,gameBinding:{version:'0.1',status:'NOT_CONNECTED',routes:'game-binding.template.json'},
  ownership:{views:'caller',businessPort:'game',destroyOrder:['binding','view','port-if-owned']},
  runtimes:{pixi:'0.1.0',unity:'0.1.4'},nativeVerification:'NOT_RUN'};
}
function previewHtml(bundle){
 const seed=canonicalJson(bundle).replace(/</g,'\\u003c');
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>面板交付预览</title><style>*{box-sizing:border-box}html{scrollbar-gutter:stable}@supports not (scrollbar-gutter:stable){html{overflow-y:scroll}}body{margin:0;background:#10252d;color:#e5f2ef;font:15px/1.6 system-ui,sans-serif}main{max-width:1040px;margin:auto;padding:24px}header{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:20px}h1{margin:0;font-size:24px}#status{margin-left:auto;font-size:13px;color:#88d9c3}.surface{background:#17313a;border:1px solid #3b525b;border-radius:12px;overflow:hidden;padding:12px}#canvas-host{max-width:100%;width:100%}details{margin-top:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 monospace;max-height:260px;overflow:auto}.hint{font-size:13px;color:#afc5c7}@media(max-width:600px){main{padding:12px}h1{font-size:20px}#status{margin:0}header{align-items:start;flex-direction:column}}</style><main><header><h1 id="panel-title">面板交付预览</h1><span id="status" role="status">正在校验…</span></header><div class="surface"><div id="canvas-host"></div></div><p class="hint">可独立试玩。实际游戏逻辑按 integration-contract.json 的字段和事件接入。</p><details><summary>当前值</summary><pre id="state"></pre></details><details><summary>最近操作</summary><pre id="event">尚未操作</pre></details></main><script id="panel-seed" type="application/json">${seed}</script><script src="./panel-runtime.js"></script><script>
(()=>{const status=document.getElementById('status'),values=document.getElementById('state'),event=document.getElementById('event'),events=[];let host,panel,dead=false;const render=()=>{if(panel&&!dead)values.textContent=JSON.stringify(panel.getState(),null,2);};
 const destroy=()=>{if(dead)return;dead=true;host?.destroy();status.textContent='已释放';status.dataset.state='destroyed';};
 const start=async()=>{const bundle=await PanelDelivery.validateBundle(JSON.parse(document.getElementById('panel-seed').textContent));if(dead)return;host=PanelDelivery.createPixiPanelHost({onEvent:envelope=>{events.push(envelope);if(events.length>100)events.shift();event.textContent=JSON.stringify(envelope,null,2);render();window.dispatchEvent(new CustomEvent('panel:action',{detail:structuredClone(envelope)}));},onError:()=>{status.textContent='面板交互失败';status.dataset.state='error';}});panel=await host.add('preview',bundle,{container:document.getElementById('canvas-host')});if(dead){host.destroy();return;}
 document.getElementById('panel-title').textContent=bundle.spec.title;render();status.textContent='可交互预览';status.dataset.state='ready';window.panelDelivery=Object.freeze({host,panel,bundle,getState:()=>panel.getState(),setState:next=>{panel.setState(next);render();},setProgress:(id,value)=>{panel.setProgress(id,value);render();},events:()=>structuredClone(events),inspect:()=>panel.inspect(),destroy});};
 window.addEventListener('pagehide',destroy,{once:true});window.addEventListener('pageshow',event=>{if(event.persisted&&dead)location.reload();});start().catch(()=>{host?.destroy();status.textContent='面板校验或加载失败';status.dataset.state='error';});})();
</script></html>\n`.replace(/\r\n/g,'\n');
}
const readme=`# Panel delivery 0.1\n\nOpen pixi/index.html after extracting the whole ZIP. It runs offline with the bundled Pixi adapter and embedded PNGs. pixi/panel.bundle.json can be opened in Panel Studio again. Current values and authored defaults are stored separately; reset uses the authored defaults.\n\nUse PanelDelivery.createPixiPanelHost and attachPanelGameBinding with your explicit game port. Fields and events are listed in integration-contract.json. game-binding.template.json has no business routes: configure and validate them against this exact panel SHA before attaching. Changing a display label does not select a game action. Required input validation and declared submit/reset scopes still apply.\n\nUnity: unity/ is a verified-source import kit, not an already generated Prefab or .unitypackage. It requires Unity 6, UGUI 2.0, a project font and a scene-owned EventSystem. Read unity/README.md. Runtime lives once under Assets/PanelHarness/Runtime; use independent Panels/<panelId> folders. Its exact source identity is unity/unity-runtime.json. Install the optional shared game SDK separately once. Preflight native deliveries with check-unity-install before reimport; browser export does not inspect your project or certify a native import.\n\nNo model call, network, storage or business action occurs during export. The game owns its business port and data. Dispose the binding before destroying its view. A closed view retains state; ports and external effects have their own owners. This is a workspace development artifact, not a tagged production release.\n`;

/** Complete deterministic, browser-neutral byte producer. Native gates stay NOT_RUN. */
export async function createPanelDelivery(input,core,{runtime,unityKit}){
 const bundle=await validatePanelBundle(input,core),id=bundle.spec.id;
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)||id.endsWith('.')||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(id))fail('DELIVERY_PANEL_ID');
 if(runtime?.version!=='0.1.0'||typeof runtime.code!=='string'||!runtime.code.length||typeof runtime.notices!=='string'||await digestBytes(utf8(runtime.code))!==runtime.sha256)fail('DELIVERY_RUNTIME_INTEGRITY');
 if(!(unityKit?.contents instanceof Map)||unityKit.manifest?.panelSha256!==bundle.sha256||unityKit.manifest?.status!=='COMPLETE'||unityKit.manifest?.verification?.sourceBundle!=='PASS')fail('DELIVERY_UNITY_SOURCE');
 if(unityKit.contents.size!==unityKit.manifest.files.length+1)fail('DELIVERY_UNITY_INTEGRITY');
 for(const file of unityKit.manifest.files){const bytes=unityKit.contents.get(file.path);if(!(bytes instanceof Uint8Array)||bytes.length!==file.bytes||await digestBytes(bytes)!==file.sha256)fail('DELIVERY_UNITY_INTEGRITY');}
 if(canonicalJson(JSON.parse(new TextDecoder().decode(unityKit.contents.get('panel.bundle.json'))))!==canonicalJson(bundle))fail('DELIVERY_UNITY_SOURCE');
 if(canonicalJson(JSON.parse(new TextDecoder().decode(unityKit.contents.get('export-manifest.json'))))!==canonicalJson(unityKit.manifest))fail('DELIVERY_UNITY_INTEGRITY');
 const contract=await createPanelIntegrationContract(bundle,core),contents=new Map([
  ['README.md',utf8(readme)],['panel.spec.json',jsonBytes(bundle.spec)],['integration-contract.json',jsonBytes(contract)],
  ['game-binding.template.json',jsonBytes({gameBindingVersion:'0.1',panelId:id,panelSha256:bundle.sha256,states:[],commands:[]})],
  ['pixi/index.html',utf8(previewHtml(bundle))],['pixi/panel-runtime.js',utf8(runtime.code)],['pixi/panel.bundle.json',jsonBytes(bundle)],['pixi/THIRD_PARTY_NOTICES.txt',utf8(runtime.notices)],
 ]);
 for(const resource of bundle.componentBundle.resources){const binary=atob(resource.base64);contents.set('pixi/'+resource.path,Uint8Array.from(binary,char=>char.charCodeAt(0)));}
 for(const [path,bytes]of unityKit.contents)contents.set('unity/'+path,new Uint8Array(bytes));
 const manifest={panelDeliveryVersion:'0.1',status:'COMPLETE',panelId:id,panelSha256:bundle.sha256,specSha256:contract.specSha256,
  runtimeSha256:runtime.sha256,targets:['pixi','unity-ugui-import-kit'],modelCalls:0,productionRelease:false,
  verification:{sourceBundle:'PASS',assetClosure:'PASS',browser:'NOT_RUN',unityImport:'NOT_RUN',nativeInteraction:'NOT_RUN',businessBinding:'NOT_CONNECTED'},
  files:await Promise.all([...contents].sort(([a],[b])=>a<b?-1:a>b?1:0).map(async([path,bytes])=>({path,bytes:bytes.length,sha256:await digestBytes(bytes)})))};
 contents.set('delivery-manifest.json',jsonBytes(manifest));return{contents,manifest,panelId:id};
}
