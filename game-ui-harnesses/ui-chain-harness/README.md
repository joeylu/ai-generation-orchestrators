# UI 皮肤 → 组件 → 面板链路

**状态：本地 Studio 已接通参考图、四张透明图集、30 个部件、16 类组件，以及有限预设 AI 面板的预览与导出。** 真实端到端验收见执行文档 12.86。产物仍为候选，不代表任意风格自动通过生产验收。文字/画布编辑与远程部署后置。下面早期单板入口保留维护用途。

后续讨论继续更新 [执行文档](docs/execution-plan.md)，不另建重复方案。

## 从这里开始

日常操作使用 [本地 UI Studio](http://127.0.0.1:4210/)；启动和维护说明见 [Studio 文档](docs/local-studio.md)。在本目录运行 `node scripts/studio.mjs work/studio/project.json 4210`，Windows 也可双击 `Start Studio.cmd`。

维护人员处理已有四图集，优先使用[候选生产统一入口](docs/skin-candidates.md)：`npm run skins:candidates -- build`。配置好皮肤输入后自动完成定位、试验组包和组件检查，并返回预览命令；不自动生图或批准外观。

常规用户验收使用[双皮肤组件页](http://127.0.0.1:4194/)（本机服务运行时可访问）。资产定位/切线手动工作台默认隐藏，仅供内部异常排查，不是用户必经步骤。自动化能力仍以执行文档当前状态为准。

已有素材的检查、组装和消费验证支持[可恢复的统一入口](docs/skin-workflow.md)：冻结输入、复用已完成阶段并保留失败记录；技术通过后明确待视觉审查，不调用模型。

检查能力的已知边界见[质量风险基线](docs/skin-quality-risks.md)，可用 `npm run skins:quality-risks` 重跑；目前不足以取消视觉审查。

新增[模板约束定位诊断](docs/skin-localization.md)。两套原始图集仍有碎片与跨槽歧义，当前仅输出证据，尚不能自动替代assembly裁切配置。

- Panel Slicer（面板自适应工具）：[统一入口](tools/panel-slicer/README.md)、[AI 后台接入](tools/panel-slicer/docs/integration.md)。输入单张 PNG 与尺寸配置，CLI 或 Node API 自动输出 PNG 及结构化结果；无需打开预览页面。
- 首套真实风格：[单板试验状态](docs/execution-plan.md#104-首套真实风格单板已生成几何检查未通过)、[风格 JSON 与单板计划命令](docs/skin-pack.md#绑定真实参考图的单板计划)。首次已授权试验因尺寸/几何不符被拒绝；用户资料保存在忽略的 work/ 下，规划和测试不调用模型。
- 原图到标准部件：[定位与规范化维护](docs/skin-normalization.md)、[S03 候选状态](docs/execution-plan.md#105-s03-后处理规范化候选已输出)。尺寸从模板派生，处理阈值独立维护；候选不冒充已接受资产包。
- S03 真实部件试验：[局部组件状态](docs/execution-plan.md#106-s03-修整与局部组件消费)、[本地交互预览](http://127.0.0.1:4176/)。9 个候选 PNG 已用于 4 类组件；状态/边缘修整和显示几何分别由皮肤策略与 skin-pilot.json 维护。
- 九宫格背景（Panel Slicer）：[使用与维护](tools/panel-slicer/docs/maintenance.md)。支持 LTRB、倍率、背景包绑定 Panel 和透明 PNG 导出；工具页“高级设置”内的“自适应验收”可导入背景包，验证原生父容器变化时边角、文字与按钮的表现。消费示例见 [app.mjs](examples/sliced-panel/app.mjs)。
- PNG 皮肤包：[导入、验证与维护](docs/skin-pack.md)、[当前 PNG 消费验证](previews/skin-packs/current.json)。运行 `npm run skins:preview-status` 检查来源，`npm run skins:check -- --browser chrome` 重建离线验证。
- 保留的画布候选（暂缓继续投入）：[画布使用与维护](docs/canvas-editor.md)、[当前编辑器版本](previews/editor/current.json)。运行 `npm run editor` 后打开本地 4175 端口。
- 编辑部件/板：[唯一模板 JSON](configs/skin-template-set.draft.json)。数量、尺寸和生产方式仍是讨论草案。
- 查字段、扩展方法、错误与恢复：[模板维护说明](docs/template-fields.md)。
- 查当前产物：[current.json](previews/skin-templates/current.json)。先运行 status，再按返回的 overview 路径打开自动生成对照页。
- 改组件配方/属性/状态/用例：[组件注册源](configs/component-registry.draft.json)。
- 改角色映射与使用元数据：[皮肤使用源](configs/skin-usage.draft.json)；仍是候选草案，真实切片、字体与几何待确定。
- 查组件目录与全部待执行用例：[合同维护说明](docs/contract-fields.md)、[当前合同入口](generated/component-contracts/current.json)。
- 看真实组件预览与验证结果：[组件运行时说明](docs/component-runtime.md)、[当前夹具报告入口](previews/components/current.json)。先运行 components:status，再打开其返回的 overview。
- 风格、字体资源及各类维护职责见执行文档 3.3 节；当前面板预设在 configs/panel-presets.json，组件示例在 configs/editor-blocks.json，画布在 configs/canvas-presets.json。

## 安装与构建

在本目录执行，依赖由本目录自己的 package.json 和 lockfile 锁定：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run templates:validate
npm run templates:build -- --browser chrome
npm run templates:status
npm run contracts:validate
npm run contracts:build
npm run contracts:status
npm run components:check -- --browser chrome
npm run components:status
npm run editor:check -- --browser chrome
npm run editor:status
npm run editor
```

选用已安装的 `chrome`、`msedge` 或 `chromium`；不自动下载浏览器。build 输出一套 `clean.png` / `review.png`，以及目录、对照页和模型几何投影，全部成功后才更新 current.json。status 会区分当前、过期、源无效、损坏与缺失。

`--config`、`--out` 可选。旧入口 `node scripts/render-templates.mjs chrome` 保留为统一构建命令的薄包装，不再写旧扁平目录。

contracts 命令不需要浏览器；支持 `--registry` / `--usage` / `--template` / `--out`。build 生成完整组件目录、属性 Schema、待执行验收矩阵与依赖声明证据。`validate --require-ready` 会拒绝当前草案，避免把候选模板误当成生产皮肤或可用组件包。

components:check 在无网络、软件 WebGL 的本地浏览器里运行独立断言，生成横竖版总览、四张方形尺寸/状态对照 PNG、冻结输入、报告和摘要。对照图由 fixtures/component-matrix.json 驱动，每张 4 类 × 3 档；它与生图用的独立部件模板分别管理。只有本轮断言及画布边界检查通过才更新其独立 current.json。它不启动 Web 服务，也不把夹具子集通过写成完整 P1 验收。

editor:check 生成自包含 HTML，离线验证真实画布操作，成功后发布独立版本。editor 只提供 loopback 静态预览，无写入 API；用户通过浏览器下载/打开 JSON。导出包为绑定工程版本的 fixture 文档与资源引用清单，尚不是携带真实资产的生产包。

## 目录职责

```text
ui-chain-harness/
  README.md
  docs/execution-plan.md               唯一执行与讨论文档
  docs/template-fields.md              已实现工具的字段与使用说明
  docs/contract-fields.md              组件合同的字段、扩展与维护方法
  docs/component-runtime.md            候选运行时 API、验证与限制
  docs/canvas-editor.md                画布验收、启动与维护说明
  configs/skin-template-set.draft.json  唯一活动模板源
  configs/component-registry.draft.json 组件声明与验收规格源
  configs/skin-usage.draft.json         候选皮肤映射及使用元数据源
  configs/canvas-presets.json          横竖逻辑画布
  configs/editor-blocks.json           添加组件时的示例内容子树
  configs/panel-presets.json           预设面板与方向变体
  schemas/                            字段合同
  src/templates/                      校验、派生、渲染、构建与状态检查
  src/contracts/                      合同校验、派生、版本核对与构建
  src/runtime/                        PixiUI/Layout 适配、资源和输入生命周期
  src/panel/                          文档校验、编译、事务、克隆与引用清单
  src/editor/                         本地编辑界面与静态构建
  tools/panel-slicer/                  面板自适应工具：核心、后台入口、界面、测试与文档
  fixtures/                           独立程序皮肤、按类型的样例与尺寸/状态矩阵
  scripts/                            CLI 入口
  tests/                              合同、故障和数据扩展验收
  previews/skin-templates/
    current.json                      唯一当前版本入口
    builds/<buildId>/                  不覆盖的完整构建版本
  archive/                            历史源、示意图和旧预览
  generated/component-contracts/      独立 current.json 与 builds/ 历史
  previews/components/                独立夹具报告、横竖/方形 PNG 与构建历史
  previews/editor/                    静态工作台、验收报告、界面 PNG 与历史
```

新增已有原语的部件/模板板只改 JSON；图片、部件数量、尺寸表、模型几何名单均自动派生。新原语或交互能力仍需工程实现。生成记录及 previews/archive 不作为第二份手工数据源。

`npm test` 运行离线合同、面板事务与故障测试；`npm run test:render` 检查模板 PNG，`npm run test:components` 检查组件交互子集，`npm run editor:check` 检查画布。选择已安装浏览器的方法见维护说明。本地静态预览按根仓库批准的目录例外运行，没有模型请求入口。
