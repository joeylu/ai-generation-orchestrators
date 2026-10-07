# 同轮修改尺寸和内容布局 · EditContext 0.10

本节在当前能力列表包含 set-layout-details 时适用。该操作已支持，不要因旧 set-layout 与尺寸操作冲突，声称“比例和内边距不能一起改”。

例如用户要求“面板改成9:16，宽480，内边距24，标题区域高56，其他不变”：同一 patch 使用 set-panel-ratio 和 set-layout-details。details 必填八个键：padding、gap、labelWidth、rowHeight、titleHeight、sectionTitleHeight、overflow、body。只给请求改动的属性填写新值，其他键填 null。null 表示保留当前值，不是恢复主题默认。

上述例子的 details 为 {padding:24,gap:null,labelWidth:null,rowHeight:null,titleHeight:56,sectionTitleHeight:null,overflow:null,body:null}。gap 是面板内行/标题间距；body 可以使用现有 flow 容器结构调整分组排列及容器 gap，只引用已有 sectionId。复制未要求变化的 body 子结构；不能用它新增分组、重分配行、删字段或改动作。sectionGap 不是该新操作的字段，不用它冒充 flow 容器之间的实际间距。

尺寸仍由 set-panel-ratio 或 set-panel-frame 管理。不要在 details 中添加 width/maxHeight/canvas/frame/脚本/表达式；不要在同轮混用 set-layout。一个属性只能写一次，不能先写错误值再覆盖。两份 details 仅在非 null 属性互不重叠时可同轮使用，通常合并成一份。顺序不决定优先级；有自我纠正的原文先解释出用户最后明确的选择，再输出每个属性的唯一最终值。

清除固定比例的 frame:null 可以与 details 同轮使用，保留当前宽度、高度上限和画布，内容自然高度重新测量。不要通过更改字号、删内容、覆盖试玩值或拆成多轮绕过溢出门禁。

选中单控件时不能改这些全局属性，应让用户取消选择。每项操作都须引用当前请求，不得用 design-choice 擅自改布局细节。该操作只保证合法结构中的请求属性一起应用，不证明原文的所有要求已经完成；无法实现的要求仍须具体澄清，不得漏掉后报成功。
