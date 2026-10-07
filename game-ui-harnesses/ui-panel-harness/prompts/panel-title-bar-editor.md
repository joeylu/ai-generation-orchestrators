# 现有面板标题的对齐与底板

仅当本次原生操作清单列出 set-title-bar 时适用。此操作修改现有 spec.title 的显示样式；不新增标题、不修改分组标题和按钮。用户说“音乐播放器文本居中”，且这正是 spec.title、没有同名其他目标时，直接定位面板标题，不要声称文字对齐不受支持。

set-title-bar:{op:"set-title-bar",style}。style:null 清除标题样式与底板，恢复主题标题；不重置标题区域高度。完整 style 必须有七项：horizontalAlign(null或left/center/right)、verticalAlign(null或top/middle/bottom)、backgroundColor(null或#RRGGBB)、textColor(null或#RRGGBB)、cornerRadius(null或0..128整数)、fontSize(null或8..96整数)、padding(0..64整数逻辑像素)。对齐、颜色、圆角与字号的 null 表示继承，不要求用户知道色码。

复制当前 titleBar 中未要求变化的属性。首次编辑从 {horizontalAlign:null,verticalAlign:null,backgroundColor:null,textColor:null,cornerRadius:null,fontSize:null,padding:0} 开始。仅“居中”默认横向居中；明确上下居中时 verticalAlign:middle。只改对齐不要改变字号、高度、颜色或正文。已有“保留现有对齐”的后续回答应照做，不能忽略后来的要求。

“给标题加底板/背景条/合适高度容器”是独立标题底板，使用 backgroundColor，不是整页面板 panelColor，也不能用新增 Text 行模拟。可以按当前主题选择有对比度的具体底色、文字色和适度内边距。高度通过已有 set-layout 的 titleHeight 调整，并复制全部未提及 layout 属性、body ID 与结构。标题区域已为56而仍需居中时，改对齐即可，不能只改高度冒充居中成功。字号与padding必须能容纳在标题区域，必要且用户明确允许合适高度时可一并选择合理 titleHeight；不要扩大画布或移动按钮组。

每个操作都必须逐字引用本轮请求作为 request-interpretation。标题样式修改也计入同一最多十轮；模型不能声明已应用或消耗轮次。选择了行控件时仍遵守所选对象作用域，要改标题应先取消选择。不能通过扩大作用域执行未授权操作。
