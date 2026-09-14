# Panel 专项交付报告

## 最新收尾：2026-09-13 数值文字绑定

下列旧记录保留原时间状态。当前 Panel 人工视觉确认另见
`panel-human-visual-review-20260913.md`。消费端正式 valueTextBindings 1.0
已通过拆分端 `value-text-handoff` 接入；没有定义同义格式。
Slider 70→89→88 与可见文字同步，ProgressBar 显示 3,500 / 5,000；
Studio 16 项检查、保存重开、导出再导入及隔离官方 CLI 通过。
250 项拆分回归：241 通过、9 跳过。旧记录中的固定数字问题已关闭。

最终包：`work/ui-decomposition/panel-closeout-20260913-r001/delivery/ui.component-handoff.draft.zip`。
SHA-256：`abdc247c528263a83873380674469f59bd81d873e7d97087380393a7aebbaae9`。
完整证据和收尾报告在该目录。原图/素材/参考状态/范围不变；Input 编辑未知字段
保留，完整参考状态视觉比对仍受限；包内 human_visual_acceptance:false 不变。
本次无媒体调用、无 Git 提交。此结论仅覆盖 Panel 专项，不代表全部 16 类组件。

本轮完成单层 Panel 通用能力及本地技术验证；没有完成整幅原图重建或人工视觉验收。

## 通用修改

消费端沿用 appearance binding 0.2：Panel background 必填，header/body 可选，titleLayout 必填。同步校验、应用、资源收集、加载释放和 PixiJS 渲染；不创建空白占位素材。旧独立分层保持兼容。拆分端 delivery-check 支持 Panel 默认部件及关闭 Dialog 的继承隐藏。新增单层/旧包回归和实际 Studio 验证入口。

新包需使用本轮消费端能力，旧版本可能拒绝 header 缺省；不是全版本无条件兼容。合同见 docs/panel-composition-v1.md。

## 样本及素材来源

使用 natural-game-ui-16-fullchain-20260909/reference.png 的 CHARACTER 面板作为专项对象，原图 1536×1024，映射恒等，Panel [1052,128,345,692]。
旧完整框体已包含 header/body；两张重复切片像素与框体对应区域完全一致，分别有 796/2388 个半透明像素，叠画改变边缘。因此仅绑定完整框体。
素材从旧文件导入，经正式 freeze/process/finalize/export/component-handoff 重新产生确定性记录；PNG 处理可能重新编码，原始参考图字节不变。不追认旧素材生成来源，不调用媒体或模型。
本包仅构建场景底图、Panel 框体与 CHARACTER 动态标题，未重建原图其余控件和面板子控件；不能用来声称完整 UI 的 16 类全部视觉通过。

## 结果

- 消费端 build 通过；完整离线测试 408/408 通过。
- 拆分端测试 233/233 通过，包含浏览器夹具。
- Studio 真实鼠标点击标题/正文/边缘，并输入 ArrowDown/Space：3 组通过；无虚假值事件、框体位置稳定。绘制区域为一张框体加运行时标题。Panel 本身没有可切换值，不制造 ON/OFF 状态。
- Arial 18 标题及实测文字边界检查通过。
- 官方 CLI 导入及 reference-accept 保存/重开/重导出链路通过；隔离目录 ZIP 导入通过。
- 原图 SHA-256 b67c68195093110e2b70e5dd994bfbcfe5ddaeabe6682b40f1c6a50129551292，字节一致。
- 官方视觉比较 visual_failed；最终 delivery-check failed_visual_qa，保持参考完整面板与当前专项渲染状态差异，不伪装同状态。
- human_visual_acceptance 始终 false。未提交 Git 改动。

## 交付

ZIP：delivery/ui.component-handoff.draft.zip
SHA-256：2e7d477a0872f769f455e72e83c2520e1c475101ea29a88e7adeac65f3cb09d2
Studio：studio-r002/studio.png；画布：studio-r002/initial.png
真实输入证据：studio-r002/report.json
官方参考对比：reference-acceptance-r001/report.json、visual-comparison.json、runtime.png
原图证据：original-identity.json；文字：visual-observation-check.json。
失败的首次 Studio 检查保留于 studio-r001：当时误把文字绘制区域也计作第二个框体，修正检查后重跑至新目录，未修改运行结果。

## 剩余限制

旧素材标题区高度、分隔线、装饰和纹理与原图不同；原图的面板内容尚未重建。完整参考样本仍需补齐子控件及相应素材/状态证据，再验收。当前无媒体生成授权，未修改素材以猜补。人工需确认视觉目标与最终框体布局；本技术草稿不等于可直接替代原版界面。

## 2026-09-13：Panel 5 件替换及完整子控件草稿

5 次授权生成全部收到，零重试；28 件素材通过正式处理。新增显式 contain 边距和最终素材 Alpha 审核修补；经验填充采用已有九宫格合同，全部额外处理零生成。回归 248 项，239 通过、9 跳过。

新包：work/ui-decomposition/panel-composed-20260913-r001/acceptance-r003/delivery/ui.component-handoff.draft.zip。
SHA-256：a95caaabe5809ab385a4ce6fb4a2d8dfa0d76d1a46d789c64e9a93eb23baae74。
官方 CLI、隔离导入、保存重开和原始参考字节往返通过；Studio 14 项真实输入通过。Input 编辑字段未知导致官方参考视觉验收 blocked。专项报告尚未接完整 delivery-check 状态/字体/区域输入，最终检查仍 failed_visual_qa。

仍有明确功能缺口：Slider 值 70→89→88 后旁边 Text 仍为 70，尚未建立通用数值文字联动。不能称为全功能或视觉验收通过。完整中文报告及截图保存在该 acceptance-r003 目录。human_visual_acceptance 始终 false；未提交 Git 修改。
