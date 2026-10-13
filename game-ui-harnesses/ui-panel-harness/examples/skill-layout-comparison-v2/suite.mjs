import {REFERENCE_EIGHT_CASES} from '../reference-eight-v1/suite.mjs';
export const PROMPT_ARMS=[
  {designArm:'production-control',ruleArm:'baseline',promptProfile:'production'},
  {designArm:'concise-baseline',ruleArm:'baseline',promptProfile:'concise'},
  {designArm:'concise-ui-ux-pro-max',ruleArm:'ui-ux-pro-max',promptProfile:'concise'},
  {designArm:'concise-game-ui-design',ruleArm:'game-ui-design',promptProfile:'concise'},
  {designArm:'concise-game-ui-ux',ruleArm:'game-ui-ux',promptProfile:'concise'},
];
export const PROMPT_LAYOUT_CASES=REFERENCE_EIGHT_CASES.flatMap((source,index)=>
  Array.from({length:PROMPT_ARMS.length},(_,offset)=>{
    const armIndex=(index+offset)%PROMPT_ARMS.length;
    const item=structuredClone(source);
    item.request.text=item.request.text.replace('使用当前目录的简洁流式布局和默认视觉样式，逻辑画布960×800，面板自动测量。','使用当前目录的默认视觉样式，逻辑画布960×800；未明确的展示布局由设计者决定，业务内容和顺序保持。');
    return {...item,...PROMPT_ARMS[armIndex],id:`T${armIndex}_${source.id}`,panelCaseId:source.id};
  }));
