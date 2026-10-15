# 输入/下拉内容边距维护

全局默认：configs/skin-content-insets-policy.json。当前仅field.*水平边距；最低16，边框内额外留白12逻辑像素。上下边距、字体和箭头大小不变。不是按图片原尺寸直接加12：先在实际装框像素上识别透明留白/边框，再按输出倍率与密度换算。

推荐入口：npm run skins:candidates -- build。流程自动加入content-insets阶段，原皮肤包不变。当前仍要求有效assembly基线，不代表从任意生成图自动完成全部元数据。

独立新皮肤：先运行 node scripts/skin-content-insets.mjs --config work/skins/<id>/assembly.json --out work/skins/<id>/assembly-content-insets.json，再将输出交给skin-postprocess build。输出必须是同目录的新文件，避免相对素材路径失效；不能覆盖旧配置。底层skin-assemble只消费配置，不推导边距。

特殊覆盖：添加 --overrides work/skins/<id>/content-insets-overrides.json，内容如 {"field.normal":{"left":20,"right":20},"field.focused":{"left":20,"right":20}}。覆盖以人工意图为准，可低于建议，预检提示仍保留；同状态族冲突会拒绝，防止焦点变化引起内容跳动。

检测不支持时无默认猜值，需明确覆盖。无覆盖时保留更大的原值；stateGroups采用共同左右最大值。程序同步minSize.width，实际控件尺寸不足仍由既有组件验证拦截，不自动缩字或挤压内容。

证据保存在新assembly文件旁的.insets.json，包含源配置/策略摘要、覆盖、推导与最终值。inspect只报告建议，build不等于美术接受。修改策略后重新生成新的候选再检查；无需修改Pixi组件代码。

2026-10-14验证：烘焙22、机库26、森林33逻辑像素；三套各63项检查通过，7项定向测试通过。4197为待接受预览。
