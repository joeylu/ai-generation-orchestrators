# 新皮肤参数生成与维护

统一入口：npm run skins:candidates -- build。默认配置configs/skin-candidate-pipeline.json现含三套皮肤，使用profile模式；不要求复制已有assembly或每套编写生成脚本。

流程：校验原图摘要→定位/关联提案→复核提案可重放及无重叠→通用参数草案→通用field水平边距→按冻结模板全量组包（修订3为32件，修订2为30件）→16类组件及独立消费检查→待视觉验收。没有新增模型调用或部署能力。

## 维护分工

| 入口 | 维护内容 |
| --- | --- |
| configs/skin-template-set.draft.json | 部件清单、图集几何、状态族 |
| configs/skin-metadata-policy.json | 设计密度默认值、竖轨逻辑宽度、基础安全区、允许使用圆端假设的部件 |
| configs/skin-content-insets-policy.json | 输入/下拉水平内容留白规则 |
| 每皮肤metadata-profile.json | id、revision、theme和少量overrides |
| 每皮肤localization-input.json | 四板原始文件和摘要，由输入准备阶段提供 |
| configs/skin-candidate-pipeline.json | 各皮肤input/profile路径和本机预览端口 |

通用密度是显示设计默认值，不是从图片推断出的真实物理密度。普通密度4，主面板6；竖轨密度=模板逻辑宽度/目标显示宽度10。可在皮肤overrides中逐件覆盖density。

矩形切线优先来自panel-slicer对最终装框像素的分析；uniform部件无九宫格。竖轨只对明确列入规则的部件使用半源宽圆端假设，按宽度同比缩放端帽，中心纵向拉伸。水平进度条同样只在白名单中使用半高度端帽假设。这些是待视觉验证的形状假设，不是识别成功。

panel-slicer无法识别矩形/水平边框且没有明确例外时，流程停止。例外格式示意：overrides中以资产ID为键，允许density、nineSlice、caps（仅竖向，源像素）、contentInsets；不允许未知字段/未知部件。九宫格与内容边距为逻辑单位。可用原已核对配置作为例外来源，但必须记录来源及重新验证；不可复制整套旧参数冒充推导。

## 记录与边界

每次生成独立work/skin-metadata-drafts/<id>/，保留原字节副本、assembly.json、trial.json、inspection.json。trial.json保存策略与profile快照/摘要，以及每件的切线来源、密度来源、例外、装框操作及待视觉状态。统一流程还校验全过程输入/工具未变化。

历史baseline模式保留用于旧对比试验。profile与baseline互斥，新皮肤默认使用profile。烘焙目录旧prepare-candidate.mjs/candidate-policy.json仅为历史复现实验，正常维护不再执行它们。

通用水平边距阶段仅增加已有值，因此profile的contentInsets可提高最低安全区；希望刻意降低自动水平建议时，需使用独立skin-content-insets命令的--overrides并保留警告，不能暗中降低通用阈值。

这是候选生成闭环，不是美术自动发布。未知轮廓、低对比装饰、语义错件和细节拉伸仍需复核。现有质量门不保证识别全部视觉缺陷，保持productionReady=false。

## 三套验证的例外

烘焙无部件例外；机库主按钮normal保留一项明确切线/密度例外；森林两个页签保留两项明确切线/密度例外。来源见各皮肤metadata-override-notes.json。森林本轮使用S03原始四板源，不能声称与早期局部修整版完全相同。

森林另显式保留foreign-component-in-slot提案警告：其他部件跨入模板槽位，但当前裁片无归属冲突且互不重叠。metadata-profile.allowedProposalIssues只允许这一项试验警告，不允许放行缺件、归属冲突或裁片重叠；所有警告进入trial证据并保持待视觉复核。
