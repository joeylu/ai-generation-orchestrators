# 16 类组件的生成前能力预检

类型出现覆盖不是布局、状态或组合的全覆盖。新参考拆分必须按原图观察和明确派生方案列出所需 profiles，运行 capability-check，然后将同一请求传给 freeze --capabilities。不要只列 base 省略实际需求。

这是拆分端规划输入，不是消费端 handoff 的新字段；不得写进组件 props 或 appearance binding。

```json
{"kind":"ui-decomposition-capability-request","version":"1.0","planDigest":"<check 输出的 64 位计划摘要>","components":[{"id":"settings-tabs","type":"Tabs","profiles":["native-items","vertical-v1","per-tab-icons"]}]}
```

```powershell
ai-ui-decomposition capability-check --request capabilities.json --output capability-report.json
ai-ui-decomposition freeze --plan plan.json --workspace work --run new-r001 --capabilities capabilities.json
```

未知 profile、未支持能力或消费端单边支持，返回 capability_blocked，CLI 退出码 2。freeze 在创建 run 前拒绝能力缺口和摘要不匹配；成功时保存请求、报告和 SHA-256，batch.load 校验快照没有被改动。旧批次继续兼容，但没有 capability_preflight 的历史批次不能宣称做过新检查。

预检只覆盖明确声明的需求，不自动识图，不检查调用方是否漏列，不代替组件树、素材、坐标、摘要、官方导入和真实输入验收。组合仍需模态、裁剪、菜单层级和焦点测试。sample_acceptance 与 human_visual_acceptance 均为 false；不构成生成授权。

## 逐组件边界

机器 profile 名称和解释在 src/ai_ui_decomposition/capabilities.py。此表为代码核对范围，不是任意变体支持承诺。

| 组件 | 现有路径 | 未实现或尚未完整接通 |
| --- | --- | --- |
| Image | 静态素材、region、contain/cover/stretch | 图集动画验收 |
| Text | 单一样式、换行/省略、系统字体 | 富文本、自动恢复原图字体 |
| Container | 显式嵌套 | 任意旋转/缩放状态像素验收 |
| Button | 一套背景、运行时反馈、子图标 | 独立 hover/pressed/disabled 图片合同 |
| Switch | ON/OFF track/thumb、文字、位置 | 旧单套素材的完整双状态证明 |
| CheckBox | checked 布尔值、box/mark | 三态、逐状态 box 图片 |
| RadioGroup | optionId、显式每项位置 | 单项禁用、多选 |
| Input | text、编辑状态 1.1、只读/禁用 | 通用适配器的 password/email/number、长于 256 的 limit 测试、多行、IME 设备验收 |
| Select | 等高项、optionIcons、分离文字颜色 | 非等高行、上弹、多选、随选择变化的菜单图标 |
| ProgressBar | 左到右、内部 mask、数值文字 | 竖向、右到左、环形 |
| Slider | 横向单值、步长、数值文字 | 竖向、双滑块区间 |
| ScrollView | 纵向、零范围/常显、端部留白、授权底部空白 | 横向/双轴栅格皮肤验收、脱离真实比例的短滑块 |
| List | 等高 text-row、rowGap、选中模板、直接 Image/Text 子节点选中与裁剪验收、1.1 选中项关联外部 Text | 网格、不等高行、多选、逐项状态底板、关联文字位于源 List 内部或被祖先裁剪 |
| Panel | 完整背景、可选 header、嵌套 | 自动猜测九宫格参数 |
| Dialog | modal/non-modal、可选 body、子布局 | 拖动、调整大小 |
| Tabs | 横向、纵向 1.0、原生尺寸、逐项图标 | 换行、右侧栏、单项禁用 |

统一注册缩放是消费端能力，但通用拆分状态矩阵仍要求 sourceCanvas 等于目标组件尺寸，不能仅凭 CLI 导入成功就宣称完整状态验收。

## 本轮修复

Slider 曾只按 step 小数位舍入，忽略小数 min 和科学计数法；键盘又固定十位小数。有效配置可能得到 off-step 值或小步长不动，End 还能落到不对齐的 max，破坏保存往返。

现在鼠标、键盘共用 min+n×step 合法格点。max 不对齐时终点取范围内最后合法值，不改 max/step；拆分端期望同步修正，无需新消费端字段。真正不可表示的数值明确失败。

证据：work/ui-decomposition/component-capability-audit-20260914-r001/。
后续扩展仍须消费端合同、拆分接入及样本验收；不能改名组件或删除验收区域来通过预检。

Panel/ScrollView capability inventories require freeze --component-document and
--layout-spacing (producer plan 1.1). IDs/types must match the document. Freeze
checks panel/button spacing and all ScrollView whitespace decisions before
creating requests, then hashes snapshots. See [spacing gates](scroll-bottom-space-v1.md).
