import policy from '../../configs/custom-panel.json' with {type:'json'};
export const customPanelChoice={id:'custom',name:'自定义面板',group:'custom',groupName:'自定义面板',variant:'自定义',description:'按需求组合文字、按钮、输入框、勾选框、开关、滑块、下拉和进度条；支持单列内容及滚动，不套用预设的固定文案和控件数量。暂不支持多分组、页签或任意嵌套排版。'};
export function customActionConfig(base){
 if(policy.version!=='1.0')throw Error('CUSTOM_PANEL_POLICY_VERSION');
 return {...structuredClone(base),geometry:{...base.geometry,...policy.geometry},recipes:{...base.recipes,...policy.recipes},presets:{custom:structuredClone(policy.preset)}};
}
