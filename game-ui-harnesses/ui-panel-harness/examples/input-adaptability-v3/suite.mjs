import {INPUT_ADAPTABILITY_CASES} from '../input-adaptability-v1/suite.mjs';
import {INPUT_ADAPTABILITY_REPAIR_CASES} from '../input-adaptability-v2/suite.mjs';
const copy=(suite,from,id,text)=>{
  const item=structuredClone(suite.find(item=>item.id===from));
  return {...item,id,priorCaseId:from,request:{...item.request,id,...(text?{text}:{})}};
};
export const INPUT_CAPABILITY_CASES=[
  copy(INPUT_ADAPTABILITY_REPAIR_CASES,'R03','C01'),
  copy(INPUT_ADAPTABILITY_REPAIR_CASES,'R02','C02'),
  copy(INPUT_ADAPTABILITY_REPAIR_CASES,'R03','C03','标题“输入验收”。按顺序仅放两项：Input标签“玩家名”，单行文本，初始“小蓝莓”，占位“请输入角色名”，必填，最小长度2、最大长度12，可编辑且启用；Image标签“角色头像”，绑定库中的战士肖像，高128宽填满，完整等比显示。'),
  copy(INPUT_ADAPTABILITY_REPAIR_CASES,'R03','C04','Title: “输入验收”. Exactly two enabled rows in this order: a single-line text Input labelled “玩家名”, initial “小蓝莓”, placeholder “请输入角色名”, editable, required, minimum length 2 and maximum length 12; an Image labelled “角色头像” using the catalog warrior portrait, height 128, fill width, contain fit. No other content.'),
  copy(INPUT_ADAPTABILITY_REPAIR_CASES,'R06','C05'),
  copy(INPUT_ADAPTABILITY_CASES,'G13','C06'),
  copy(INPUT_ADAPTABILITY_CASES,'G12','C07'),
  {id:'C08',operation:'generate',category:'conflicting-input-lengths',request:{requestVersion:'0.1',id:'C08',target:'pixi',text:'标题“输入验收”。仅一个Input，标签“名字”，初始为空，占位为空，单行文本，可编辑且启用，必填，最少12个字符且最多2个字符。两个长度都必须满足；如果冲突先问我，不要自行修改。'},clarification:{question:'最少12与最多2冲突，请确认需要的最小和最大长度。',questionPattern:'冲突|矛盾|12.*2|2.*12'}},
];
