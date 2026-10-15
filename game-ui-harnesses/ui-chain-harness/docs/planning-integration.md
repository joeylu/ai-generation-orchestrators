# Panel 规划接口与维护边界

目前完成离线接口、设置预设有限语义转换及可选真实模型命令。首个真实调用返回皮肤映射澄清；修正后经用户再次授权，已生成并编译真实设置面板，12 项交互通过，两个开关标签与原预设不同，报告为 needs-review。全部 16 类 AI 组装仍未完成。

## 唯一依赖入口

`src/panel/planning-client.mjs` 集中访问 Panel 的公开 `planning/v1` 接口。仓库开发时仅此处使用相邻源码路径；发布消费应在此替换为按不可变版本及摘要安装的包入口。当前源码路径没有锁住相邻工作区的 Git 版本，不能声称已完成生产依赖锁定。

Panel 负责检索候选、冻结规划上下文及输出 Schema；Chain 负责兼容检查，后续负责语义转换、组件绑定和预设排版。当前不执行旧 PanelSpec materializer，也不复制旧 Studio 或运行时。公开接口仍间接依赖 Panel 内部模块，尚未拆成独立规划引擎。

## 需要维护的内容

| 改动 | 维护位置与动作 |
| --- | --- |
| Panel 内部修复，公开协议不变 | 跑接口及语义回归；通常不修改 Chain |
| 新增规划协议版本 | 在 `configs/planning-compatibility.json` 添加明确的 context/intent 配对，并增加真实目录用例；不能只扩大版本范围 |
| 新规划语义或组件能力 | 后续更新 Chain 转换器、组件注册与适用预设，并验证语义不会丢失；仅加版本号不够 |
| 模板、风格、组件尺寸、面板内容 | 继续各自既有 JSON 维护入口，无须为此修改规划接口 |
| 正式升级 Panel 依赖 | 锁定新包摘要，验证接口及横竖面板回归后升级；保留旧包与旧规划快照便于回退 |

已验证组合：基础目录 context `0.1` / intent `0.3`；设置布局目录 context `0.4` / intent `0.3`；完整组件目录 context `0.11` / intent `0.12`。只有 intent `0.3` 的下述子集已实现转换，其余表示上下文与 Schema 可准备/校验。

## 快照与升级

`prepare` 返回 JSON 上下文、原始需求文本、响应 Schema 与摘要。`verify` 用当前实现重新推导并核对，发生差异直接拒绝，不覆盖旧快照，也不自动重试模型。摘要不是授权签名，同一 Schema 下的语义变化仍须测试。新增配对必须先完成对应语义适配，当前接口测试只覆盖准备与校验边界。

## 设置预设转换 v1

`src/panel/settings-intent.mjs` 先验证规划快照及其原生响应 Schema，再转换 intent 0.3。支持单列中一个无标题分组，开关、滑块和下拉框；保留行顺序、标签、禁用状态、初值、数值范围和步长。下拉选项按顺序分配稳定的 optionN ID，必须只有一个默认项且标签唯一；此版本上游协议不含选项级禁用字段。

未知配方、图标、皮肤覆盖、按钮行为、带标题分组、多组/嵌套布局、显式尺寸、滚动、滑块前后缀以及未解决问题均拒绝。布局须为四个空尺寸字段及 `overflow:error`。现有预设另加关闭按钮，其文案是配置选择，并非模型声明的动作。

`configs/settings-planning-policy.json` 维护上游配方和主题的明确映射及关闭文案。上游主题只作为已接受的语义主题键，实际视觉由命令指定的皮肤包决定，映射记录写入 provenance。不得通过扩大兼容列表绕过未实现的语义。

```powershell
node scripts/settings-intent.mjs --session <session.json> --intent <intent.json> --package <verified-pack> --out work/panels/intent-settings
node scripts/settings-preview.mjs --content work/panels/intent-settings/<id>/content.json --package <verified-pack> --out work/panels/intent-preview
```

转换先完成横竖两版校验，再写入新的 UUID 目录。输出包含输入快照、policy/layout/content、两份面板 JSON 和文件摘要报告；中途写盘失败的目录不可当作完成产物，报告最后写入。既有 settings-check 针对默认五项示例，不能直接用来验收任意内容。

证据引用检查只验证引用来自输入文本；Schema 和确定性转换不能证明模型准确理解了全部自然语言。真实模型接入后仍需语义验收。下一步准备受限设置请求的模型计划/人工核对流程；完整组件协议转换及画布编辑继续待续。

## 真实模型入口

```powershell
node scripts/settings-model.mjs prepare --request examples/settings-request.json --package <verified-pack>
node scripts/settings-model.mjs run --plan work/panels/model-plans/<digest>.json --authorize <digest> --package <verified-pack>
```

prepare 零调用，冻结公共 session、提示、消费者 policy/layout/皮肤绑定及摘要。run 只在明确计算授权后执行；固定工作区输出根中的计划目录采用排他创建，防止同计划再次派发。调用方不得更换根目录绕过此限制。准备新计划不等于得到重试授权。

可选模型入口仍集中在 planning-client.mjs，通过 Panel 的 `planning/codex/v1` 复用已有 CLI 运输；不复制 CLI 参数、事件解析及重试处理。模型输出先保存原文/回执，再由 Chain 校验并转换。有效澄清写入 NEEDS_INPUT；编译失败写入 REJECTED。首次调用沿用旧分类留下 REJECTED/panel.intent-unresolved 记录，保留原样，不改写历史。

维护入口：`prompts/settings-planner.md` 控制能力约束；`configs/planning-skin-aliases.json` 维护皮肤 ID 对应的自然语言名称；具体选中皮肤 ID 和摘要由真实包读取并冻结。模型必须明确获知 policy.themeKey 是映射键，实际外观来自 selectedSkin，不能根据旧目录主题名称改用其他皮肤。

预览可同时传 `--content` 和 `--layout` 使用冻结输入。settings-check 现在按字段类型读取节点 ID，并可接受第二个参数作为独立预期内容 JSON；缺省预期仍为 settings-content.json。它要求有可操作的开关、滑块和至少两个选项的下拉框，不能当作任意面板的通用验收。

语义比较存在差异时，settings-check 继续检查交互，但最终返回非零状态并写入 needs-review、独立 expected/actual。交互通过不能替代文案/语义接受；不要为消除差异而修改模型输出或反向调整预期。自然语言中需要精确保留的显示文案建议使用引号，控件类型放在引号外。

## 上游更新核对（2026-10-14）

最新能力对照、实际支持边界及三类面板横竖验证见 [panel-upgrade-matrix.md](panel-upgrade-matrix.md)。新版标题目录的规划协议回归通过，不代表其编译器布局已在Chain运行。本文早期“其余只可准备/校验”的说明已被后续intent0.12的Text/Input/Checkbox/Button有限动作预设转换补充；全16类意图转换仍未完成。

## 当前默认设置协议（2026-10-14）

settings-model新计划改用modern-all-components目录与intent0.12；settings-planning-policy和prompt同步迁移。旧文中的intent0.3为兼容路径，需要提供原policy，旧计划不自动迁移。新版sectionTitle按Schema保留非空名称，sourceRef必须为request，由转换器按顺序分配rowN。当前设置仍限制单组switch/slider/select；多组、动作区、滚动与Tabs不自动透传。最终入口已确定为[本地Studio](local-studio.md)，尚未实现统一界面。

## 多分组更新（2026-10-14）

最新设置转换支持intent0.12中column下的多个同级section，groups引用fields并验证有序完整覆盖；多组标题保留显示、占用高度参与布局。嵌套、Tabs、显式动作布局与滚动仍拒绝。旧文的单组限制已由此处补充。208项离线回归、13项真实皮肤交互与2个首屏样本通过；4202候选待用户验收，详见执行文档12.76。

## 滚动接入更新（2026-10-14）

设置的overflow:scroll已接现有ScrollView：主标题/关闭按钮固定，中间分组内容滚动；真实皮肤包经settingsSkinGeometry提供逻辑边距，编译与运行时共用scrollPadding。超宽、内区不足或缺少导入皮肤边距证据拒绝。error策略不自动变为scroll。此前“滚动未支持”说明由本段取代；Tabs/嵌套仍未接。210项回归、15项横竖交互和2个首屏按钮检查通过；4203候选待验，详见执行文档12.77。

## 页签更新（2026-10-14）

设置页签已实现：intent0.12的2–8页、每页同级分组、唯一默认页、整体禁用及独立滚动；复用PixiUI Tabs/Switcher。212项回归与17项交互通过，4204待验。此前Tabs待实现的说明由此补充；嵌套结构、完整16类AI映射、长文本测量与Studio统一入口仍未完成。详见执行文档12.78。

## 自定义面板入口（2026-10-14）

自定义通过同一个 planning/codex 接口与独立约束提示接入，混合支持 text/input/checkbox/switch/slider/select/progress/button。单列和滚动转换已实现；不是完整 16 类任意组装。范围、零调用准备和回归见 [自定义面板](custom-panel.md)。
