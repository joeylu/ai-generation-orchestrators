import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {build} from 'esbuild';
import {editorData} from '../src/panel/data.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {loadActionRun} from '../src/panel/action-model.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {verifySkinPackage,hash,json,bindingsOf} from '../src/skins/package.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {referenceActionConfig} from '../src/panel/reference-presets.mjs';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
const {values}=parseArgs({options:{package:{type:'string'},out:{type:'string'},run:{type:'string',multiple:true},aliases:{type:'string'},examples:{type:'string'},orientation:{type:'string'}}});
if(values.run&&values.examples)throw Error('Cannot mix model runs and offline examples');
if(!values.package||!values.out)throw Error('Use --package <pack> --out <work-directory>');
const root=fileURLToPath(new URL('../',import.meta.url)),out=resolve(values.out),r=relative(join(root,'work'),out);
if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Output must be in work/');
const verified=await verifySkinPackage(resolve(values.package)),{pack,resources,manifestSha256}=verified;
if(pack.sourceKind!=='imported')throw Error('Select a real imported skin.');
const expected=bindingsOf(await readContracts(defaults));
if(Object.keys(expected).some(k=>expected[k]!==pack.bindings[k]))throw Error('Skin contracts differ from current panel compiler.');
const data=await editorData(),ctx={orientation:values.orientation,registry:data.registry,usage:data.usage,template:data.template,canvases:data.canvases,profile:pack.theme,...settingsSkinGeometry(pack),binding:{sourceKind:'imported',sha256:manifestSha256}};
const config=JSON.parse(await readFile(join(root,'configs/action-presets.json'))),examples=JSON.parse(await readFile(values.examples?resolve(values.examples):join(root,'examples/action-presets.json'))),catalog=JSON.parse(await readFile(join(root,'../ui-panel-harness/examples/modern-all-components.catalog.json')));
const presets=[],fixtures=[],evidence=[],presetConfigs={};
if(values.run){
  const aliases=JSON.parse(await readFile(values.aliases?resolve(values.aliases):join(root,"configs/planning-skin-aliases.json")));
  for(const directory of values.run){const saved=JSON.parse(await readFile(join(resolve(directory),'content.json')));const runConfig=saved.presetId?.startsWith('sdk-')?referenceActionConfig(config,saved.presetId):saved.presetId==='custom'?customActionConfig(config):config;const instructions=await readFile(join(root,saved.presetId==='custom'?'prompts/custom-panel-planner.md':'prompts/action-planner.md'),'utf8');const loaded=await loadActionRun(resolve(directory),{config:runConfig,pack,manifestSha256,aliases,instructions,ctx});presets.push(loaded.preset);evidence.push(loaded.evidence);presetConfigs[saved.presetId]=runConfig;}
  if(new Set(presets.map(p=>p.content.presetId)).size!==presets.length)throw Error("Duplicate preset");
}else
for(const example of examples){const fixtureConfig=example.presetId==='custom'?customActionConfig(config):config;const fixture=await actionFixture(example,catalog,fixtureConfig);fixtures.push(fixture);presets.push(await actionPresetFromIntent(fixture.session,fixture.intent,fixtureConfig,example.presetId,ctx));presetConfigs[example.presetId]=fixtureConfig;}
if(values.orientation&&presets.some(p=>Object.keys(p.documents).length!==1||!p.documents[values.orientation]))throw Error('PANEL_ORIENTATION_MISMATCH');
const packet={manifest:(await readFile(join(resolve(values.package),'skin-pack.json'))).toString('base64'),manifestSha256,bindings:expected,resources:Object.fromEntries([...resources].filter(([f])=>!f.startsWith('sources/')).map(([f,b])=>[f,b.toString('base64')]))};
const bundle=await build({entryPoints:[join(root,'src/panel/action-preview.mjs')],bundle:true,write:false,format:'esm'});
const payload=JSON.stringify({ctx,presets,source:values.run?"model-response":"offline-fixtures",pack:packet}).replaceAll('<','\\u003c');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>面板预览</title><style>body{margin:0;background:#16261f;color:#f2e4c6;font:15px system-ui}nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px}button{background:#ead4a5;border:0;border-radius:6px;color:#48270d;padding:9px 14px;cursor:pointer}p{margin:0;padding:0 14px 12px;color:#c1cdbf}#stage{display:flex;justify-content:center}canvas{display:block;max-width:100%;height:auto;max-height:none}</style><nav><button id="confirmation">确认弹窗</button><button id="form">简单表单</button><button id="wide">横版 16:9</button><button id="tall">竖版 9:16</button><button id="reopen">重新打开</button><button id="export">导出面板与行为 JSON</button><span id="status"></span></nav><p>${values.run?"真实模型结果候选":"离线结构化示例"}，复用真实皮肤。提交只发出本地事件；导出保留初始配置与行为，不包含试玩数据。</p><div id="stage"></div><script type="module">${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}\nawait initializeActions(${payload});</script></html>`;
const dir=join(out,randomUUID());await mkdir(dir,{recursive:true});
const files=[];for(const[file,bytes]of [['text-readability.json',json({...verified.textReadability,manifestSha256})],['preview.html',html],['presets.json',json(presets)],['fixtures.json',json(fixtures)],['config.json',json(config)],['preset-configs.json',json(presetConfigs)]]){await writeFile(join(dir,file),bytes,{flag:'wx'});files.push({file,sha256:hash(Buffer.from(bytes))});}
await writeFile(join(dir,'report.json'),json({kind:'action-panel-preview',source:values.run?'model-response':'offline-fixtures',evidence,manifestSha256,files,visualAcceptance:'unreviewed',productionReady:false}),{flag:'wx'});
console.log(dir);
