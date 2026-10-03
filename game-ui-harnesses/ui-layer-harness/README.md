# UI Layer Harness — 0.1.0a2 preview

独立 UI 拆分入口：参考图 → M1/M2 规划 → M3 冻结 → 宿主生图交换 → 归位 → UI 图层 ZIP。
本入口从本地实验链路收口，保留旧 `ai-ui-decomposition` / `ai-ui-assets` 命令及行为。
它不是旧包 0.5.0 的新模式，也不是组件化交付；普通业务文字被移除。

新 `run` 默认以 v7 编译局部参考提示词，并使用 `reference-body-auto-v1`：
素材接收及既有审查完成后，冻结主体观察请求，取得对应摘要的授权才执行，随后归位并打包。
主体确定尺寸与锚点，完整 alpha 支持确定 PNG 存储画布；扩展只允许在原图画布内。
输出仍待视觉验收，不代表生成模型已可靠还原。旧作业不转换，历史缺省仍为近似裁片适配。
已有主体证据也可用离线 [`register-materials`](docs/BODY-REGISTRATION.md)，无新增模型调用。
已有候选包可经 [`revise-package`](docs/PACKAGE-REVISION.md) 保留原层字节并重放明确替换的前景；
这是待审候选修订，完整旧来源未验证、旧 DAG 状态不提升。

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
    ├── SERVICE-CONTRACT.md  # Docker / Web 接入边界
    └── RELEASE-NOTES.md     # 版本变化与验证范围
```

规划 schema、提示词与示例继续共用相邻 `ui-decomposition-harness/planning-harness/`，不复制第二套合同。
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
python game-ui-harnesses/ui-layer-harness/ui_layer.py run --image REFERENCE.png --output NEW_RUN --target ui-layers --viewer game-ui-harnesses/ui-component-harness/dist-layers --max-calls 12
python game-ui-harnesses/ui-layer-harness/ui_layer.py status --output NEW_RUN
```

入口为源码分发，尚不提供独立 wheel。服务必须安装并配置可用的 Codex CLI 规划/定位适配器，
以及自己的生图调用能力；桌面工具不会自动进入容器。新任务的 Codex CLI session
默认配置为 `gpt-6-luna` / `xhigh`；新 `run` 可显式冻结 `--planning-model`、`--planning-effort`、
`--planning-timeout`，见适配器合同。旧冻结任务按其原运行时指纹处理。
不要将本地登录凭证、会话目录或样本加入分发制品。
可选 CLI 生图适配器通过本次调用临时配置的本地参数读取工具转发冻结参数，
模型无需重抄长提示词；接收前仍验证参数、读取记录和固定转发代码。
它不改变生图授权或失败后禁止重投的规则，也不表示真实生图链路已验收，见
[精确参数转发](docs/GENERATION-SHEETS.md#exact-image-call-transport)。

## 接入合同

见 [服务接入合同](docs/SERVICE-CONTRACT.md)：命令、授权、状态、媒体交换和交付边界。
版本变化见 [发布说明](docs/RELEASE-NOTES.md)。
相似样本的通用防错规则和验证边界见 [视觉保障](docs/VISUAL-SAFEGUARDS.md)。
多份已接收变体的确定性恢复与待验收打包见 [变体恢复合同](docs/REVIEW-REQUIRED-VARIANTS.md)。
重复平底槽位的小图标可先运行只读[原像素候选检查](docs/SOURCE-SLOT-AUDIT.md)，核对裁框与模板证据；它不提取图层，也不改变规划或质量门。
单份完整已接收作业也可用 `finish-variants --received-job JOB --job-digest DIGEST`
自动完成确定性切板、预览、来源重放及待验收打包；原严格 DAG 的视觉阻断不会被改写。
新任务默认 `sheets`，将兼容的独立素材同板生成后逐份提取，见
[素材板合同](docs/GENERATION-SHEETS.md)。需要逐素材生成时显式传 `--generation-mode single`。
新 `run` 默认 `--generation-reference context-crops`，使用有指纹的外扩局部参考和对应生成提示词；背景仍用整图，合板最多四份素材。可显式选择 `full`；旧配置缺省仍解释为 `full`，旧快照和授权不转换，`freeze-reviewed` 缺省继承源模式。见[局部参考合同](docs/CONTEXT-REFERENCES.md)。

新局部参考任务默认 `--context-prompt-version v7`；复杂素材与合板仍使用 v7 的 v6 安全回退。
可显式选历史版本；`full` 不接受该参数。`--registration-policy legacy-region-fit` 可显式选旧归位策略，
不允许失败后自动降级。默认 `--max-body-calls 12`，每份前景最多一次观察，超过上限在生图前停止。
等待主体授权时，状态提供 `bodyObservation.jobDigest`；用
`authorize-body --output RUN --job-digest DIGEST --approval TEXT` 记录宿主取得的对应授权，
再 `resume --output RUN`。生图授权不包含这份后来才冻结的观察输入，不得复用其摘要。

新任务可用 `--visual-policy FILE` 明确外观证据与容差：短标签锁定结构、身份、数量、状态、连接及显著外观，`bound-reference` 仅让绑定局部参考承载细微表面。策略可分别选择轻微色差仅记录、孤立柔影可选；实体轮廓、描边、缺件、错归属、比例、裁切和透明度仍须审查。文件随规划、冻结、生成和输出审查绑定，旧任务不转换。详见[显式视觉策略](docs/SERVICE-CONTRACT.md#显式视觉策略)。离线检查不证明真实生图或回拼质量。
最终图层仍各自独立；旧任务沿用其冻结模式，不因新默认值改变。
内部独立交换另有可选[原裁片布局参考板实验](docs/SHEET-LAYOUT-REFERENCE.md)：从局部参考快照派生单张合板作业，以统一整数比例排版原裁片。它需要新摘要授权，不改变公开入口或质量门，真实比例保真尚待验证。
背景局部修正可先离线冻结显式编辑区与混合权重，再将同画布不透明候选合成到该区域；
保护区原像素必须完全不变。它不识别遮挡、不生图、不解除旧任务阻断，结果仍待视觉审查，
见[背景区域合同](docs/BACKGROUND-REGIONS.md)。
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

新规划 DAG 最多两轮局部修补与复审（最多 6 次规划模型调用）；旧会话授权和冻结记录不扩充。轻微规划告警随报告保留，重复阻断或超过两轮停止。详见 docs/SERVICE-CONTRACT.md 的 Bounded planning convergence。
