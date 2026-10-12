# UI Layer Harness — 0.1.0a8 preview

固定发布标签：`ui-layers-v0.1.0-alpha.8`。
服务接入与升级参数见[本版发布说明](docs/release-0.1.0a8.md)；下载发布附件并校验 SHA-256，旧任务继续使用旧版本。

alpha.8 增加六样本基准、规划修复阶段及失败诊断包的真实计量、可选调度耗时诊断，
以及保留原始像素的[极淡辉光切分选项](docs/HOST-INTEGRATION.md#recommended-new-diagnostic-configuration)。
新切分策略须由新 warning 任务显式选择，仍只做一次最终整图复审；默认策略保持。

官方 `host-run` 新任务增加[通用规划预检、派生修正及可选修复闭环](docs/PLANNING-REPAIR.md)。
正常路径仍为 M1/M2 两次规划调用；可选模型修复须显式预留最多两次额外调用并绑定实际授权。
原始回答与失败证据不覆盖，修复候选通过程序校验和独立复审后才能冻结。

本版也包含 alpha.6 之后的[固定复杂样本离线基准与阶段计时](docs/BENCHMARK-AND-TIMING.md)。
`benchmark` 对照已有证据并可重放确定性归位；新任务可用 `host-timings` 查看阶段开销，均不调用生图。
离线重放可选 `--profile-local`，按操作细分 PNG、文件 I/O、哈希与 ZIP 成本；诊断报告包含 profiler 开销。

本版包含[复杂参考图一致性修复](docs/FIDELITY-FIXES.md)：背景改为原图去 UI 的简短编辑提示词，
合板限制尺寸差距并采用均衡网格；切分不确定的裁片仅保留为诊断证据，不进入回拼，也不算完整交付。
alpha.5 曾完成一次从原图开始的 CLI 整链验证及一次文字去除补图验证；该历史范围不构成 alpha.8 真实模型验收。
alpha.7 的海洋规划、原始生图和独立补充复审证据另有记录；alpha.8 新切分仅做现有像素的离线验证，未新增模型或生图验收。

新服务集成使用 `host-run` 及 `host-*` 交换协议，见[宿主接入流程](docs/HOST-INTEGRATION.md)。
该入口以持久化阶段状态机编排全链路并复用规划、冻结与交付原语；既有 `run/resume/status` DAG 入口继续保留。

独立 UI 拆分入口：参考图 → M1/M2 规划 → M3 冻结 → 宿主生图交换 → 归位 → UI 图层 ZIP。

新宿主作业可设置 `visualReviewMode=warning`：视觉差异全部记录为 warning，继续到回拼后人工验收；
M1、生图与复审共用唯一归属、父板排除子元素、完整主体比例及高光分类规范。
技术完整性仍校验，旧任务和旧策略不改写，见[视觉 warning 策略](docs/VISUAL-WARNING-POLICY.md)。
新任务默认冻结 `contextPromptVersion=v13`：前景裁片及合板输入明确删除背景所属人物与景物，
包括连接线空隙和半透明底板中透见的场景；背景仍保留原主体，独立插画保留自身画面。
合板使用 v5 逐格文字删除与归属清单，同一张裁片输入板；旧版本提示词及参考像素不改写。
新 warning 作业统一在检测副本中忽略 alpha 0/1 杂点来寻找切线；交付素材保留全部非零原始 RGBA，
包括 alpha=1 的外发光尾部，并加透明留边。原始合板、全部原始裁片及检测副本分别归档，旧策略不改写。
新 warning 作业遇到合板贴边、透明缝缺失／歧义或空余格残留时，仅对异常合板局部兜底；
新 warning 作业默认冻结 `materialReviewPolicy=final-composite-once-v1`：先自动切分、归位、回拼和打包，
再将原图、最终回拼与完整素材总览放入同一个独立复审请求，最多调用 1 次。
不再按每个生图请求复审；例如 10 次生图也只有 1 次整图复审。视觉发现只记录 warning，无自动补图。
保留原始合板与全部像素，标注未验证素材，终态为 `diagnostic_complete_pending_visual_acceptance`。
不追加生图；复审调用计入原预算。新 warning 作业默认冻结 `bodyReviewPolicy=final-composite-first-v1`，
不创建逐素材主体观察任务，位置使用明确标注的 alpha 估算并等待整图人工验收。
疑似原生透明素材裁边、无法区分的同形空白实例保留 warning 和原始答复，不重试、不伪造身份。
需要逐请求复审时可显式设置 `materialReviewPolicy=per-request-v1`；需要完整主体观察时再选择
`bodyReviewPolicy=every-reviewed-foreground-v1`。旧配置维持原策略。
诊断交付不宣称全部切分或正式链路通过。
本入口从本地实验链路收口；旧拆分 Harness 已退役，迁移边界见[退役说明](docs/DECOMPOSITION-RETIREMENT.md)。
它不是旧包 0.5.0 的新模式，也不是组件化交付；普通业务文字被移除。

[宿主链路](docs/HOST-DELIVERY.md)可用 `planningMode=fresh-host-m1-independent-review`
从原图执行新的 M1 模型规划，再做独立 M2 复审。M1 原始答复与来源证据贯穿冻结校验；
只有这类完整链路完成才报告 `FullReferenceToDeliveryExecutionCompleted=true`。
显式离线草案入口仍保留，并报告 M1 未执行；两种来源不能混记。

需要从原图完成整条链路时，在新 `host-run` 配置中显式设置
`planningMode=fresh-host-m1-independent-review` 和 `generationMode=sheets`。
新任务默认采用 sheets 合板策略，保留独立交付素材身份；背景及不兼容素材仍由分组程序单独请求。
最终整图人工验收可设置 `visualReviewMode=warning`，不改变真实 M1 要求。该正式入口使用仓库内运行时，
宿主负责实际模型和生图调用，可接入独立模型代理，无须使用 Codex CLI 适配器。
显式严格独立素材交付中，每份前景都要完成真实主体观察；上述一次整图复审配置输出待人工验收的诊断包。
执行完成、严格视觉通过与人工验收的判定见[链路检查点](docs/DELIVERY-CHAIN-CHECKPOINT.md#completion-and-acceptance)。

新 `run` 默认以 v13 编译局部参考提示词，并使用 `reference-body-auto-v1`：
素材接收及既有审查完成后，冻结主体观察请求，取得对应摘要的授权才执行，随后归位并打包。
主体确定尺寸与锚点，完整 alpha 支持确定 PNG 存储画布；扩展只允许在原图画布内。
上述限制属于普通 `run`；正式宿主链路显式冻结
`expanded-support-original-viewport-v1` 后可完整存储画布外素材，显示仍保持原图尺寸。
输出仍待视觉验收，不代表生成模型已可靠还原。旧作业不转换，历史缺省仍为近似裁片适配。
已有主体证据也可用离线 [`register-materials`](docs/BODY-REGISTRATION.md)，无新增模型调用。
已有候选包可经 [`revise-package`](docs/PACKAGE-REVISION.md) 保留原层字节并重放明确替换的前景；
这是待审候选修订，完整旧来源未验证、旧 DAG 状态不提升。

新宿主作业可显式提供 [原型实例复用声明](docs/MATERIAL-REUSE.md)，在独立规划复审确认后减少重复素材的
生成请求，完整保留每层归属、素材复审和主体观察。默认不自动去重；此预览尚无真实样本复用视觉验收。

新规划配置冻结逐对 [关系复审](docs/RELATION-REVIEW-V1.md) 及 [文字合同](docs/planning-text-contracts-v1.md)：
同层包围框交叉须有原图轮廓与归属证据，待删业务字与获准装饰字分别记录，精确重复留字许可另存去重计划。
原始模型答复和回执保持不变；缺少新字段的历史作业继续其原合同。

新任务可用 `--visual-textures REGIONS.json` 指认少量无法读清的小印记，按墨迹形状、排列和位置
保留为视觉纹理，不猜文字或品牌。输入绑定原图 SHA 与坐标，M2 核对真实对象归属，
生成及素材复审继承同一范围；其他文字及视觉检查继续执行。此选项仅支持新任务，
修订与实验提示词变体暂不支持，见[视觉纹理合同](docs/planning-text-contracts-v1.md#source-bound-visual-textures)。

## 目录

```text
ui-layer-harness/
├── README.md                # 总览与快速开始
├── requirements.txt         # 源码运行依赖
├── ui_layer.py              # 稳定的公开调用入口
├── src/ai_ui_layers/        # 规划、执行、定位、打包与可选模型适配器
├── tests/                   # 离线测试及测试导入配置
└── docs/
    ├── HOST-INTEGRATION.md  # 新宿主接入与阶段循环
    ├── SERVICE-CONTRACT.md  # 兼容入口及公共产物边界
    └── RELEASE-NOTES.md     # 版本变化与验证范围
```

规划 schema、提示词与示例统一位于本目录 `planning-harness/`；必要的校验和媒体原语由包内 `_core` 维护。
内部模块使用包内导入；服务仍只调用根目录的 `ui_layer.py`。

## 安装和启动

下载固定标签的完整源码归档并验证发布摘要，保留仓库目录关系。在归档根目录运行：

```text
python -m pip install -r game-ui-harnesses/ui-layer-harness/requirements.txt
python game-ui-harnesses/ui-layer-harness/ui_layer.py --version
```

为 UI 图层包构建离线 Pixi 查看器（Node >=22.18，在 ui-component-harness 目录）：

```text
npm ci --ignore-scripts
node scripts/build-layer-viewer.mjs
```

回到归档根目录：

```text
python game-ui-harnesses/ui-layer-harness/ui_layer.py host-run --config CONFIG.json --output NEW_RUN
python game-ui-harnesses/ui-layer-harness/ui_layer.py host-status --run NEW_RUN
```

`CONFIG.json` 按 [HOST-DELIVERY](docs/HOST-DELIVERY.md) 提供完整配置；
推荐的新任务参数及授权、预留、接收循环见 [HOST-INTEGRATION](docs/HOST-INTEGRATION.md)。
准备命令本身不调用模型或生图，后续由宿主交换真实回执。
入口为源码分发，尚不提供独立 wheel。`host-run` 不要求 Codex CLI；
模型身份、调用预算与并发由宿主显式配置。桌面工具不会自动进入容器。
不要将本地登录凭证、会话目录或样本加入分发制品。
可选 CLI 生图适配器通过本次调用临时配置的本地参数读取工具转发冻结参数，
模型无需重抄长提示词；接收前仍验证参数、读取记录和固定转发代码。
它不改变生图授权或失败后禁止重投的规则。本版已验证 CLI 原生生图的冻结参数转发与回执接收，
仍由宿主提供调用协调，视觉效果按样本验收，见
[精确参数转发](docs/GENERATION-SHEETS.md#exact-image-call-transport)。

兼容 `run/resume/status` DAG 仍可用，需要 Codex CLI 规划/定位适配器及宿主生图能力。
其新会话默认 `gpt-6-luna` / `xhigh`，可冻结 `--planning-model`、`--planning-effort`、
`--planning-timeout`；命令和单独主体授权见 [SERVICE-CONTRACT](docs/SERVICE-CONTRACT.md)。
它与 `host-*` 不共用控制循环，旧任务始终按原指纹与策略处理。

## 接入合同

见 [服务接入合同](docs/SERVICE-CONTRACT.md)：命令、授权、状态、媒体交换和交付边界。
当前正式宿主流程、修订／诊断导出与验收证据的区别见[链路检查点](docs/DELIVERY-CHAIN-CHECKPOINT.md)。
版本变化见 [发布说明](docs/RELEASE-NOTES.md)。
相似样本的通用防错规则和验证边界见 [视觉保障](docs/VISUAL-SAFEGUARDS.md)。
多份已接收变体的确定性恢复与待验收打包见 [变体恢复合同](docs/REVIEW-REQUIRED-VARIANTS.md)。
重复平底槽位的小图标可先运行只读[原像素候选检查](docs/SOURCE-SLOT-AUDIT.md)，核对裁框与模板证据；它不提取图层，也不改变规划或质量门。
单份完整已接收作业也可用 `finish-variants --received-job JOB --job-digest DIGEST`
自动完成确定性切板、预览、来源重放及待验收打包；原严格 DAG 的视觉阻断不会被改写。
新自动化任务使用 `sheets`，将兼容的独立素材同板生成后逐份提取，见
[素材板合同](docs/GENERATION-SHEETS.md)。历史 `single` 配置按原合同回放。
新 `run` 默认 `--generation-reference context-crops`，使用有指纹的外扩局部参考和对应生成提示词；背景仍用整图，合板最多四份素材。可显式选择 `full`；旧配置缺省仍解释为 `full`，旧快照和授权不转换，`freeze-reviewed` 缺省继承源模式。见[局部参考合同](docs/CONTEXT-REFERENCES.md)。

新局部参考任务默认 `--context-prompt-version v13`，使用原图编辑、文字删除及场景归属规则，
详见 [局部参考合同](docs/CONTEXT-REFERENCES.md)。实际视觉验收仍按冻结复审策略执行。
可显式选历史版本；`full` 不接受该参数。`--registration-policy legacy-region-fit` 可显式选旧归位策略，
不允许失败后自动降级。默认 `--max-body-calls 12`，每份前景最多一次观察，超过上限在生图前停止。
等待主体授权时，状态提供 `bodyObservation.jobDigest`；用
`authorize-body --output RUN --job-digest DIGEST --approval TEXT` 记录宿主取得的对应授权，
再 `resume --output RUN`。生图授权不包含这份后来才冻结的观察输入，不得复用其摘要。

新任务可用 `--visual-policy FILE` 明确外观证据与容差：短标签锁定结构、身份、数量、状态、连接及显著外观，`bound-reference` 仅让绑定局部参考承载细微表面。策略可分别选择轻微色差仅记录、孤立柔影可选；实体轮廓、描边、缺件、错归属、比例、裁切和透明度仍须审查。文件随规划、冻结、生成和输出审查绑定，旧任务不转换。详见[显式视觉策略](docs/SERVICE-CONTRACT.md#显式视觉策略)。离线检查不证明真实生图或回拼质量。
最终图层仍各自独立；旧任务沿用其冻结模式，不因新默认值改变。
当前合板自动将原裁片以统一整数比例排成一张输入板，见[合板参考板合同](docs/SHEET-LAYOUT-REFERENCE.md)。
显式单板变体仍是独立实验作业，不转换已有快照或放宽质量门。
背景局部修正可先离线冻结显式编辑区与混合权重，再将同画布不透明候选合成到该区域；
保护区原像素必须完全不变。它不识别遮挡、不生图、不解除旧任务阻断，结果仍待视觉审查，
见[背景区域合同](docs/BACKGROUND-REGIONS.md)。
新宿主作业可在规划前绑定显式掩码，经独立范围复审后，将真实生图作为补景候选；
程序保留保护区源像素，最终背景使用同画布 identity 适配并再次核验像素，见
[宿主背景保护合同](docs/PROTECTED-HOST-BACKGROUND.md)。接缝与补景质量仍须真实视觉审查。
用户确认并经 M2 复核的宽卡片/面板框可用显式[横向框体适配](docs/HORIZONTAL-FRAME-SLICE.md)，
四角保持等比，仅缩放无固定细节的中段；默认素材仍保持原比例。
Docker 项目负责服务封装；Web 消费该服务 API 和公开图层包；本仓库不规定 HTTP 路由。
独立产物合同为 `ui_layer_composition_v1`，不是后续 UI component 的组件树合同。

## 版本策略

- 本预览入口是新版唯一发布实现；`experiments` 不属于分发依赖。
- 服务固定标签、源码 SHA 和归档 SHA-256，禁止生产追踪分支 HEAD。
- 同一任务始终用同一代码版本，运行时指纹改变会拒绝恢复；旧任务由旧版本完成。
- 提示词或算法改进可在兼容合同下升级；不兼容合同必须升版，不能静默更改字段语义。
- 发布预览意味着允许集成验证，不表示图像保真、Linux 或 Docker 真实模型链路已验收。
- 本地样本有人工修订，不能视为无人介入端到端稳定性证据。

## 验证

```text
python -m unittest discover -s game-ui-harnesses/ui-layer-harness/tests -p "test_*.py"
```

所有测试离线，使用替身及程序图形，不调用生成服务。首次上线需在外部服务环境完成真实任务联调。

兼容 `run` 的规划 DAG 最多两轮局部修补与复审（最多 6 次规划模型调用）；其授权和冻结记录不扩充。
正式宿主链路按冻结范围执行 M1/M2，无自动模型重投。兼容策略见 SERVICE-CONTRACT 的 Bounded planning convergence。

当前协议、兼容入口及可清理项的审计见[协议维护记录](docs/PROTOCOL-AUDIT.md)。
