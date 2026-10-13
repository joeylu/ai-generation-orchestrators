# 游戏UI skill候选与测试方法

2026-10-13。用户要求增加测试，并质疑通用UI/UX skill对游戏布局的适用性。当前结论：候选已阅读，技术压力检查已执行，尚未完成任何候选skill的真实模型对照；不能宣布优胜者。没有安装外部skill或替换生产提示。

## 一手来源核对

| 候选 | 已阅读的公开内容 | 与本项目的关系 | 尚缺证据 |
| --- | --- | --- | --- |
| [game-ui-design](https://github.com/jeremylongworth-source/AgentSkills/blob/main/skills/game-ui-design/SKILL.md) | 主skill及game-ui-checklist，MIT许可证 | 游戏菜单/HUD、玩家决策、状态与信息层级；明确反对不适合游戏的通用SaaS视觉 | 未提供当前8类面板的具体排版数值或本Harness结果 |
| [game-ui-ux](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/main/skills/disciplines/game-ui-ux/SKILL.md) | 主skill及layout-and-flow，仓库Apache-2.0许可证 | 锚点与容器、分辨率策略、安全区、焦点和屏幕流程 | 主要是布局/交互架构，示例为Godot/Unity，不是Pixi美术模板 |
| [design-ui-ux-game](https://github.com/fcsouza/agent-skills/blob/main/plugins/game-dev/design/ui-ux-game/SKILL.md) | 游戏UI主skill | 常见HUD、菜单、反馈与可访问性原则 | 声明前置game-design-fundamentals；暂不作为首轮独立候选 |

上述是内容适配分析，不是测试优劣排名。研究网页的安装命令、工具指令或关联服务不进入本Harness执行链。若实际实验采用其正文，需先固定commit、内容摘要、许可证与所有必要参考；不能从main动态读取，也不能把原skill中的完整交付/工具流程混入PanelIntent的JSON协议。

## 已做的程序压力检查

使用原8份真实模型输出及验证后的生产回执作为基准，程序产生4种逻辑画布×原文/合成长文案，共64项技术案例，新增模型调用0。改变的是合成测试输入，原始请求、回执与交付保持不变。

| 逻辑画布 | 能编译 | 明确拒绝 |
| --- | --- | --- |
| 960×800 | 16 | 0 |
| 390×844 | 6 | 10 |
| 844×390 | 14 | 2 |
| 1280×720 | 16 | 0 |
| 总计 | 52 | 12 |

失败输入逐项保留：`output/game-ui-layout-probe-v1`，程序报告为`probe-report.json`。这不是skill比较、真实模型推断、浏览器视觉验收或手机物理视口缩放测试。COMPILED仅表示编译通过，REJECTED表示程序拒绝当前组合，不把拒绝本身隐藏为成功。

390宽下原文加载中/失败页都出现CONTROL_WIDTH；长按钮出现ACTION_LAYOUT_LABEL或BUTTON_FONT_FIT；部分加载长文案出现TEXT_WRAP_REQUIRED。程序能拒绝无法满足的几何，但当前规则没有为这些组合提供自动可用的适应策略。换skill不能直接证明这些限制得到解决。

复现：`node scripts/probe-game-ui-layout.mjs --run output/reference-eight-real-v1 --output <新目录>`。

## 对照实验设计（历史草案）

后续已按[冻结计划](skill-layout-comparison-plan-2026-10-13.md)取得用户授权并完成32次真实调用，详见[结果](skill-layout-comparison-results-2026-10-13.md)。以下是准备时的草案，不代表当前执行状态。

首轮同一8条业务需求，4个实验组：现有提示基线、提炼后的ui-ux-pro-max规则、game-ui-design规则、game-ui-ux规则，共32次真实调用。原8条请求中的业务内容不变；各组使用同一模型、推理强度、目录、主题、编译器和输出协议。所有组都重新生成，历史结果只作参考，不能拿旧版本单次输出代替新基线。每案例一次、失败保留、不挑最好结果；执行顺序交错以减小时间偏差。

外部规则采用经过审阅的可移植设计部分，记录与原skill的差异、依赖、字数和token预算，不能将精简版成绩声称为完整skill成绩。当前原生意图可表达分组、行/列/网格、尺寸、按钮排列与换行，但并不开放任意文本位置、任意字形样式或屏幕堆栈。先核对目标布局是否可表达；若为某个候选扩展schema/编译器，必须让全部组在相同新版上重跑。

所有组先过业务硬门：控件、文字、状态、事件不丢、不擅改、不添加游戏功能。再评价标题/正文层级、留白、主次操作、加载/结算用途是否明显、视觉一致性。对截图做隐藏候选名称的并排审阅；程序几何指标与用户审美评分分别记录，不让模型自评代替用户判断。

先在相同960×800条件比较，避免尺寸问题掩盖skill效果；优胜候选再测窄屏、横屏、长文案和未参加首轮的面板，并对关键案例重复至少3次，才能判断稳定性。真实页面检查键盘/鼠标、状态和重载；未实际连接手柄时不能报告手柄验收通过。

准备时要求候选快照、输入冻结和digest绑定授权；后续正式计划已满足这些要求并执行完毕。本草案本身不构成额外计算授权。
