import defaults from '../../configs/inventory-panel.json' with {type:'json'};
import {assertInventoryGridLimits} from '../runtime/inventory-policy.mjs';

export const inventoryModelChoice=Object.freeze({
  id:'inventory',name:'仓库面板',group:'inventory',groupName:'仓库面板',variant:'物品仓库',builder:'model-inventory',
  defaultColumns:defaults.columns,defaultRows:defaults.rows,minimumCapacity:1,
  description:'AI 根据需求输出仓库标题、物品内容、数量和初始选择。默认 5 列 4 行，行列各 1–32、合计最多 144 格；固定格子大小，空间不足时双向滚动。未提供物品时创建空仓库，未绑定物品图集时以名称展示，支持选中详情，暂不支持拖换、多格占用或游戏存档。',
});
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function inventoryModelGrid(columns,rows){
  if(columns===undefined&&rows===undefined)return {columns:defaults.columns,rows:defaults.rows};
  try{assertInventoryGridLimits({columns,rows});}catch{fail('PANEL_INVENTORY_GRID');}
  return {columns,rows};
}
export function inventoryModelRequest(text,grid){
  if(typeof text!=='string'||text.length>4000)fail('PANEL_REQUEST_INVALID');
  const chosen=inventoryModelGrid(grid.columns,grid.rows);
  return {text:'创建仓库面板，使用上游 inventory 行输出结构化方案。用户已在 Studio 选择 '+chosen.columns+' 列 × '+chosen.rows+' 行，共 '+chosen.columns*chosen.rows+' 格，须原样保留。画布比例已由程序固定，不追问比例。\n'
    +'根据用户需求设计标题、物品名称、数量、槽位和初始选择；未提供物品数据时必须输出空仓库 items:[]，未指定初始选择时 selectedSlot 为 null；只有用户明确请求示例物品时才可设计示例，并在标题标明示例。除非用户明确指定槽位，物品从左到右逐行连续放置，空位留后。用户明确给出的物品和数量不得丢失，容量不足或需要不支持的业务规则时提出具体问题。未提供物品图集，不得编造图标资产，item.icon 为 null，以名称展示；实际格子尺寸、间距、安全区由冻结的 consumer 约束提供，保持固定格子并由程序处理双向滚动。\n用户补充需求：\n'+(text.trim()||'创建所选默认格位的空仓库，不添加示例物品。')};
}
