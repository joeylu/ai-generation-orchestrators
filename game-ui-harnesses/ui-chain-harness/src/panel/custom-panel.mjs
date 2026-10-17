import policy from '../../configs/custom-panel.json' with {type:'json'};
export const customPanelChoice={id:'custom',name:'自定义面板',group:'custom',groupName:'自定义面板',variant:'自定义',description:'组合文字、按钮、输入框、勾选框、开关、滑块、下拉和进度条；支持分组与数据卡片底板、嵌套、横纵排列、自适应列数及滚动。程序按所选画布和皮肤安全区计算尺寸；放不下会明确提示。暂不支持自定义页签、宽度比例或任意坐标。'};
export function customActionConfig(base){
 if(policy.version!=='1.0')throw Error('CUSTOM_PANEL_POLICY_VERSION');
 return {...structuredClone(base),geometry:{...base.geometry,...policy.geometry},recipes:{...base.recipes,...policy.recipes},presets:{custom:structuredClone(policy.preset)}};
}
