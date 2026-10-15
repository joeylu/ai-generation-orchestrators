// Only public error identifiers reach the UI; raw process output stays local.
export function panelFailure(error){
 const value=typeof error==='string'?error:error?.message;
 const code=typeof value==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(value)?value:'PANEL_OPERATION_FAILED';
 let reason='本次面板调用或转换未完成，请查看本地运行证据。';
 if(code==='inventory.geometry')reason='当前空间无法容纳所选行列的物品格、皮肤安全区和文字。请增加对应空间或调整行列后重新准备计划。';
 else if(/^panel\.inventory-/.test(code))reason='AI仓库方案的格位、内容、几何或资产超出当前接入范围。请按仓库能力说明调整需求；原方案未被替换。';
 else if(/^inventory\./.test(code)||/^INVENTORY_/.test(code))reason='仓库配置、物品数据或皮肤合同未通过检查；原布局未被替换。';
 else if(/action-(skin-geometry|scroll-insets)/.test(code))reason='选定组件包缺少布局所需的安全几何证据，请先检查组件版本。';
 else if(/action-(grouping|unsupported|theme|targets|action-layout|layout-depth|layout-policy|layout)$/.test(code))reason='规划结果包含当前转换器不支持或不完整的结构、控件或行为。请按自定义面板的能力说明调整需求。';
 else if(/canvas-capacity|custom-(canvas|capacity|dimensions)|action-(layout-width|layout-dimensions|action-size|scroll-capacity)|panel\.(overflow|bounds|layout)/.test(code))reason='布局或尺寸无法在当前画布的安全范围内放下。请调整面板宽度、最大高度或分组结构；需要长内容时可明确要求滚动。';
 else if(/^skin\.|action-text-capacity|text-overflow|text\.overflow|node\.size|component\.(size|minimum)/.test(code))reason='控件尺寸未通过皮肤、九宫格或文字可读性检查。请增加对应空间或减少同排内容。';
 else if(code==='CONSUMER_CHANGED_REPLAN')reason='面板能力或组件配置已更新，需要重新准备计划后再生成。';
 return {code,message:reason+' 本次未自动重试，原始结果已保留。'};
}
