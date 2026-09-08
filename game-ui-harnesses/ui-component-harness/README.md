# UI component Harness · 0.2.0

独立的 UI 组件编译与验收工程。局部 UI 图和经过确认的视觉 intent，经明确布局、
实际资源尺寸和确定性编译，生成引擎无关合同，再由真实 PixiJS 组件在 Web 画布运行。
用户页通过可选本地 MCP 适配器进行识图；未配置服务时明确阻断，不会默认生成按钮。

正式目录为 `game-ui-harnesses/ui-component-harness/`。它与相邻的
[UI decomposition](../ui-decomposition-harness/) 分别安装、维护，不绑定游戏初始包。

## 启动

需要 Node ≥22.18、npm 和支持 WebGL 的现代浏览器。在本目录运行：

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run dev
```

打开 <http://127.0.0.1:4173/> 进入用户预览页。本地服务固定端口，冲突时直接报错。
运行构建产物时先停止 dev，再执行 `npm run preview`。不能双击 index.html 代替服务。

## 工作流程

1. 上传或拖入一张 PNG、JPG 或 WebP 参考图（最大 2 MiB），通过已配置的识图服务理解组件类型、层级、文字和可见状态。严格校验识图结果和明确布局后才生成画布；没有默认 Image/Button 或手动二选一。
2. 切换原样、轻快、精致、稳重四个方案，或并排比较四个独立画布；支持重播与真实交互。
3. 选中满意的方案后导出。组件包保存选中画布的组件状态、原始资源与校验摘要、来源及动效配置。
4. 通过“打开已保存方案”恢复 v0.2 组件包，继续比较和导出。导入的时间线和绑定子集会保留。

日常预览不展示 JSON、组件树、事件日志或测试控件。空白页面不会自动加载工程夹具。
组件类型由语义结果从现有 16 种组件中选择和组合；不能确定的结果停留在识图阶段，不会猜测业务行为或补齐未知字段。原图可按识别的区域复用，语义重建不等于自动获得干净美术分层。
服务配置与返回合同见 [识图接入](docs/studio-vision.md)。密钥只由本地服务读取；参考图会发送到所配置的识图服务。
需要输入 intent、调整 policy、查看日志或运行旧版探针时，使用独立的
[工程工作台](http://127.0.0.1:4173/workbench.html)。原有工程示例与调试接口仍在该页面。

支持 Image、Text、Container、Button、Switch、CheckBox、RadioGroup、Input、Select、
ProgressBar、Slider、ScrollView、List、Panel、Dialog、Tabs。Input 的可见部分由 PixiJS
渲染，隐藏原生输入框负责键盘与输入法。v0.1 整图 Button 的编译和状态机继续保留。
动效采用独立合同，可关联组件事件，支持时间轴预览、停止、重播、复位和目标冲突校验。

## 正式浏览器工作流

当用户以自然语言要求“把这份明确的 UI intent/合同连同指定动效做成可验收组件包”时，
先在对话中审阅可见图像事实和不确定项，再用明确的 policy/facts 编译 v0.2 组件；只有在
组件校验通过后，才按用户明确选择的 Playful、Premium、Corporate 风格或已给出的时间轴
形成动效输入。正式 run 将 `{id, style, targets}` 风格请求放在 `workflow.motion`，由 runner
重新编译并校验体系；已编写时间轴放在 `workflow.timeline`。静态图不会自动推断动效风格，也不会
把 v0.1 Button 隐式转换成 v0.2。纯静态或无动效请求仍可使用原有
`compile → validate/inspect → pack/unpack` 路径，不需要选择新风格或执行 `run`。

将这些已确认输入、相对 `run.json` 的本地资源、来源说明和有限的真实浏览器检查写入严格
manifest。资源的 `file` 与 bundle `path` 都须为正斜杠可移植相对路径；不得使用绝对/盘符/UNC、
`.`/`..`、尾随点/空格或链接/联接目录，且 `file` 必须留在 manifest 目录内。启动匹配的本地
workbench 后执行：

```sh
ai-ui-component run run.json --preview-url http://127.0.0.1:4173/ --output delivery
```

`delivery` 必须是尚不存在的新目录。该命令先编译/校验组件与动效、校验候选 bundle，随后在
隔离浏览器上下文加载真实 PixiJS workbench；每个检查均从原候选 bundle 重新导入，之后进行
精确导出/导入恢复和 teardown（含导入资源缓存释放）。只有所有关卡通过才写入
`component.bundle.json`；创建输出目录后，无论成功或失败均写入脱敏的 `run-report.json` 和
截图证据。报告恒为 `humanVisualReview: "NOT_RUN"`，所以自然动效感觉和用户美术质量仍须查看
保留截图后由人确认。完整 schema、检查语义和可运行 manifest 见
[正式工作流](docs/workflow.md)。

保留用户指定的必测项；Agent 可依据已授权行为和当前已校验合同补充具体的动效、时间轴或真实
指针检查，但不会虚构业务结果、提交值或激活次数。`expectActivations` 同时校验全局计数和指定
目标计数，以避免相邻或重叠控件误满足检查。

## 自动化与验证

```sh
npm run self-test
npm run doctor
node scripts/cli.mjs --help
npm run test:browser
```

浏览器测试在 Windows 默认使用本机 Edge；其他系统先运行
`npx playwright install chromium`。可用 `UI_HARNESS_BROWSER` 指定 Playwright channel。
测试强制软件 WebGL，不调用模型。生产预览测试设置 `UI_HARNESS_PREVIEW=1`。
已有独立测试服务器时设置 `UI_HARNESS_EXTERNAL_SERVER=1`，测试将不接管该服务的生命周期。

CLI 提供 `run`、`validate`、`inspect`、`compile`、`pack`、`unpack`、`self-test`、`doctor`。
library 导出编译/校验/资源包/动效合同，不导入 DOM 或 PixiJS。`run` 的可选 Playwright
适配器只连接已另行启动的本地 workbench；npm 安装包不携带 Web 发行物，也不会自动安装浏览器。
源码目录存在时 runner 只加载 `src/` 图；安装包没有 `src/` 时才加载 `lib/`，不会混用两者。
协议握手仅确认 workflow 版本与 PixiJS 引擎标识，不校验内容摘要或检测所有同版本旧构建，
因此运行前必须自行构建并启动匹配源码的本地 workbench。
先 `npm run build`，再 `npm pack` 可得到本地安装包；它不是已发布的 npm 版本。
Agent 使用 [SKILL.md](SKILL.md)，具体命令见 [自动化说明](docs/automation.md)。

动效入口为独立的 [UI Motion Skill](skills/ui-motion/SKILL.md)，仅在 v0.2 组件合同已经
校验且用户明确选择风格或提交时间轴后使用。
Playful、Premium、Corporate 三套风格覆盖全部 16 类组件的
[适用动作](skills/ui-motion/references/component-coverage.md)，包括按压释放、
选中标记、焦点环、填充进度、滚动、弹窗和页签过渡。工作台可选择风格、应用到
当前画布、预览进出场，导出后恢复。状态立即提交，视觉过渡单独处理。
`ai-ui-motion catalog/system/validate-system` 负责体系配置；五种显式时间轴预设及
能力查询、编译、组合、校验、采样命令继续保留。组件包可同时保存体系与时间轴。
三套 Button 按压配方参考 LottieFiles，其余组件映射与参数由本 Harness 扩展。
当前只有 PixiJS 渲染适配器；[多引擎语义与验收](skills/ui-motion/references/engine-adapters.md)
明确了后续适配要求。独立合同不代表其他引擎已验收。

源码包由 `python scripts/package_source.py --output-dir ../../.tmp/ui-component-release`
生成，固定文件白名单、排序、ZIP 时间戳和 SHA-256，重新读取并验证每个条目。
源码包不含 node_modules、构建缓存或用户原图。安装包提供 CLI/library；Web 开发请使用源码包。

## 合同、证据和边界

- [组件树与编译](docs/tree-contract.md)、[运行时](docs/runtime.md)、[动效](docs/motion.md)
- [正式浏览器工作流](docs/workflow.md)、[离线 CLI](docs/automation.md)、[架构](docs/architecture.md)、[任务与实际验收](docs/tasks.md)
- [接手审计](docs/takeover-audit.md)：历史源码核验，旧日志不能充当当前验收

真实组合图的识别/分层、物理触屏与输入法面板、用户美术确认仍未验证。
模型提供方与认证未选定，其他引擎与版本未选定，相应任务保持 BLOCKED。
不会用程序夹具或整图显示冒充自动识图与可编辑分层成功。
动效验收包含程序夹具的局部像素检查，不代替用户美术质量确认。
`analysis/button-confirm.intent.json` 与 `examples/button-confirm.json` 是旧版兼容向量；
它们引用的用户原图不随公共包分发。默认示例使用 `public/fixtures/` 内的程序资源。
