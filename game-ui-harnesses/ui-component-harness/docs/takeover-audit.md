# UI 组件 Harness 接手审计

审计日期：2026-09-08。本轮范围是核验交接材料、复现可执行基线、审计接手风险并确定仓库目录。
附件中的第 13 节是后续开发启动模板，本轮没有据此自动执行 C10–C16。

## 结论与落点

采用 `game-ui-harnesses/ui-component-harness/`，作为独立 Harness，与
`game-ui-harnesses/ui-decomposition-harness/` 并列。外部工程的 Button 实现可以继续使用，
无需重搭原型；当前不能把它标成完整 UI 组件自动化 Harness。

| 路线 | 输入与输出 | 边界 |
| --- | --- | --- |
| 已有 UI decomposition | 拆解计划、组件图片 → PSD 或 PNG ZIP | 素材处理、分层与视觉质量评审。 |
| 新 UI component | 局部图、intent、资源事实、明确布局 → 组件合同与可交互实例 | 组件语义、编译、运行时与验收。 |

不放入 artwork 类，不嵌入现有 Python 拆解包，也不在仓库根引入统一 Node 工程。
未来若复用拆解产物，另定义资源映射；拆解计划本身不证明组件类型、交互或可用字体。

## 材料身份

输入为 `button-harness-v0.1.0 (1).zip` 与
`ui-component-harness-codex-development-v0.2.md`。文件名后缀不影响本次摘要核对。

| 项目 | 实测 |
| --- | --- |
| ZIP 字节数 | 142857，与任务书一致。 |
| ZIP SHA-256 | `b7cb6dff9e46630ce38dde7ae00c8c61585f99a8109c565094c4e848696b043b` |
| ZIP 条目 | 49 个文件，无重复成员、越界成员或符号链接。 |
| 包内 SHA256SUMS | 48/48 文件摘要一致；除清单自身外无未列出的文件。 |
| 版本 | package 0.1.0；合同、intent、compiler 均为 0.1；文档 v0.2 不改变代码版本。 |
| 依赖锁 | 73 个依赖条目均来自公共 npm registry，均有 integrity；没有修改锁文件。 |
| 素材 | 已目视检查绿色“确定”按钮：整图保留米色背景和烘焙文字。没有组合图和独立分层素材。 |

包及原始历史报告在忽略的 `.tmp/ui-component-audit-20260908/button-harness/`
中解包供审计，不作为正式源码或公开发行内容。原下载文件未修改。
摘要核验的程序输出见 [archive-verification.json](../reports/archive-verification.json)。

## 本机基线

环境：Windows x64，Node v25.9.0，npm 11.12.1。
工作目录为审计副本的 `button-harness/`；未调用模型、生成美术或修改其他 Harness。

| 检查 | 状态 | 证据及限制 |
| --- | --- | --- |
| `npm.cmd test` | PASS，退出码 0，63/63 | [local-unit-tests.log](../reports/local-unit-tests.log)。这是本次运行，不是引用历史成绩。 |
| 锁文件安装 | PASS，退出码 0，安装 29 个适用包 | [local-npm-ci.log](../reports/local-npm-ci.log)。参数见下文。 |
| `npm.cmd run build` | PASS，退出码 0 | [local-build.log](../reports/local-build.log)，包括 TypeScript 检查与 Vite 构建。 |
| 锁文件未改变 | PASS | SHA-256 仍为 `7628098ad3a24b5a05b3cfe2adfa7843296b5ef34b320e44d5414ea1a18f967f`。 |
| 生命周期故障注入 | FAIL，已复现 | [audit-probes.log](../reports/audit-probes.log)，见问题 2。脚本退出 0 仅表示采集完成，不表示该行为通过。 |
| 浏览器 14 项合成检查、真实鼠标操作 | NOT_RUN | 本轮没有启动浏览器；包内 14/14 是上一环境历史记录。 |
| 生产 dist 浏览器运行、真机、组合图识别、用户外观验收 | NOT_RUN | 构建通过不证明这些能力通过。 |

安装命令：

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund --cache ../npm-cache --fetch-retries=0 --fetch-timeout=30000
```

本次安装跳过生命周期脚本；锁文件中声明安装脚本的包只有当前 Windows 不适用的
可选 `fsevents`。因此不能将这次安装记录写成“未加参数的 npm ci 已测试”。
依赖版本保留为 PixiJS 8.20.1、Vite 8.2.2、TypeScript 7.0.2。

R00 的静态核验、单测与构建已完成；浏览器验证未完成，R00 整体不标记全部通过。

目录文档落盘后另执行仓库检查：`git diff --check` 通过，
`python -B -m unittest discover -s .github/repository-tests -p 'test_public_boundary.py'`
为 8/8 PASS、退出码 0，涵盖拟公开文件的目录与敏感标记边界。
曾尝试同目录的全量 `test_*.py`：8 项通过，另外两个测试模块因当前 Python 环境
未安装 `ai_frame_animation` 而导入失败，退出码 1；未将仓库全量测试标为通过。
本次文档变更没有为此安装或修改其他 Harness。

## 接手问题与处理顺序

### 1. 正式迁入前：根契约与 Web 验收存在直接冲突

根 [AGENTS.md](../../../AGENTS.md) 的 Repository and test boundaries 明确写有
“Do not add Docker, web, database, WSS”，并规定嵌套规则不能放宽根规则。
任务书要求 Vite 页面与真实 PixiJS Web 画布，两者目前没有明确兼容范围。

建议正式开工时由用户明确启用此范围后，先修改根契约：仅允许本目录的本地组件验收页面、
静态构建及浏览器测试；继续保留部署、账号、数据库、工作队列和服务编排等禁令。
这是一项根规则变更，不能通过新增嵌套 AGENTS.md 或把验收页换个名字绕过。
本轮未修改根契约，也未把 Web 源码迁入正式目录。

### 2. P2，已复现：销毁订阅者抛错会留下订阅和未完成清理

包内 `src/button-state.ts:51` 的 `destroy()` 先设置 destroyed，再发出事件，最后清空订阅者。
`src/button-state.ts:22` 的 emit 没有隔离回调异常。首个 destroy 回调抛错时，最后一步不执行；
再次 destroy 又因 destroyed 标记直接返回。

本次注入两个订阅者，第一个在 destroy 时抛错：结果为 destroyed=true、第二个未收到通知、
内部集合仍保留 2 个订阅者。该观察使用测试脚本读取 TypeScript private 字段，仅用于验证，
不建议将其变为公共接口。现有 63 项单测没有覆盖这个场景。

`src/pixi-adapter.ts:156` 也直接依次销毁实例，因此此异常可能继续中断预览级清理；
该浏览器影响是静态推断，未执行 WebGL 注入。
在 C15 前修复：保证清理进入 finally，确定多订阅者异常传播策略，释放全部资源后显式报告错误，
并补实际回归测试。不能吞错伪装成功。

### 3. 正式迁入前：清除宿主配置，明确素材与源码的公开边界

`vite.config.ts:4` 带有原云环境的专用 host allowlist；package 脚本还默认监听全部网卡。
迁入时移除专用主机项，本地验收默认使用回环地址；部署相关内容不引入。

包内没有 LICENSE，package 标记 private，也没有用户原图可再分发的授权记录。
这不妨碍本地审计和工程开发，但公开发行前应补齐源码许可归属与样本来源记录，
不能仅凭 ZIP 摘要将原图判为可公开 fixture。当前根贡献规则要求私有原图保持本地。
公共测试优先保留已有程序绘制夹具；需要修改默认素材入口时明确记录差异。

### 4. C10/U20 前：资源引用规则还不是可交付资源规则

`src/contract.ts:64` 和 `src/intent-compiler.ts:50` 主要过滤 scheme。
实测两处均接受站点绝对路径 `/assets/button.png`、省略协议的网络路径
`//example.invalid/button.png` 和父目录相对路径 `../outside/button.png`。
前两者超出文档“相对路径或 HTTP(S)”的字面范围；父目录引用目前也没有资源根边界。

这不是已证实的文件读取漏洞，当前加载器是浏览器 fetch。问题在于迁入后若直接用相同校验器
导出可复用资源包，验证通过不保证重启、换目录后仍有效。
应将允许的资源表示、资源根、路径规范化、网络引用与临时预览地址分开定义，
由 intent 与合同共享校验，资源越界或无法打包时明确失败。

### 5. C15/C16：现有资源和探针只适合单个 Button

`src/pixi-adapter.ts:115` 由单实例销毁 texture/source，没有组件树共享资源所有权。
现有 `src/probes.ts:19` 把画布中心作为按钮内部点，把画布宽度的 95% 处作为外部点。
它适用于现有两个居中示例，不能直接复用为偏移、嵌套或大尺寸组件的通用交互验收。

扩展树时必须明确共享资源释放、相对坐标、命中目标、事件归属、整树失败清理与过期请求隔离；
探针应从实际目标的已知布局得到可验证坐标，并区分有交互和无交互节点。
“每棵树固定 6 个外部监听器”不能作为新阶段验收条件。

### 6. 产品缺口：已有编译器不等于完整 Agent Harness

包内实现的是固定示例驱动的 Vite 工程。没有可安装的公共库 exports、CLI、Agent Skill、
通用资源/intent 导入、可靠导出和版本化发行路径。没有在线视觉模型调用器。

首轮继续保留对话视觉 → 严格 intent 的人工触发方式。完成组合闭环后，为已实现的编译、
校验与输出补薄层自动化入口，再提供 Agent 使用说明与固定版本交付；这些目前均为计划。
不要将缺失能力包装成可调用命令，不要接入模型密钥或虚构 API 来完成表面闭环。

## 源码迁入方式

采用经过审查的文件清单迁入，不把整个压缩包目录直接作为公共发行内容。

| 内容 | 处理 |
| --- | --- |
| `src/contract.ts`、`intent-compiler.ts`、`button-state.ts` | 保留实现与旧测试，先修已复现清理缺陷。 |
| `resource.ts`、`pixi-adapter.ts`、`main.ts`、`probes.ts`、样式与页面 | 根规则范围解决后迁入，按 C10–C16 增量扩展。 |
| package、锁文件、tsconfig、Vite 配置 | 保持依赖版本；去除宿主配置；暂不为迁移升级依赖。 |
| tests、程序 fixtures、合同及 policy 示例 | 保留，并核查示例是否引用未迁入的私有素材。 |
| 原图、真实图 observation/compilation、原环境 reports | 原件留在本地审计区；获准公开的材料再按来源记录纳入。 |
| 历史 SHA256SUMS | 只证明原包，不在源码变更后冒充新版本完整性清单。 |
| 附件开发任务书与第 13 节启动模板 | 作为用户输入参考，不复制为仓库最高规则或内部交接提示词。 |
| node_modules、dist、原 ZIP | 保持忽略或放到正式 Release 产物；不提交源码树。 |

初次迁入直接将核准文件放到本目录，不再套一层 `button-harness/`。
先保留现有文件职责；随着实际实现再提取公共合同/编译核心、PixiJS 适配与验收界面。
独立发版时使用区别于现有拆解包 `ui-v*` 的组件标签，例如 `ui-component-v*`，
并由程序生成摘要；当前不增加发行脚本或发布任何版本。

## 按第 13 节接手时的首轮清单

1. 解决根契约的本地 Web 验收范围，按上述清单迁入；记录素材处理与配置差异。
2. 完成 R00：复跑迁入后的单测、构建、真实浏览器交互及故障路径，保留本次和历史记录的区别。
3. C10：明确新组件树版本、判别联合、完整节点与旧 Button visual 的区别；保留 v0.1 旧入口。
4. C11/C12：实现独立 Image 与 Text；字体来源、样式、测量、换行与溢出都显式定义。
5. C13：实现固定布局 Container、相对坐标、绘制顺序、全树 ID 唯一和规模限制。
6. C14：从明确资源事实与可核验布局编译稳定组件树，保持 ID、资源与输出可重复。
7. C15：实现整树资源准备、挂载、事件与销毁；补销毁异常、共享资源、重载和失败清理回归。
8. C16：用明确标记的程序底板、图标与独立 Text 完成真实 PixiJS 验收，继续回归原 Button。

缺真实组合图不阻断工程夹具开发；真实识图和分层仍保持 NOT_RUN。
后续 U20 自动化导入导出、Agent 入口和 API 接入各自按实际条件推进，动效和其他引擎保持未启用。

## 当前任务状态

| 项目 | 状态 |
| --- | --- |
| 本轮材料审计与目录定位 | COMPLETE |
| 正式源码迁入 | NOT_STARTED；本目录只有规划与审计记录。 |
| R00 | PARTIAL；本次单测/安装/构建通过，浏览器未运行。 |
| C10–C16 | NOT_STARTED |
| U20、L30、后续控件、动效和其他引擎 | NOT_STARTED |
