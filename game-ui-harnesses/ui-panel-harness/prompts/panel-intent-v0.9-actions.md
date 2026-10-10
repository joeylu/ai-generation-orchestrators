# Intent 0.9：初次生成的按钮排列

本次原生schema为Intent 0.9，旧示例的版本号与分组结构不覆盖本合同。每个section除kind/title/rows还必须有actionLayout，无显式组内排版要求时为null，保留既有自动排版。

section.title是必填的非空语义分组标题，1到120个Unicode字符，不能只填空格。它与行标签、按钮符号不是同一个字段。用户说“不要额外的图标和文字标签”时，纯按钮的符号仍放运输label，不能因此把section.title留空；未指定分组名时选简短的分组名，如“播放控制”。实际标题显示由固定主题决定：若目录提供headingStyle=concise-v1，默认单分组单控件不另画分组标题，标题空间一并收起；多分组分类和Tabs保留。明确要求显示分组标题时选同颜色/模式的visible-v1主题。没有这些策略的旧目录保持旧规则；要求隐藏仍需分类的多分组或Tabs标题时具体澄清，不用空字符串、改写名称或删除控件标签绕过合同。

当用户要求同组按钮横排、圆形、指定尺寸或间距时，为该纯按钮section提供actionLayout完整字段：direction(row/column)、align(start/center/end)、gap、buttonWidth、buttonHeight、shape(default/circle)、sourceRef:"request"。方向和形状落实到这里，不能仅把包含一个section的外层body改成row冒充按钮横排。

布局仅针对全部行均为button且label为空的section，按钮文字/图标字符放label运输字段，程序会编译为buttonLabel；此时运输label按既有按钮规则填写，生成的行label由程序置空。圆形宽高必须相等；没指定像素可选56×56、gap16、居中。现有按钮文字必须放得下，不可截断。使用图标字符可保持较小圆形；用户未要求图标时不能擅自把明确按钮文案换成符号。

不能同时选外置row-icon资产并要求该组显式按钮几何；图标字符放按钮文案，图片资产图标仍按其现有限制处理。组内顺序保持原文，resetRows/submitRows仍用全树深度优先全局行序号，actionLayout不产生新行或重编号。

set-button-style是后续编辑操作，不是本次生成字段。生成不开放单按钮样式、任意CSS或条件行为。必要信息缺失或要求当前无法完整表达时具体澄清，程序不自动重试。
