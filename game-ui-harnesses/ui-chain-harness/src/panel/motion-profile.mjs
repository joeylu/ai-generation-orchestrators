import {getMotionStyle,MOTION_SYSTEM_VERSION} from '../../../ui-component-harness/src/motion-system.ts';
import {motionDesign,MOTION_DESIGN_VERSION} from './motion-design.mjs';

export const motionChoices=Object.freeze([
 {id:'original',name:'原样',description:'不附加动效'},
 {id:'playful',name:'轻快',description:'弹性弹出 · 按压回弹 · 条目错峰'},
 {id:'premium',name:'精致',description:'分层渐显 · 柔和淡入 · 平滑恢复'},
 {id:'corporate',name:'稳重',description:'方向滑入 · 短促下沉 · 快速停稳'},
]);
export function motionSelection(style,scope='panel'){
 if(!['panel','components'].includes(scope))throw Error('MOTION_SCOPE_INVALID');
 if(!motionChoices.some(c=>c.id===style))throw Error('PANEL_MOTION_STYLE_INVALID');
 return {kind:scope==='panel'?'ui_chain_panel_motion':'ui_chain_component_motion',version:'1.0',adapter:'pixi-ui-panel-v1',sourceVersion:MOTION_SYSTEM_VERSION,designVersion:MOTION_DESIGN_VERSION,style,profile:style==='original'?null:{...getMotionStyle(style),...motionDesign(style)}};
}
