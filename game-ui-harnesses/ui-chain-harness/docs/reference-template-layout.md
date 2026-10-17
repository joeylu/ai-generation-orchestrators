# 预设布局的唯一来源

新创建的 sdk-* 面板计划通过 `src/panel/reference-layout-source.mjs` 从 ui-reference 当前选中的模板编译布局，冻结为 consumer 的 `referenceLayout`。模板入口为 `game-ui-harnesses/ui-reference-harness/web/template-previews.mjs`，其实际定义来自同目录 examples 下的 sdk-fixed-panels.mjs、sdk-panels.mjs 与 presentation-layouts.mjs；这些文件共同定义当前选定的模板，而非 ui-chain 再维护一组宽高。

`settings-model prepare` 和 `action-model prepare` 在模型调用之前冻结布局。修改模板后重新 prepare 的任务自动读取新尺寸、控件框与位置，不需要同步 settings-layout.json 的旧通用尺寸。源输入摘要和编译后的几何一起进入现有不可变计划约束。已有计划、已生成结果不自动更换几何，不改写原始回执。

`reference-layout.mjs` 负责将模板控件绑定到本地内容与行为。面板居中于所选横/竖画布，保持模板宽高；不为了 16:9 或 9:16 拉伸面板。控件框、按钮尺寸与相互位置来自模板。文字行框可以为字体最小高度对称扩展，文字和皮肤仍按现有渲染器显示。皮肤边框只在模板留白范围内调整装饰倍率；空间不足报错，不回退到另一套通用排版。

新增的 `controlFit: template-box-v1` 只允许无内置标签的 Switch 或无内置数值标签的 ProgressBar。它让皮肤在模板的控件框内适配，而不影响未标记的旧组件。该标记随 PanelDocument 导出保存；适配器在尺寸变化时同步更新显示几何，动效端点根据实际底轨重新计算。

控件数量、类型顺序或映射与模板不匹配会明确拒绝。新增一种控件类型仍需要增加一次渲染器映射与回归；调整现有八个预设的布局无需修改消费端几何。库存和自定义面板继续使用各自的布局策略，不套用固定预设。

验证入口：
- tests/reference-layout.test.mjs：八个预设、两个方向的尺寸合同，冻结值权威性，结构不匹配拒绝。
- tests/runtime/reference-layout.test.mjs：八个预设在 PNG 皮肤上的实际编译、交互与横竖布局。
- tests/runtime/motion.test.mjs：开关端点、尺寸变化与全组件动效回归。

本轮预览使用已有皮肤离线渲染，不调用模型。历史面板仍使用其冻结记录；新布局预览与原记录分开保存。
