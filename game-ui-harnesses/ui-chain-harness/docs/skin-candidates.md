# 候选生产统一入口

本入口处理已经生成的四图集，依次执行定位、试验配置生成、组包和组件检查。模型生成、任意新皮肤的元数据推导、视觉接受及正式发布不在本入口范围。最终状态固定为待视觉验收，任何阶段失败停止，不自动重试。

## 日常操作

在 Harness 目录执行：

```powershell
npm run skins:candidates -- build
npm run skins:candidates -- status --directory work/skin-candidates/<返回ID>
npm run skins:candidates -- preview --directory work/skin-candidates/<返回ID>
```

build 一次跑配置中的全部皮肤，每套完整处理四张图集，不逐板询问。自动传递中间结果路径，最后返回一条可直接复制的preview命令。preview 是前台loopback静态进程，关闭终端或中断即可停止；默认4196，端口被旧预览占用时保留旧进程，显式传 `--port 4197` 或先停止自己的旧预览。build不会切换现有预览或全局消费包。

默认配置为 `configs/skin-candidate-pipeline.json`，也可 `build --config <仓库内配置>`。每套只需配置id、label、四图集input、元数据baseline及显式的allowDifferentSourceTrial。路径相对Harness，素材输入必须在work下。新皮肤仍需要合适的元数据基准，不能据此声称只传四张图片便可泛化生产。

## 维护分工

| 维护内容 | 唯一入口 |
| --- | --- |
| 本轮皮肤列表、输入位置、预览端口 | skin-candidate-pipeline.json |
| 槽位和部件数量 | skin-template-set.draft.json |
| 定位关联和主要归属实验策略 | skin-localization-policy.json |
| 四张源图身份 | 各皮肤localization-input.json |
| 主题、密度、九宫格及端帽基准 | baseline assembly.json |
| 自动报告、裁切提案、试验assembly、包 | 程序生成，不手工改 |

森林的不同源试验开关仅表示允许执行明确的实验适配，不是视觉批准。不同源竖轨的半源宽端帽仍是试验假设；该规则在共享trialPart实现，不能在入口脚本复制另一套。

## 记录和失败处理

每次运行建立 `work/skin-candidates/<ID>`，记录配置快照、输入和源图摘要、工具指纹、各阶段开始/结果、汇总run.json和preview-runs.json。所有阶段执行前后核验输入及工具，变化即失败。底层工具保留自己的独立证据目录，汇总记录引用及关键证据摘要；status核验这些证据，preview另外验证完整消费包文件。

阶段结果只在子工具成功返回并通过状态检查后使用。失败报告指出皮肤和阶段，子工具stderr保存至failure-stderr.log；不展示部分成功的批次为完整预览。修复维护源后重新build，不手改成功状态或旧记录。

当前统一入口没有自动续跑或跨版本恢复：重新build会新建整批运行，原输入源也必须仍可访问。需要已有assembly的检查点恢复可单独使用[后处理恢复入口](skin-workflow.md)。两者职责不同，当前未把定位阶段迁入该恢复状态机。

已有4194验收版、4196候选版均不因build自动改变。未新增模型调用、session、后台任务、部署或用户调参界面。


输入框/下拉默认水平边距现由统一content-insets阶段推导，详见[内容边距维护](skin-content-insets.md)。无法识别边框时保留待复核状态，不继续猜值。


新皮肤默认使用profile模式，由通用规则生成密度、切线、端帽及基础安全区，见[参数维护](skin-metadata.md)。历史baseline模式只保留兼容试验；二者不能同时配置。


需要任务级断点恢复时，使用[固定任务DAG](skin-task-dag.md)的skins:task入口；本阶段仅已有四板源图，不自动提交生图。
