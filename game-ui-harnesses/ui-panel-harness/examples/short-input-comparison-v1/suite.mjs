import {REFERENCE_EIGHT_CASES} from '../reference-eight-v1/suite.mjs';

const shortRequests=['帮我做一个游戏开始面板','帮我做一个设置面板','做一个在线游戏的暂停面板','做个单机游戏暂停面板','帮我做一个通关结算面板','做个挑战失败的结算面板','做一个加载面板','做一个加载失败的面板'];
const base=REFERENCE_EIGHT_CASES.map((source,index)=>({...structuredClone(source),
  request:{...source.request,text:shortRequests[index]},
  evaluation:{kind:'OPEN_DRAFT_REVIEW',explicit:null},
  // A single offline driver fixture, never an answer key for model output.
  fixturePurpose:'ONE_POSSIBLE_DRIVER_FIXTURE_NOT_EXPECTED_ANSWER'}));
const explicit=[
  {source:1,text:'做设置面板，只要音乐、音效开关和关闭按钮，两个开关默认开启。',labels:['音乐','音效','关闭'],indices:[1,2,4],kinds:['switch','switch','button'],initials:{音乐:true,音效:true}},
  {source:3,text:'做暂停面板，只要继续和返回主菜单两个按钮，别加退出。',labels:['继续','返回主菜单'],indices:[0,1],kinds:['button','button'],initials:{}},
  {source:4,text:'做通关面板，只显示得分12800和一个再来一局按钮。',labels:['得分','再来一局'],indices:[0,3],kinds:['text','button'],initials:{},textValues:{得分:'12800'}},
  {source:7,text:'做加载失败面板，只显示“网络连接失败”和重试按钮。',labels:[null,'重试'],indices:[2,3],kinds:['text','button'],initials:{},textValuesByIndex:{0:'网络连接失败'}},
].map((definition,index)=>{
  const source=structuredClone(REFERENCE_EIGHT_CASES[definition.source]),id='P'+String(index+9).padStart(2,'0');
  source.id=id;source.request={...source.request,id,text:definition.text};
  source.reference.rows=definition.indices.map((ordinal,i)=>{
    const row=structuredClone(source.reference.rows[ordinal]);
    row.label=definition.labels[i]??row.label;
    if(definition.textValues?.[row.label])row.text=definition.textValues[row.label];
    if(definition.textValuesByIndex?.[i])row.text=definition.textValuesByIndex[i];
    return row;
  });
  return {...source,evaluation:{kind:'OPEN_DRAFT_REVIEW',explicit:{labels:definition.labels,kinds:definition.kinds,initials:definition.initials,textValues:definition.textValues??{},textValuesByIndex:definition.textValuesByIndex??{}}},fixturePurpose:'ONE_POSSIBLE_DRIVER_FIXTURE_NOT_EXPECTED_ANSWER'};
});
export const SHORT_INPUT_REQUESTS=[...base,...explicit];
export const SHORT_INPUT_ARMS=[
  {designArm:'concise-strict',ruleArm:'baseline',promptProfile:'concise'},
  {designArm:'draft-first',ruleArm:'baseline',promptProfile:'draft-first'},
  {designArm:'draft-first-game-ui-design',ruleArm:'game-ui-design',promptProfile:'draft-first'},
];
export const SHORT_INPUT_CASES=SHORT_INPUT_REQUESTS.flatMap((source,index)=>Array.from({length:3},(_,offset)=>{
  const arm=(index+offset)%3;
  return {...structuredClone(source),...SHORT_INPUT_ARMS[arm],id:`U${arm}_${source.id}`,panelCaseId:source.id};
}));
