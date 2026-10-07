# 16 面板需求评测

评测输入在 [suite.mjs](../examples/panel-evaluation/suite.mjs)，独立业务断言与自然语言需求一起固定。
覆盖声音、画质、控制、无障碍、通知、语言、主菜单、暂停、删除确认、存档、角色、任务、
背包筛选、商店筛选、房间准备和高级长列表设置。所有案例都处于当前五类行控件的能力范围内；
不包含实际背包网格、输入框、联网、购买、存档或游戏跳转业务。

各阶段分别计数：词法控件配方命中、模型合法方案、业务断言、确定性编译、实际 Pixi 交互。
检索配方存在不等于模型选择正确；READY_TO_COMPILE 只通过结构、引用和原文依据检查。
独立语义门检查精确行数、顺序、标签、静态内容、范围、步长、初值、选项、启用策略、按钮动作、
重置范围与明确要求的布局。它不能替代人工视觉检查，也不证明所有中文改写需求的解释能力。
此轮不要求具体图片，资源候选数量会记录，图片选择的语义正确率不计分。

## 准备与有限真实调用

在本 Harness 内执行，输出目录必须全新；Sharp 参数为已安装的本地模块位置：

```sh
node scripts/prepare-panel-evaluation.mjs --catalog examples/modern-mint-layout.catalog.json --assets output/generic-library-migrated-v1 --sharp-module <installed-sharp-module> --output output/panel-evaluation-16-plan-v1
```

准备命令不启动模型。它完整验证资源库，保存 16 个规划上下文、原文、断言、检索结果、
调用策略和计划摘要。真实评测由用户明确要求后单独执行，必须提供准备命令打印的完整摘要：

```sh
node scripts/run-panel-evaluation.mjs --prepared output/panel-evaluation-16-plan-v1 --plan-sha256 <printed-plan-sha256> --assets output/generic-library-migrated-v1 --sharp-module <installed-sharp-module> --output output/panel-evaluation-16-run-v1
```

固定 gpt-6-luna / xhigh，每份需求只有一次 CLI 会话，有限地同时运行四个不同需求，单批调用上限等于案例数。
请求前复验上下文、业务断言与资源库，原子创建一次性 dispatch-claim；同一准备目录不能再次调用。
失败、NEEDS_INPUT、语义不符、编译失败全部保留并计入首轮结果，不补写成功，不修复模型数据，
不自动重试。中断后保留已完成案例与原始回执；计划已经消费，不能恢复执行模型请求。
只读分析、重编译和重建预览可以复用已有产物，不再调用模型。

这属于用户请求的真实模型评测，独立于 npm test；单元测试只使用程序夹具。
夹具证明 16 种结构能够编译，不作为真实生成成功。现有 loopback 工作台不参与批次，
不会替换用户当前面板、重启服务或改动相邻 Harness。

## 离线预览与交互验收

```sh
node scripts/build-panel-evaluation-preview.mjs --run output/panel-evaluation-16-run-v1 --output output/panel-evaluation-16-preview-v1
node scripts/check-panel-evaluation-browser.mjs --preview output/panel-evaluation-16-preview-v1 --run output/panel-evaluation-16-run-v1 --output test-results/panel-evaluation-16-browser-v1
```

预览构建复验每个真实回执、规划报告、业务断言和面板包，不能把夹具混入模型结果。
只读复用相邻组件 Harness 的 Vite/Pixi 源码，编译一次共享渲染器，生成预览合集。
有可编译产物的失败案例也允许查看，但仍标为失败。
浏览器断网运行，逐行检查键盘状态变化、下拉打开与选择、按钮事件与重置、禁用按钮点击、
滚动中焦点可见、导出与文件重新打开。截图和浏览器报告独立保存，不修改模型回执或面板包验证标志。

16 个不同需求各跑一次只测首轮覆盖率。重复生成稳定性、语言改写鲁棒性、人工视觉与原生引擎
验收仍独立；结果中明确标为 NOT_MEASURED / NOT_RUN，不能用这轮成功推断长期稳定。

## 重复生成与组合

当前准备命令支持 `--sample <tag>` 区分独立样本，`--suite <json>` 指定已固定的其他案例集合。
计划固定模型、单次策略、上下文/断言/目录/资源库摘要，以及模型传输代码与提示文件的摘要；
执行前及每份请求前复验这些协议字节。协议变化必须创建新计划。相同版本的两轮完整 16 案例
按相同原文和断言比较，失败案例不能从统计中剔除。

原始首轮、协议修复实验和最终重复样本分别保存。修复后的成功率不能覆盖较早失败记录。
当前输入明确“保留已列出的按钮”和“宽度不足时排单列”，避免把响应式换列混同点击折叠。

[combinations.mjs](../examples/panel-evaluation/combinations.mjs) 包含六份混合需求，覆盖分组独立重置、
静态文字/按钮/选择/数值/开关混排、禁用按钮、三组嵌套和长列表。业务门还检查明确的分组行归属与
嵌套树形状。数据集合不向模型传递验收答案；模型只接收需求、目录、候选和协议。

生成后的组合由独立的 [面板组合器](panel-composition.md) 完成，不调用模型：

```sh
node scripts/build-panel-composition-evaluation.mjs --run <accepted-16-run> --preview <accepted-16-preview> --output output/<fresh-compositions>
node scripts/check-panel-evaluation-browser.mjs --mode composition --preview output/<fresh-compositions> --run <accepted-16-run> --output test-results/<fresh-composition-browser>
```

组合案例包含全 16 个面板单列和双列、设置面板横排、重复实例和混合内容。来源必须通过真实回执、
业务断言及完整包校验；组合记录可从来源包重放。浏览器在点击任何恢复按钮前将所有字段改为非默认值，
验证只有声明范围被重置，未声明的字段保留。禁用的下方控件通过实际滚动揭示后再点击。
预览导出文件经完整校验后重新打开，所有浏览器步骤断网且不调用模型。

`verify-panel-stability.mjs` 最后复验两轮完整生成、两轮浏览器、混合需求、组合重放和组合浏览器，
生成有摘要的总报告。它拒绝缺案、不同协议或断言、任一失败、来源错配及伪造的模型成功统计。
该范围证明已测样本的行为，不能保证任意改写、无限调用或原生引擎表现。
