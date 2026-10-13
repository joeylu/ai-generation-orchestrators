/** Fresh finite repair cohort. Previous failures remain unchanged in their original run. */
import {INPUT_ADAPTABILITY_CASES} from '../input-adaptability-v1/suite.mjs';
import {oldRows,newRows} from '../all-components-v1/fixture.mjs';

const ready=(id,category,text,rows,extra={})=>({id,operation:'generate',category,
  request:{requestVersion:'0.1',id,target:'pixi',text},reference:{title:'输入验收',rows:structuredClone(rows),...extra}});
const rerun=(sourceId,id,category)=>{
  const source=structuredClone(INPUT_ADAPTABILITY_CASES.find(item=>item.id===sourceId));
  return {...source,id,category,request:{...source.request,id},priorCaseId:sourceId};
};
const input=oldRows.find(row=>row.kind==='input'),image=oldRows.find(row=>row.kind==='image'),text=oldRows.find(row=>row.kind==='text');
const list={...structuredClone(newRows[2]),options:Array.from({length:64},(_,i)=>({label:'物品'+(i+1),initial:i===0}))};
const defaultLayout={width:null,canvasWidth:null,canvasHeight:null,maxHeight:null};

export const INPUT_ADAPTABILITY_REPAIR_CASES=[
  rerun('G10','R01','original-G10-exact-request'),
  ready('R02','quoted-descriptors-preserved','标题“输入验收”，严格只有以下两项，依次排列。Input 的标签逐字为“角色名单”，单行文本，初始“小蓝莓”，占位“请输入角色名”，必填最少2最多12，可编辑、启用；Image 的标签逐字为“验证纹理图片”，绑定库中的战士肖像，宽填满，高128，完整等比显示。明确名称中的“单”和“图片”都是文案的一部分，不要删除。',
    [{...input,label:'角色名单'},{...image,label:'验证纹理图片'}]),
  ready('R03','new-unquoted-name-boundaries','标题“输入验收”。按顺序放玩家名单行文字输入，初始小蓝莓，占位请输入角色名，必填最少2最多12，可编辑、启用；角色头像图片绑定库中的战士肖像，高128宽填满，完整等比显示。仅这两项，不添加其他内容。',
    [{...input,label:'玩家名'},{...image,label:'角色头像'}]),
  ready('R04','quoted-type-words-are-literal','标题“输入验收”。只要两项，按顺序放：CheckBox 标签逐字为“Dialog”，默认不勾选、启用；只读 Text 标签为“术语”，正文逐字为“List”。这两个引号内的词仅是显示文案，不是要求生成同名类型；不要其他业务内容。',
    [{...newRows[0],label:'Dialog'},{...text,label:'术语',text:'List'}]),
  ready('R05','superseded-component-exclusion','标题“输入验收”。原先说要 List 背包。更正：不需要 List，也不要背包；最终只有 CheckBox“提示”，默认不勾选、启用。不要根据旧方案追问物品或增加列表。',
    [newRows[0]]),
  rerun('G01','R06','all-sixteen-unchanged-control'),
  ready('R07','list64-default-canvas','标题“输入验收”。只有启用的 List“背包”，文字选项严格按以下顺序：'+list.options.map(option=>'“'+option.label+'”').join('、')+'。默认物品1，每项40高，可见4项，可滚动并单选。画布和面板不指定尺寸，使用目录的默认测量策略；不添加其他内容。',
    [list],{layout:defaultLayout,maxCanvasHeight:700}),
  ready('R08','tall-dialog-default-canvas','标题“输入验收”。只有独立模态 Dialog，初始关闭、启用，打开按钮“打开说明”，标题“说明”，正文逐字为“确认后继续操作。”，关闭按钮“关闭”。弹窗宽400高1024。画布和面板不指定尺寸，使用目录的默认测量策略并完整容纳弹窗，不添加其他业务内容。',
    [{...newRows[3],dialogHeight:1024}],{layout:defaultLayout,minCanvasHeight:1024,maxCanvasHeight:1200}),
];
