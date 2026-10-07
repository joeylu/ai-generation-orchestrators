# 控件顺序、正文与单按钮样式

用户可以继续用自然语言描述修改，例如：

- “交换上一首和下一首，保留它们原来的功能。”
- “只把播放键改成紫色，放大一点，两边保持原样。”
- “确认是绿色实心，取消是灰色描边。”
- “提示正文改成‘名字确定后还能修改’，标题不变。”
- 初次生成：“音乐播放器，上一首、播放、下一首用⏮、⏯、⏭表示，三个圆形按钮横向居中。”

这是有边界的能力扩展。当前不支持任意CSS、透明渐变、逐文本字号、条件显示、跨分组移动、枚举选项迁移或网络行为。无法完整表达的必要要求应具体澄清，不能静默省略。

## 编辑合同

modern-v3 面板的新编辑上下文使用 [EditContext 0.7](../schemas/panel-edit-context-v0.7.schema.json)。新操作由 [原生编辑指导](../prompts/panel-control-editor.md) 与实际响应schema共同提供，旧Context保留原能力和摘要。

| 操作 | 内容 | 边界 |
|---|---|---|
| `set-row-order` | 一个现有分组的全部行ID完整排列 | ID、绑定、标签、图标、事件和动作随控件一起移动；同批不能增删该分组的行 |
| `set-text` | 一个现有Text行的正文 | 不改变标题或行标签；仍为单行，编译验证可读宽度 |
| `set-button-style` | 一个现有按钮的局部样式 | 完整8字段；`null`继承主题/统一样式，`style:null`清除该按钮局部覆盖 |
| `set-title-bar` | 现有面板标题对齐、字号与独立底板 | 全局作用域；`null` 清除；不更改正文控件，详见[标题样式](panel-title-bar.md) |
| `set-button-font-size` | 一个现有按钮的文字／内联符号字号 | 8–96 整数逻辑像素；`null`继承主题，独立于按钮尺寸和外观覆盖。详见[独立字号](panel-button-font.md) |

局部样式使用 [Spec/Bundle 0.10](../schemas/panel-spec-v0.10.schema.json) 和编译器0.10.0。根字段`buttonStyles`保存稳定rowId和完整style：`backgroundColor`、`textColor`、`borderColor`、`borderWidth`、`cornerRadius`、`width`、`height`、`shape`。颜色只接受不透明`#RRGGBB`；边宽0..8，圆角0..128，宽高44..512，shape为default/circle/null。

指定尺寸/形状需要独立按钮：没有外置行标签与行资产图标。单按钮宽高与shape优先于组布局；正圆必须等宽高。自动文字宽度和实际分组宽度都通过编译门禁，不缩小、截断或重试。单按钮指定底色而未指定字色时，程序选择黑白中对比更高的一项。

改颜色、顺序、正文均属于同一个持久化十轮预算。失败、澄清和无变化结果不应用补丁；成功修改保留当前试玩值，撤销不退还已用轮次。

## 初次生成合同

Studio对modern-v3资源目录准备PlanningContext 0.8，原生响应为 [Intent 0.9](../prompts/panel-intent-v0.9-actions.md)，方案为 [Proposal 0.8](../schemas/panel-proposal-v0.8.schema.json)。每个section提供可空`actionLayout`。有显式同组按钮布局时，程序在测量前转为Spec 0.9；没有时仍输出Spec 0.7，不升级普通面板。

原生生成继续使用`sourceRef:"request"`绑定本轮原始需求。布局字段不占行序号；reset/submit按全树深度优先全局序号引用。默认API `createPlanningContext` 保留旧行为；调用者明确传入第四参`{actionLayouts:true}`才启用新合同。新生成尚未开放单按钮样式字段。

Intent 0.9响应schema明确要求非空分组标题（1..120字符，不能全为空白），与Spec既有校验一致。“无额外行标签”不等于空分组标题；未指定时模型可选简短分组名。明确要求隐藏全部分组标题仍需澄清。旧原生Intent 0.8 schema保持原样；程序不填补、修复或重试失败输出。

## 证据范围

[回归测试](../tests/control-editing.test.mjs)覆盖完整重排、原动作保留、局部样式继承与清除、不等尺寸横排、非法参数与溢出、Text正文、旧上下文重放、生成布局、组合映射和Unity导出文档；CLI替身测试验证真实调用边界收到新合同，测试不访问模型。

浏览器夹具和程序交付验证不代表真实自然语言模型成功率。Unity导出文档通过也不代表已在Unity编辑器原生导入；原生验收保持独立。
