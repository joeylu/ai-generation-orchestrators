# 精简提示与游戏UI规则对照计划

后续状态：SUPERSEDED_NOT_RUN。用户指出这些用户输入过于详细，本40项计划未执行、不得继续申请或复用授权；改用[一句话需求计划](short-input-comparison-plan-2026-10-13.md)。下文为原准备记录。

状态PREPARED，真实调用0，授权未消费。1719项离线测试全部通过，无跳过；40项准备阶段业务预期核对通过，只读preflight PASS。生产默认提示未修改。上一轮32次真实结果与审计保留，旧授权不复用。

## 本轮问题与范围

回答两个问题：在同一链路内，“精简指令并开放现有布局选择”是否改变实际布局；在此基础上追加候选skill摘录是否有额外收益。本轮将精简与放开默认约束作为一个组合变化，不声称能够单独归因于提示长度。不是完整skill评测，也不是全部16组件或所有输入的验收。

五组各8条需求，共40次，每案例一次、串行、零自动重试。原提示对照同样重新生成；按面板轮换起始组。模型gpt-6-luna/xhigh、唯一主题modern-mint-light@0.21.0、Compiler 0.32.0、原生schema与完整context相同。

| 组 | 基础指令 | 追加规则 |
| --- | --- | --- |
| production-control | 原生产提示 | 无 |
| concise-baseline | 精简并开放支持的设计选择 | 无 |
| concise-ui-ux-pro-max | 同一精简提示 | 既有ui-ux-pro-max摘录 |
| concise-game-ui-design | 同一精简提示 | 既有game-ui-design摘录 |
| concise-game-ui-ux | 同一精简提示 | 既有game-ui-ux摘录 |

所有组共用相同实验说明；源摘录复用已固定commit/字节摘要的快照，未下载、安装或执行外部skill。完整task context与schema不删减；去掉重复读题材料和详细生产叙述。以P01为例，schema前的指令从23896字符降至2381字符（精简无skill组），完整提示从46517降至22593字符。这是字符计数，非token计数。

## 防止再次锁死设计

上一轮模拟需求中“简洁流式布局、面板自动测量”也限制设计。本轮五组统一把这段展示要求改为“默认视觉样式、960×800、未明确的展示布局由设计者决定”，其余业务描述和独立业务预期逐项保持。新旧轮不是完全相同请求，所以使用同期原提示组作对照。

精简版允许选择分组、column/row/grid结构、面板宽度、最大高度、溢出策略、文字换行，以及纯按钮组方向、对齐、间隔、尺寸、形状。仍保持明确标题、所有控件文案、内容顺序、默认值、状态、选项和事件。sourceRef依旧是全请求运输绑定，不宣称每个展示像素都由用户明确给定。

协议仍不能表达任意字体、正文对齐、普通行间距、自由定位或单按钮样式；这些仍由程序决定。未为单个候选扩展schema或放宽几何质量门。相关编译失败如实保留。

离线测试证明同一业务可通过现有适配器形成640宽、160×56横排按钮、间隔24的布局，业务事实不变；并验证40案例实际CLI边界通过替身准确发送冻结提示、一次调用、无重试。测试没有调用真实模型。

## 审阅与授权

- [五组完整提示与长度对照](../output/concise-skill-layout-plan-v1/design-review.html)。
- [40条需求与独立业务预期](../output/concise-skill-layout-plan-v1/index.html)。
- 冻结计划：`output/concise-skill-layout-plan-v1/input-adaptability-plan.json`。
- 摘要：`25c4252783c8c9ddf4ebcbd1d8ffcdf82c859e982976ce805080daa079010cf3`。

根AGENTS.md要求：`A generation attempt requires one fresh, single-use authorization bound to an immutable plan digest.` 新计划需用户批准这批最多40次调用后才能执行。继续准备工作不消费授权，历史32次授权已用尽。

批准后运行：`node scripts/input-adaptability.mjs run --prepared output/concise-skill-layout-plan-v1 --approve-plan 25c4252783c8c9ddf4ebcbd1d8ffcdf82c859e982976ce805080daa079010cf3 --output output/concise-skill-layout-real-v1`。

完成后对成功交付做真实浏览器交互、标题居中、下载、重开和重载验收，再运行审计与五组截图页。所有失败保留，用户美术评分不自动填写。一次样本不证明稳定性，不追加修复调用、不发布SDK、不切换生产默认规则。
