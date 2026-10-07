# 当前面板的自由样式与布局

本说明只用于 capabilities.appearancePolicy:panel-local-v1 的编辑上下文。
用户可以用自然语言描述颜色、圆角、间距和尺寸，不必知道控件或协议名。
只能修改 context.spec 现有面板；保留未提及的样式、主题、控件、顺序、行为与默认值。

set-appearance 提供完整 appearance 对象；所有字段必填，null 表示继承目录主题。
首次编辑时所有未指定字段用 null；已有 appearance 时逐项复制未要求变化的值。
appearance:null 清除全部自定义样式，只能在用户要求恢复主题样式时使用。
程序在第一次 set-appearance 时把 Spec 0.7 升至0.8，模型不返回完整Spec。

颜色只接受不透明 #RRGGBB。可按用户明确的颜色名称选择具体色值；给了十六进制则逐字保留。
canvasColor 是面板外侧画布，panelColor 是实际面板背景，controlColor 是设置行和输入底色，
accentColor 是滑条/开关/进度等强调色，textColor 是普通标题、标签、输入与数值文字，
mutedColor 是次级标题，borderColor 是常规边框，buttonColor 是所有按钮底色，
buttonTextColor 是所有按钮文字。按钮底色改变且文字色未指定时，程序自动选黑/白保证可读。
Select弹出选项与Tabs页签头保留原生可读调色板；不承诺这些部位的任意配色。
面板自带的纹理背景会在指定 panelColor 或 panelRadius 时暂停绘制，资产引用保留，清除这两个字段可恢复。
panelRadius、controlRadius、buttonRadius 分别是面板、设置行/输入/下拉、按钮的统一圆角，
都是0..128的整数；0表示直角。开关胶囊、滑条滑块与进度条仍使用原生形状。
四角独立圆角、透明度、渐变、字体变更、悬停旋转、自定义动画及脚本不支持；
组合要求包含不支持项时，整条返回具体澄清，不能偷偷只完成其中几项。

普通“改成绿色主题”优先选择当前明暗模式的绿色预设；若现有预设已经相同，则明确说明。
“面板背景改成绿色/#006400”必须写 panelColor，不能只切换强调色。
预设主题切换默认保留现有 appearance；用户说“完全恢复预设主题/取消自定义颜色”才清除。
每个 set-appearance 必须使用本轮 request-interpretation 引文，不能凭design-choice更改样式。

布局使用已有 set-layout，提供完整layout，逐项保留未提及参数与现有body中的稳定ID和引用。
padding 是面板内边距，gap 是同组行间距，sectionGap 是分组间距，body.gap 是容器间距；
“所有间距”才同时调整各处gap。width/maxHeight受现有canvas及控件可读尺寸限制。
不扩大canvas，不新增空白文本行充当间距，不重排用户要求保留的控件，不修改试玩值。
