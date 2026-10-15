# UI 皮肤 → 组件 → 面板链路

当前本地 Studio 已接通：参考图 → S01–S04 组件图集及可选 S05 材质图集 → 自动拆分、切线、材质绑定 → 16 类组件 → AI 面板规划、预览与导出 → 独立画布编辑副本。

这些是已实现的本地能力。模型生成的美术质量、需求理解和最终布局仍须逐次验收；离线夹具通过不代表真实生成已通过。当前操作与验收以[本地 Studio](docs/local-studio.md)和[验收指南](docs/acceptance.md)为准，[执行记录](docs/execution-plan.md)保留各阶段当时的结果。

## 从这里开始

在本 Harness 目录安装锁定依赖，准备模板和合同，再启动本地服务：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run panel-sdk:install
npm run panel-sdk:check
npm run templates:build -- --browser chrome
npm run contracts:build
node scripts/studio.mjs work/studio/project.json 4310
```

打开 [UI Studio](http://127.0.0.1:4310/#library)。启动配置、已安装浏览器的选择与空库起步见[启动说明](docs/local-studio.md#启动)。服务仅监听本机；示例端口可按本机情况更改。启动不会替用户确认新的模型调用。重启前先核对没有正在运行的任务。

日常流程：

1. 在组件项目库新建项目，选择带图风格或上传参考图。默认开启“生成标题与面板纹理”。
2. 检查并确认批次：开启材质时为 4 张组件图集 + 1 张材质图集，30 个基础部件 + 3 个材质；关闭时为原 4 张、30 个部件。一次确认绑定本批摘要，每张最多一次调用，无自动模型重试。
3. 图集收齐后自动完成本地处理与组件检查，进入组件画布试玩 16 类组件。接收成功、程序检查通过和外观接受分别判断。
4. 面板生成台选择组件、预设或受限自定义需求、横竖比例；检查计划后确认一次面板模型调用。
5. 打开面板、核对需求和交互。画布编辑保存独立副本；“原始生成”和“原始交付”保留冻结结果。

空库时先创建组件项目，面板生成台没有可用组件会阻止提交。不要依赖历史示例端口、既有验收文件或他人的本机项目作为新项目的前置条件。

## 当前边界

- 运行时复用 PixiJS、PixiUI 和 Yoga/Layout；组件画布与面板编辑共用现有组件实现，作者文档、编辑状态和试玩状态分离。
- 新材质按 S05 固定槽位提取并绑定标题、分组标题和面板底纹，不新增第 17 类交互组件。详见[分层材质](docs/skin-surfaces.md)。
- 面板提供 ui-reference 五类八状态、独立 AI 仓库入口和受限自定义布局。仓库已接上游 context 0.12 / intent 0.13，其他入口仍使用自己的兼容协议；详见[规划接入](docs/planning-integration.md)、[仓库面板](docs/inventory-panel.md)和[自定义面板](docs/custom-panel.md)。
- 面板画布支持尺寸、自由位置、显示文字和样式编辑；保存后预览读取独立修订，不覆盖原始生成包。详见[画布编辑](docs/panel-size-editor.md)。
- Panel 规划默认使用已校验的官方 rc.8 锁定发布包，安装与开发模式见 [SDK 依赖](docs/panel-sdk.md)；缺失时明确停止，不回退到相邻源码。本地工具不提供部署、账号、数据库、队列或多人协作。
- 结果不明先检查可恢复图片；补图须新计划、新确认。本地确定性恢复不重新生成。详见[验收与失败恢复](docs/acceptance.md)。

## 开发与维护

```sh
npm run templates:validate
npm run templates:status
npm run contracts:validate
npm run contracts:status
npm test
npm run components:check -- --browser chrome
npm run editor:check -- --browser chrome
```

选用已安装的 `chrome`、`msedge` 或 `chromium`，不自动下载浏览器。模板和合同构建分别生成不可覆盖的构建目录及各自 `current.json`。`validate --require-ready` 对当前草案的拒绝是生产就绪限制，不是 Studio 是否实现的判断。

`npm test` 使用离线夹具与替身，不调用模型；组件和编辑器检查验证运行时子集，不证明任意真实风格都已接受。Studio 浏览器回归与真实验收的区别、命令参数和证据要求见[验收指南](docs/acceptance.md)。旧 `studio-real-acceptance.mjs` / `studio-real-followthrough.mjs` 不再作为生成入口。

| 维护内容 | 入口 |
| --- | --- |
| 基础组件模板 | [模板合同](configs/skin-template-set.draft.json)、[字段说明](docs/template-fields.md) |
| S05 材质模板与绑定 | [材质模板](configs/material-template.json)、[分层材质](docs/skin-surfaces.md) |
| 组件配方、角色、属性 | [组件注册](configs/component-registry.draft.json)、[使用映射](configs/skin-usage.draft.json)、[合同说明](docs/contract-fields.md) |
| 拆分、切线与皮肤候选 | [候选统一入口](docs/skin-candidates.md)、[可恢复工作流](docs/skin-workflow.md)、[定位诊断](docs/skin-localization.md) |
| 组件与布局运行时 | [组件运行时](docs/component-runtime.md)、[布局合同](docs/layout-contract.md)、[文字可读性](docs/text-readability.md) |
| AI 规划与兼容协议 | [规划接入](docs/planning-integration.md)、[能力对照](docs/panel-upgrade-matrix.md) |
| Panel Slicer | [工具入口](tools/panel-slicer/README.md)、[后台接入](tools/panel-slicer/docs/integration.md) |
| 历史实现与验收 | [执行记录](docs/execution-plan.md)；当时的端口、资产和统计不作为当前启动条件 |

生成日志、接收回执、交付清单和摘要由程序生成。不要手填成功状态、重写失败记录或复制生产目录作为第二份源码。
