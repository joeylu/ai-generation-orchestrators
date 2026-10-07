# 目录与依赖边界

所有 Panel 功能继续维护在 `ui-panel-harness`，没有另建 Harness。

| 目录 | 职责 |
| --- | --- |
| `src/` | PanelSpec 校验、编译、状态、编辑、组合、交付和 Studio |
| `src/workspace/` | 同仓库组件的浏览器入口、兼容性探针和开发依赖要求 |
| `src/textures/` | 重绘配方、筛选规则及确定性复验；不负责文件发布 |
| `adapters/` | 可选模型接入与 Unity 导出；不定义中立面板协议 |
| `scripts/` | 可直接运行的命令及验收入口；旧文件名继续有效 |
| `scripts/lib/` | 命令共享实现，目前集中开发工具解析 |
| `schemas/`、`prompts/` | 版本化输入输出协议与模型指令 |
| `catalog/`、`examples/`、`tests/` | 目录数据、公开样例与无模型回归 |
| `docs/` | 当前用法、协议说明和独立保留的历史验收记录 |
| `output/`、`.tmp/`、`test-results/` | Git 忽略的交付、运行中间物和浏览器证据 |

## 共享组件

当前仍是工作区开发集成，需要同级 `ui-component-harness`。组件源码只有两个接入点：

- Node：`src/component-adapter.mjs`，供离线校验、编译和打包使用。
- 浏览器：`src/workspace/component-browser.mjs`，供 Studio、预览和 Pixi 宿主使用。

两者共用 `component-contract.mjs`：检查 schema 0.2、必需 API 和 Input 的
`valueOverflow: "ellipsis"` 扩展。旧组件即使也标为 0.2，缺少该扩展仍会明确失败。
这是协议兼容性检查，不能代替输入、按钮和字体等运行时验收。
适配器只读共享源码，不修改相邻 Harness。

`requirements.mjs` 集中声明当前接受的 PixiJS、Vite 和 Playwright 精确版本。
开发脚本通过 `scripts/lib/workspace-tools.mjs` 解析包入口，不引用工具内部文件名。
依赖使用相邻 Harness 已安装的开发环境；Panel 未发布独立 SDK，也没有隐式安装步骤。
升级共享工具时应更新要求并运行回归，不自动接受其他版本。

在 Panel 目录运行 `node scripts/check-workspace.mjs`，或 `npm run doctor`。
此命令只检查源码协议、包身份/版本及工具能否载入；不启动浏览器或服务、不联网、
不安装依赖、不调用模型。输出包含版本与错误码，不包含本机路径。
它不检查可选 Codex CLI、Sharp 或 Unity 的配置；这些由对应命令单独检查。

## 纹理流程

`texture-library.mjs` 负责入库、发布和包校验。`texture-redesign.mjs`、
`texture-curation.mjs` 负责工作流；它们与包校验共同使用 `src/textures/` 的规则。
规则模块不反向导入工作流或包 I/O，因此无需通过动态 import 绕开循环依赖。
原模块的公开函数导出继续保留；资产 ID、配方、筛选政策和包格式没有升级。

## 历史记录与后续整理

当前入口见 [文档索引](index.md) 和 [命令索引](commands.md)。
旧 schema、prompt、验收脚本和报告仍用于重放旧包、核验冻结计划；没有改名或回填结果。
历史 `output/` 不会自动更新，也不会变成当前源码已验收的证据。

本轮不自动删除本地产物。运行中的 Studio、原始输出和失败证据继续保留。
未来归档应先核对交付包、运行引用及服务使用情况，再逐项处理。
`src/workbench.mjs` 仍集中管理页面交互，后续可按存档、编辑和交付职责拆分；
本轮只整理依赖边界，避免同时改动用户正在使用的交互状态。

## 本轮验证（2026-10-08）

- 1069 项本地回归全部通过，包含旧组件扩展缺失、工具入口兼容与模块边界检查。
- 23 项 Studio 夹具流程与 17 项下载包流程通过；使用 0.1.0 主题的完整历史目录。
- 当前 0.4.0 目录的新构建通过 8 项保存结果重放检查：导入真实 0.14 Bundle、
  输入与提交、刷新保存、实际 ZIP 的 CRC/摘要/重编译、离线打开、窄屏及重新导入。
- 重绘配方与筛选规则与整理前的函数体逐字比对一致；33 个范围外已修改文件的摘要未变。

本轮模型调用为 0，Unity 原生导入为 `NOT_RUN`。
工具加载器首次复验失败已修复；目录配置错误、过时 UI 断言与其失败报告均保留在忽略的
本地产物中，最终通过结果使用新目录记录，没有覆盖失败记录。
运行中的 Studio 保持原构建；本轮验收在独立构建与浏览器上下文完成。
