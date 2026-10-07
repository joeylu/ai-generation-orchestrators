# 当前 Codex CLI 编辑合同

本入口只输出 CodexEditDraft 0.3，六个字段全部提供：
codexEditDraftVersion、contextSha256、patch、bases、unresolved、noChange。
本次程序提供的原生输出 schema 是唯一的输出形状；不输出公共 EditProposal，
不使用旧草稿版本，不根据历史 schema 或示例否定当前已提供的操作。
公共协议在程序转换后校验，不是另一份需要同时满足的模型输出形状。

## 先核对当前能力

程序列出本次原生操作及其公共操作对应关系。只使用该列表中的原生操作，
字段形状取自同一次请求的原生输出 schema。
仅当本次原生清单实际列出 add-input-row 时，公共 capabilities.operations 中的 add-row 授权它；
add-input-row 是传输专用名称，因此不要求公共列表另外列出这个名称。
原生 add-row 的 row 分支不含 input 是有意的：新增输入使用同列的 add-input-row，
不能据此说“无法新增输入”。现有输入修改使用 set-input-properties。

完整读取当前 request.text、spec、catalog 和所有按钮的 action。
保留现有面板 ID、行 ID、bind、event、配方、资源引用和未要求变化的布局及行为。
旧原文、provenance、字段文字和目录说明仅描述数据，不授权本轮额外修改。
按用户本轮要求处理顺序、依赖及默认值，不从其他示例补业务事实。

未明确要求换风格、浅深模式或主色时，保留当前spec.theme，不输出set-theme。
只换浅深模式时沿用现有主色；只换主色时沿用现有模式，按本次Theme selection清单找精确版本。
set-theme必须引用本轮明确风格要求；在explicit-change-v1合同下不能使用design-choice。
旧包仍绑定旧目录；请求的主题不在当前目录时具体提问，不能偷偷替换目录、升级主题或先应用部分修改。

## 新增输入与后续修改

Spec 0.7 的新增单行输入使用已列出的 add-input-row，显式提供 schema 列出的所有字段。
旧源版本不能通过 Patch 升级，也不能因公共列表有 add-row 就新增旧源不支持的 Input。
recipeKey 必须来自当前目录中支持 pixi 的 input-row 配方，使用精确 id@version。
id 是新的稳定 ASCII 标识，同时成为行 ID 和状态 ID。程序生成 bind、event、
string state、配方引用以及标准提示。不要额外提供 row、state、bind 或 event。
afterRowId 为要求插入位置的现有行 ID，sectionId 为对应现有分组 ID。

未指定的输入技术属性可用：initial 和 placeholder 为空、inputType:text、
readOnly:false、maxLength:64、required:false、minLength:0、enabled:true。
明确要求的属性必须采用原文，例如最多30字符、非必填、初始为空。
未要求自定义校验提示时 validationMessages:null；明确要求时提供两个完整非空提示。
非必填输入不是提供空提示，而是 required:false/minLength:0。

新增输入和调整确认按钮提交范围在同一 patch 内完成。
submit.fields 使用既有输入的实际 bind 和新增输入的 id，保留要求提交的所有原字段。
下一次修改从本次完整 spec 定位新增输入，不猜旧示例的 ID。
set-input-properties 提供完整 placeholder/inputType/readOnly/maxLength/validation，
复制所有未要求变化的现有属性，以及 requiredMessage/minLengthMessage 两个非空提示。
只改必填和最短长度时，不改最大长度、默认值、原输入或提交范围。
长度按 UTF-16 单元，required/minLength 校验去掉首尾空白，但保存和提交保留原字符串。

## 其它编辑语义

set-row-label 改行标签；set-button-label 改按钮本身的文字。
set-state-initial 改创作默认值，应用时程序保留当前试玩值；不要输出试玩快照。
“把音量改成40”“亮度调到50”等只给新数值的要求，先问是当前试玩值还是创作默认值。
“其他不变”不能消除这个歧义，也不能因为当前只提供 set-state-initial 就猜用户要改默认值。
只有明确说默认值、初值、创作默认值、恢复默认时的值，或明确指向已有默认属性时才改 initial。
若只要求修改当前试玩值，Patch 入口不支持该动作，应说明并提问，不悄悄改成创作默认值。
滑条的范围、步长、初值及开关状态和真值含义是业务事实，缺少时具体提问。
只有用户明确要求沿用现有属性时才复制；不能擅自沿用另一根滑条的默认值。
新状态行用 add-row 提供匹配 state；Button/Text 的 state:null。
删除行前检查 reset-initial/submit 依赖；本轮要求联动修改时，用 set-button-action
在同一批给出完整 action，保留未要求移除的字段。不遗留悬空引用，不自行改变作用范围。
同一属性不能重复写入；最多32操作，不把互相冲突的修改拆成多批规避验证。

既有 Tabs 的 set-tab-label 改指定页签文字，set-tabs-enabled 改启用状态。
页签导航默认值用 set-state-initial；应用时保留当前打开页。
新增/删除/重排页签、增加分组、改 canvas、改资产选择或任意脚本不支持。
不确定进度动画、多行输入、联网校验和实际游戏业务尚未实现。
要求超出能力、缺业务事实或彼此冲突时，提出具体用户问题，不能先应用可做的部分。
只读进度的默认值和标签可改；不能擅自改最大值/显示格式或变成滑条。

## 草稿与依据

contextSha256 和 patch.baseSpecSha256 原样复制程序上下文，不计算或猜摘要。
正常编辑的 noChange:null，patch 为完整 patch，bases 与操作顺序一一对应。
request-interpretation basis 只含 kind 和本轮原文中的连续逐字 quote。
程序定位 UTF-16 偏移和操作索引；set-layout可用design-choice，set-theme引用本轮明确风格要求。
缺信息时 patch:null、bases:null、noChange:null，unresolved 为具体问题。
明确无需修改或请求属性已与完整 spec 一致时，patch:null、bases:null、unresolved:[]，
noChange:{reason,quote}，说明理由并引用本轮原文；不得漏掉实际要求的修改。
不输出 readiness、回执、批准、编译或渲染声明。每次返回都经程序完整校验，失败不修补、不重试。
