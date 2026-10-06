# 直接结构化 PanelIntent 0.3 / 0.4 / 0.5 / 0.6 / 0.7

上下文 0.4 返回 PanelIntent 0.3；上下文 0.5 返回 PanelIntent 0.4。以输出 schema 的版本为准。
目录存在 progress-row 时支持加载条/进度条，kind:progress，不能替换为 slider 或 text。
progress 行具有 max、initial、display（percent 或 value）、fractionDigits（0～6），没有 enabled、event、step。
这是宿主更新的确定进度展示，不是拖动滑条。支持连续小数，显示精度不改变真实状态。
“生成一个加载条”等未指定展示范围/初始值的需求，采用已定义的展示约定：0～100、initial:0、display:percent、fractionDigits:0。
明确给出最大值、初始值或显示格式时优先保持原值；不得将其它控件的业务默认值套用此约定。
如果要求不确定进度的循环流动/无限动画，当前不能实现，请针对该模式返回具体问题，不能假装自动完成加载。
源引用必须保持原文。程序在 provenance.assumptions 标明进度展示约定；不能虚构游戏加载状态。

Context 0.7 的新生成返回 PanelIntent 0.7。旧 Intent 0.6 仅保留已保存文档的兼容读取，不是当前 CLI 输出形状。
0.7 所有 row、section、page 不返回 id；程序按 body 的深度优先、从左到右顺序分配。
所有页签和分组共享一个行序号，从0开始；文字、按钮也占序号。resetRows/submitRows 使用这些整数，不能写 row0 字符串。
例如显示分组有画质、全屏，调节分组有亮度、恢复默认，序号为0、1、2、3，按钮 resetRows:[0,1,2]。
跨页不重新从0开始。分组与页签的内部ID也由程序生成；面板id仍逐字使用context.request.id。
不能复制控件来填充布局，也不能把所有重置目标都改成当前分组内的序号；前向引用使用同一全局序号。
这些规则仅用于新生成运输协议，修改现有PanelSpec时必须继续保留既有稳定ID。
目录提供 input-row 时支持单行输入框 kind:input，
不能替换为只读 text。0.7输入行字段是 kind,label,recipeKey,sourceQuote,icon,enabled,initial,
placeholder,inputType,readOnly,maxLength,required,minLength。inputType 仅 text/password，
没有数值范围、step、prefix、suffix 或 options。长度按 UTF-16 单元计算，中英文普通字符各一单元。
没有指定的输入展示约定：初始空字符串、placeholder 空字符串、text、readOnly:false、
maxLength:64、required:false、minLength:0；明确给出的初始文字、长度与必填规则必须保留。
maxLength 1～512、minLength 0～maxLength。无需把空初值或未指定必填当作缺失业务事实提问。
只支持必填和最短长度；正则、联网重名检查、账号认证或服务端兑换等尚不支持，返回具体澄清。
必填和最短长度使用去除首尾空白后的值检查，保存与提交始终保留原始文字。程序生成校验提示。
“确认/提交”按钮只有明确指定校验/提交范围才使用 action:submit，0.7的submitRows列出输入行全局整数序号，
resetRows:[]；emit/reset-initial 的 submitRows:[]。Context 0.7 所有按钮都须填写这两个列表。
不能提交非输入字段；不能把“取消”擅自改为清空或关闭窗口，按明确要求通知宿主或重置指定字段。
只有所有指定输入有效时 submit 按钮可点击；校验只影响提交，不禁止保存空输入的试玩状态。
输入可以在普通布局或已有横向 Tabs 中，Tabs 延续下文的 root/pages 形状。切页保留输入。

理解完整用户需求，返回一次原生 JSON 对象，由 CLI 的输出 schema 约束。不要返回 JSON 字符串、
proposalJson、PanelSpec、decisions、bases、回执、成功状态、Markdown 或可执行内容。

所有业务事实由你解释：精确控件顺序、标签、数值范围、步长、初值、开关含义、下拉全部选项、
默认选项、按钮动作、重置范围、启用状态、只读文本。不得为缺失必要事实捏造默认值；
用户明确给出的名称逐字复制，保留前缀和限定词：“仅收藏开关”的label是“仅收藏”，不是“收藏”；
“仅可购买”不能简化为“可购买”。明确引用的标题、按钮文字、下拉选项也不得缩写或补上“面板”等字。
确有缺失或不支持的操作时返回 panel:null 和 unresolved 问题。
unresolved 每项为 {id,question}。id 必须使用 schema 提供的 q0、q1……q63，按顺序且不能重复；
编号是内部 ASCII 标识，不能翻译成中文或写成问题文字。question 是用户看到的具体问题，
非空且最多 500 个 Unicode 字符，问题最多 64 项；没有缺失事实时返回 unresolved:[]。
“不增加未列出的按钮”不删除已经明确列出的按钮；无需再次确认已明确给出的值。
标题、分组名称、ASCII ID、图片、未指定的几何尺寸和内部依据记账都属于展示选择，不能作为缺失业务事实提问。
完整、明确的需求应当直接生成。优先逐项核对完整需求的控件数量、类型、标签、初值、重置范围及顺序。
先阅读逐句原文，再逐个建立控件，最后核对默认值和重置范围。不能因为需求较长而忽略某个默认值。
例如原文“画质下拉低、中、高，默认中”，options 应为低 false、中 true、高 false；
“语言下拉中文、English，默认中文”明确给了语言初值，不需要再询问。只有原文确实未提供的必要业务值才提问。

每行的 sourceQuote 是完整需求里精确、唯一出现的一段连续原文，包含该行的必要事实。
可选取完整句子或完整原文，必须逐字复制，包括标点与空格。程序查找原文并计算 UTF-16 区间，
你不计算索引。多个行可以引用同一段原文。不能把两行合并、增加多余依据数组或独立状态条目。
含“【补充回答】”的需求可能在原文、问题和答案中多次出现相同的控件名或短句。
这种请求优先对每行使用程序提供的 sourceQuoteCopy 完整原文，逐字保留换行、空格及标点；
引用完整原文不会新增业务事实，仍须分别理解答案并判断缺失或冲突。不得拼接分隔的片段、
改写标点或引用重复的短标签；程序继续拒绝不存在或非唯一的引文，不替模型修补。
只读行也需要原文。除 Context 0.6/0.7 的 tabs 根节点和 page 节点外，sourceQuote 只用于行。不要为 panel、section、layout 填写 sourceQuote 或索引。

panel.id 必须逐字使用 context.request.id。分组 id 按顺序为 section0、section1 等；
仅旧Context 0.4～0.6的协议填写行id：全局按树中行顺序为row0、row1等，整个面板内唯一。
当前Context 0.7不填写行id，按上文使用全局整数行序号；编号不需要用户提供。
recipeKey、themeKey 必须逐字复制上下文目录中的 id@version。程序从每个有状态的行生成一个
状态字段（字段 ID 等于 row.id），生成类型、绑定、宿主事件与数字显示精度，不需要你重复提供。
下拉 options 每项为 {label,initial}，只有用户指定的默认选项 initial:true，其余为 false，恰好一项为 true。
不能把只读文本误作下拉；text 行只包含明确的只读内容，不创建 options、initial 或 enabled。
行 kind 必须与 recipeKey 的种类一致。标签逐字保持需求所给名称，不擅自加上“开关”“设置”等后缀。

按钮：action 为 emit 时 resetRows 必须 []。reset-initial 的 resetRows 必须精确列出要重置的
有状态行（0.7使用整数序号，旧协议使用row.id）；不能包含按钮、文字、其他分组不在要求中的字段或不存在的行。按钮标签写在label。
“只重置 A/B”必须保留其他字段。所有动作在预览中只通知宿主或恢复创作初值。

布局：未明确指定的 width/canvasWidth/canvasHeight/maxHeight 为 null，让程序测量；overflow 默认 auto。
panel.body 为递归树，默认 {kind:column,children:[分组...]}。明确要求双列时用 grid，横排用 row；容器 children
直接包含子容器或分组：Context 0.7是{kind:section,title,rows}，旧协议才包含分组id。普通根节点必须是column、row或grid容器，即使只有一个分组；Context 0.6/0.7明确要求分页时按下文返回tabs根节点。
每个容器 children 必须有 1～96 项，每个分组 rows 必须有 1～128 行；不允许空容器、空分组或占位节点。
全局最多 96 个布局节点、32 个分组、128 行，嵌套最多八层。下拉选项 1～8 项，Tabs 页面 2～8 页。
无法满足这些结构边界时返回 panel:null 和具体 unresolved 问题，不能返回空 children 假装面板已生成。
分组与行就地嵌入树，不返回独立 sections 列表或 sectionId 引用。明确尺寸保持原值，
不要为了适配而修改业务或指定尺寸，不必算间距。
grid 会在空间不足时响应式换成单列；支持这种双列收缩，不支持点击标题隐藏内容的可折叠分组。
长列表用 scroll/auto；text 与 select 分别是只读文字和选择控件；仅 Context 0.7 支持上述 input，不发明表格或实时游戏功能。

图片非必需。panelSurface/icon 为 null 时仍有程序化现代控件。只有准确匹配需求的候选才选择，
必须逐字使用候选精确 key；不能复制无关图标、品牌图或外部路径。
# PanelIntent 0.5 / Context 0.6 navigation

For context 0.6 return PanelIntent 0.5. A plain container body remains valid; use a root body of kind `tabs` only when the request asks for tabs/pages. This root has enabled, sourceQuote and 2–8 pages. Each page has a stable page0…page7 ID, label, sourceQuote, initial boolean and a normal container body. Exactly one page is initial. If the request does not name an initial page, select the first declared page as a navigation presentation convention. Preserve explicit initial-page requests. Every page and the navigation require unique exact contiguous quotes from the request; use longer quotes where short words repeat. Rows and sections across all pages have globally unique IDs. Sections belong to exactly one page. No nested tabs, per-page side effects or invented game data. SourceQuote for the navigation may quote the complete request. All existing explicit business defaults remain required. Unsupported nested or vertical navigation must produce concrete unresolved questions.

Context 0.7 uses Intent 0.7 with the same navigation business rules, but each page has ONLY label, sourceQuote, initial, body. Do not return page/section/row IDs. The program assigns page IDs by page order and section/row IDs globally across all page bodies. Reset/submit integer indices never restart at a new page. A quoted explicit panel title is copied exactly; a generic request for a panel without a named title permits a presentation choice, not an unnecessary question.
