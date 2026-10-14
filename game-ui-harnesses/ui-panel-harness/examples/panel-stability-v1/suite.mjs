import {COMMON_GAME_PANEL_CASES,commonGamePanelFixture} from '../common-game-panels-v1/suite.mjs';
export const STABILITY_SOURCE_PLAN_SHA256='fea352a19cbe57d0e1b3647b118e1abebd247bcd7e13b3859f8eecc1d14b5ecd';
export const PANEL_STABILITY_GROUPS=[
  {purpose:'settings',sourceCaseId:'G03',title:'设置',request:'帮我做个设置面板',variant:'设置页来一个'},
  {purpose:'pause',sourceCaseId:'G05',title:'暂停',request:'做个暂停面板',variant:'弄个暂停菜单'},
  {purpose:'inventory',sourceCaseId:'G22',title:'背包',request:'做个背包面板',variant:'整个背包页'},
  {purpose:'lobby',sourceCaseId:'G02',title:'大厅',request:'做个游戏大厅',variant:'游戏大厅来一个'},
  {purpose:'character-select',sourceCaseId:'G17',title:'角色选择',request:'做个角色选择面板',variant:'弄个选角色界面'},
  {purpose:'mail-detail',sourceCaseId:'G45',title:'邮件详情',request:'做个邮件详情面板',variant:'做个邮件阅读页'},
  {purpose:'login',sourceCaseId:'G49',title:'登录',request:'做个游戏登录面板',variant:'弄个登录页'},
  {purpose:'exit-confirmation',sourceCaseId:'G54',title:'退出确认',request:'做个退出游戏确认框',variant:'做个退出确认弹窗'},
];
// Interleaved independent rounds. Three repeats are planned samples, never retries.
export const PANEL_STABILITY_SUITE=Array.from({length:4},(_,round)=>PANEL_STABILITY_GROUPS.map((group,index)=>{
  const item=structuredClone(COMMON_GAME_PANEL_CASES.find(item=>item.id===group.sourceCaseId));
  item.id='S'+String(round*8+index+1).padStart(2,'0');item.category=group.title;
  item.request={...item.request,id:item.id,text:round===3?group.variant:group.request};
  item.stability={purpose:group.purpose,round:round+1,inputKind:round===3?'COLLOQUIAL_VARIANT':'EXACT_TEXT_REPEAT',sourceCaseId:group.sourceCaseId};
  item.reference.title=group.title;
  if(group.purpose==='login'){
    const rows=item.reference.rows,indices=rows.flatMap((row,i)=>row.kind==='input'?[i]:[]);
    for(const i of indices)rows[i].required=true;
    const login=rows.find(row=>row.kind==='button'&&row.label==='登录');login.action='submit';login.submitRows=indices;
  }
  return item;
})).flat();
export const panelStabilityFixture=commonGamePanelFixture;
