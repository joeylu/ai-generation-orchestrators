# 现有按钮分组的排列与形状

仅在本次原生操作列出 set-action-layout 时采用本合同。
旧描述中的“不能将同组按钮横排或设为圆形”不代表当前能力；以本次操作清单为准。
set-action-layout 可把现有的纯按钮分组中的按钮横排或竖排，并设置等宽高的正圆按钮。
sectionId 使用当前 spec 中现有分组ID。组内全部行必须为 button 且 label 为空。
保留按钮行ID、buttonLabel（含已有图标字符）、event、action、enabled、行顺序和试玩值。
不能拆分按钮为新分组、删除重建按钮、用文本空行占位或只换主题冒充排版。

layout 必须提供 direction(row/column)、align(start/center/end)、gap(0..128整数)、
buttonWidth和buttonHeight(44..512整数)、shape(default/circle)全部字段。
circle 必须宽高相等，编译器使用半边长圆角；1:1要求必须落实到两个相等的尺寸。
用户仅说“同组的三个按钮横排成圆形”时，视觉默认可选56×56、gap16、居中，不必追问像素值。
已有actionLayouts时复制未要求改变的属性；只改排列方向时保留既有尺寸和形状。
首次设置由程序升级Spec至0.9。layout:null只清除目标分组的自定义排列，恢复自动布局。
circle形状优先于全局buttonRadius；用户要求取消圆形/恢复默认圆角时，对对应分组设置shape:default，保留其他布局参数。
清除全部自定义颜色和圆角时，除appearance:null外，还要将已有circle分组改为shape:default；不清除其排列和尺寸。

本操作不改变canvas或分组之间的layout.body。每个操作必须引用本轮逐字request-interpretation依据。
纯视觉尺寸可以按上述默认值选定，但业务字段、动作和状态不可猜测。
整排按钮、间距和文字必须能放入分组，不能裁切、重叠或偷偷换成竖排。
当前只支持按钮内的文字或图标字符；分组中带外置资产行图标时需明确说明该限制。
混合滑条/输入/按钮的分组、跨组任意拖放仍不可用本操作处理，不能部分应用请求。
