import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,json} from '../skins/package.mjs';
import {validateInventoryConfig,inventoryGrid as presetGrid} from '../panel/inventory-preset.mjs';

const fail=()=>{throw Object.assign(new Error('仓库预设计划或组件版本已变化，请重新创建面板。'),{code:'PANEL_INVENTORY_PLAN_CHANGED'});};
export function inventoryTitle(value,defaultTitle='仓库（示例）'){
  if(typeof value!=='string'||value.trim().length>40||/[\u0000-\u001f\u007f]/.test(value))throw Object.assign(new Error('仓库预设的输入仅用于标题，最多 40 个字符；请在自定义面板填写其他需求。'),{code:'PANEL_INVENTORY_TITLE'});
  return value.trim()||defaultTitle;
}
async function contracts(directory){
  return Object.fromEntries(await Promise.all(['registry','usage','template'].map(async key=>[key,hash(await readFile(join(directory,key+'.json')))])));
}
export function inventoryGrid(columns,rows,config){
  try{
    const grid=presetGrid(config,columns===undefined&&rows===undefined?{}:{columns,rows});
    return {columns:grid.columns,rows:grid.rows};
  }catch{throw Object.assign(new Error('仓库行列数须为 1–10 的整数，总格数不能少于示例物品数量；旧计划保留原行列。'),{code:'PANEL_INVENTORY_GRID'});}
}
export async function prepareInventoryPlan({root,directory,contractsDirectory,skinSha256,orientation,title,columns,rows}){
  if(!['landscape','portrait'].includes(orientation)||!/^[a-f0-9]{64}$/.test(skinSha256)||!contractsDirectory)fail();
  const configBytes=await readFile(join(root,'configs/inventory-panel.json'));
  const config=validateInventoryConfig(JSON.parse(configBytes));
  const grid=inventoryGrid(columns,rows,config);
  const plan={kind:'ui_inventory_preset_plan',version:'1.1',presetId:'inventory',builder:'deterministic-inventory',title:inventoryTitle(title,config.defaultTitle),...grid,orientation,skinSha256,configSha256:hash(configBytes),contracts:await contracts(contractsDirectory)};
  const sha256=hash(json(plan));
  await writeFile(join(directory,'inventory-config.json'),configBytes,{flag:'wx'});
  const path=join(directory,'inventory-plan.json');
  await writeFile(path,json({...plan,sha256}),{flag:'wx'});
  return {sha256,plan:path,...grid};
}
export async function verifyInventoryPlan({planFile,directory,contractsDirectory,skinSha256,orientation,sha256}){
  try{
    const saved=JSON.parse(await readFile(planFile)),{sha256:stored,...plan}=saved;
    if(plan.kind!=='ui_inventory_preset_plan'||!['1.0','1.1'].includes(plan.version)||plan.presetId!=='inventory'||plan.builder!=='deterministic-inventory'||stored!==sha256||hash(json(plan))!==sha256||plan.skinSha256!==skinSha256||plan.orientation!==orientation||inventoryTitle(plan.title)!==plan.title)fail();
    const actual=await contracts(contractsDirectory);
    if(Object.keys(plan.contracts??{}).length!==3||Object.keys(actual).some(key=>actual[key]!==plan.contracts[key]))fail();
    const configFile=join(directory,'inventory-config.json'),configBytes=await readFile(configFile);
    if(hash(configBytes)!==plan.configSha256)fail();
    const config=validateInventoryConfig(JSON.parse(configBytes));
    if(plan.version==='1.1'&&(!Object.hasOwn(plan,'columns')||!Object.hasOwn(plan,'rows')))fail();
    const grid=inventoryGrid(plan.columns,plan.rows,config);
    return {...plan,...grid,configFile};
  }catch{fail();}
}
