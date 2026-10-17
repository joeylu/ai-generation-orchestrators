import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep,parse} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {build} from 'esbuild';
import {editorData} from '../src/panel/data.mjs';
import {inventoryPreset,inventoryPresetContext,validateInventoryConfig,inventoryGrid} from '../src/panel/inventory-preset.mjs';
import {verifySkinPackage,hash,json,bindingsOf} from '../src/skins/package.mjs';
import {panelSkinContracts} from '../src/panel/skin-contracts.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
import {deriveTextReadability} from '../src/skins/text-readability.mjs';
import {decodePng} from '../src/skins/png.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
async function outputDirectory(value){
  if(typeof value!=='string'||!value)fail('INVENTORY_OUTPUT_REQUIRED','请指定 work 内的仓库预览输出目录。');
  const path=resolve(value),rel=relative(join(root,'work'),path);
  if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))fail('INVENTORY_OUTPUT_BOUNDARY','仓库预览只能写入 Harness 的 work 子目录。');
  const base=parse(path).root;let current=base;
  for(const part of path.slice(base.length).split(/[\\/]/).filter(Boolean)){
    current=join(current,part);
    try{const stat=await lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())fail('INVENTORY_OUTPUT_LINK','仓库预览目录不能包含链接或普通文件。');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return path;
}

// A deterministic producer. It verifies the selected frozen skin/contracts and
// creates a fresh immutable preview; it never creates a model plan or receipt.
export async function createInventoryPreview({packageDirectory,out,orientation,contractsDirectory,title,configFile,expectedConfigSha256,columns,rows}={}){
  const output=await outputDirectory(out);
  if(!packageDirectory||!['landscape','portrait'].includes(orientation))fail('INVENTORY_ARGUMENTS','请指定皮肤包和唯一的横版或竖版画布。');
  const configBytes=await readFile(configFile?resolve(configFile):join(root,'configs/inventory-panel.json'));
  const configSha256=hash(configBytes);
  if(expectedConfigSha256!==undefined&&configSha256!==expectedConfigSha256)fail('INVENTORY_CONFIG_CHANGED','仓库配置已改变，请重新创建计划。');
  const config=validateInventoryConfig(JSON.parse(configBytes));
  const grid=columns===undefined&&rows===undefined?{}:{columns,rows};inventoryGrid(config,grid);
  const packagePath=resolve(packageDirectory),verified=await verifySkinPackage(packagePath),{pack,resources,manifestSha256}=verified;
  if(pack.sourceKind!=='imported')fail('INVENTORY_SKIN_REQUIRED','请选择已核验的真实皮肤组件包。');
  const contracts=await panelSkinContracts(pack,contractsDirectory),data=await editorData(contracts);
  // Legacy packages may have one palette ink for both light and dark assets.
  // Select this new heading's ink from verified panel pixels; keep the frozen
  // skin/profile and its original readability report unchanged.
  const images=new Map(pack.assets.map(asset=>[asset.assetId,decodePng(resources.get(asset.file))]));
  const headingReadability=deriveTextReadability(pack,images,{preserve:false});
  const headingColor=headingReadability.inks['skin.surface.panel'];
  const ctx=inventoryPresetContext({orientation,registry:data.registry,usage:data.usage,template:data.template,canvases:data.canvases,profile:pack.theme,inventoryHeadingColor:headingColor,...settingsSkinGeometry(pack),binding:{sourceKind:'imported',sha256:manifestSha256}});
  const preset=inventoryPreset(ctx,config,title,grid);
  const packet={manifest:(await readFile(join(packagePath,'skin-pack.json'))).toString('base64'),manifestSha256,bindings:bindingsOf(contracts),resources:Object.fromEntries([...resources].filter(([file])=>!file.startsWith('sources/')).map(([file,bytes])=>[file,bytes.toString('base64')]))};
  const bundle=await build({absWorkingDir:root,entryPoints:[join(root,'src/panel/action-preview.mjs')],bundle:true,write:false,format:'esm'});
  const payload=JSON.stringify({ctx,presets:[preset],source:'offline-fixtures',pack:packet}).replaceAll('<','\\u003c');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>仓库面板预览</title><style>body{margin:0;background:#16261f;color:#f2e4c6;font:15px system-ui}nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px}button{background:#ead4a5;border:0;border-radius:6px;color:#48270d;padding:9px 14px;cursor:pointer}p{margin:0;padding:0 14px 12px;color:#c1cdbf}#stage{display:flex;justify-content:center}canvas{display:block;max-width:100%;height:auto;max-height:none}</style><nav><button id="confirmation">确认弹窗</button><button id="form">简单表单</button><button id="wide">横版 16:9</button><button id="tall">竖版 9:16</button><button id="reopen">重新打开</button><button id="export">导出面板与行为 JSON</button><span id="status"></span></nav><p>示例库存 · ${preset.content.columns} 列 × ${preset.content.rows} 行，含 ${config.items.length} 件物品。图标为示意图；支持选中与详情查看，未连接游戏库存。</p><div id="stage"></div><script type="module">${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}\nawait initializeActions(${payload});</script></html>`;
  const values={'text-readability.json':json({...verified.textReadability,manifestSha256}),'inventory-colors.json':json({kind:'ui_inventory_heading_ink',version:'1.0',manifestSha256,nodeId:'inventory-heading',textColor:headingColor,evidence:headingReadability.report.checks.filter(check=>check.role==='skin.surface.panel'),visualAcceptance:'unreviewed'}),'preview.html':html,'presets.json':json([preset]),'config.json':configBytes,'content.json':json(preset.content),[orientation+'.panel.json']:json(preset.documents[orientation])};
  // Recheck ancestors immediately before creating the exclusive fresh UUID.
  await outputDirectory(output);await mkdir(output,{recursive:true});await outputDirectory(output);
  const directory=join(output,randomUUID());await mkdir(directory);
  const files=[];
  for(const [file,value]of Object.entries(values)){
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
    await writeFile(join(directory,file),bytes,{flag:'wx'});files.push({file,sha256:hash(bytes)});
  }
  await writeFile(join(directory,'report.json'),json({kind:'action-panel-preview',source:'offline-fixtures',builder:'deterministic-inventory',modelCalls:0,presetId:'inventory',orientation,columns:preset.content.columns,rows:preset.content.rows,samplePlacement:preset.content.samplePlacement,configSha256,evidence:[],manifestSha256,files,visualAcceptance:'unreviewed',productionReady:false}),{flag:'wx'});
  return directory;
}

if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{package:{type:'string'},out:{type:'string'},orientation:{type:'string'},contracts:{type:'string'},title:{type:'string'},config:{type:'string'},'config-sha256':{type:'string'},columns:{type:'string'},rows:{type:'string'}}});
    const integer=value=>{if(value===undefined)return undefined;if(!/^[1-9][0-9]*$/.test(value))fail('inventory.grid','列数与行数须为 1–10 之间的整数。');return Number(value);};
    console.log(await createInventoryPreview({packageDirectory:values.package,out:values.out,orientation:values.orientation,contractsDirectory:values.contracts,title:values.title,configFile:values.config,expectedConfigSha256:values['config-sha256'],columns:integer(values.columns),rows:integer(values.rows)}));
  }catch(error){console.error(JSON.stringify({status:'FAILED',code:/^[A-Za-z0-9_.-]+$/.test(error.code??error.message)?error.code??error.message:'INVENTORY_PREVIEW_FAILED'}));process.exitCode=1;}
}
