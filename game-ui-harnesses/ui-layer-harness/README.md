# UI Layer Harness — 0.1.0a2 preview

独立 UI 拆分入口：参考图 → M1/M2 规划 → M3 冻结 → 宿主生图交换 → 归位 → UI 图层 ZIP。
本入口从本地实验链路收口，保留旧 `ai-ui-decomposition` / `ai-ui-assets` 命令及行为。
它不是旧包 0.5.0 的新模式，也不是组件化交付；普通业务文字被移除。

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
统一配置为 `gpt-6-luna` / `xhigh`，见适配器代码。旧冻结任务按其原运行时指纹处理。
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
