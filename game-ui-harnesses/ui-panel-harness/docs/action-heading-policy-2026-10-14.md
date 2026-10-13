# 操作区标题显示策略 v3

已实现独立版本，新增模型调用0。采用 `modern-action-headings.catalog.json` 中的主题0.22.0（自动）或0.22.1（显示全部），Compiler 0.33.0。当前范围为PanelSpec 0.16。默认Studio/SDK目录仍是原 `modern-all-components.catalog.json`，本轮没有重启本地Studio或发布新SDK。

## 规则

自动 `concise-v3` 按结构判断，不依赖“暂停操作”“应用与重置”等词表：

- 无页签且只有一个分组：不显示额外分组标题。
- 无页签且有多个分组：纯Button分组不显示标题，内容分组保留。
- 有页签：保留所有分组标题，页签标签不变。
- 显式 `visible-v3`：保留全部分组标题，优先于自动隐藏。

语义分组名称保持原文，隐藏只改变标题绘制和相应高度测量。布局参数、控件内容与顺序、状态、动作及绑定保持不变。标题带消失会使面板高度、居中位置和可用宽度重新测量。多组纯按钮分类也会隐藏标题；如果分类名称有实际意义，应采用显式显示版本。目前仍为整面板策略，不支持逐组开关。

旧主题与旧编译器行为保留；新主题不能伪装成0.31/0.32编译。0.33继承主标题居中、按钮文本居中、输入状态与原生导出呈现行为。规划说明介绍新目录的真实能力。全量检查还发现旧原生0.8 schema描述被前一轮修改，已恢复其历史描述契约。

## 证据

六份保存的真实输出：旧批次两份暂停、两份通关结算，以及最近批次两份设置。每份分别采用自动与显式显示策略，得到12份离线交付。源文件SHA-256绑定到回归夹具，旧包先完整验证，新包经程序编译、校验、打包。没有改写原始模型记录。

- 六份真实方案回归夹具和结构边界测试通过；包含显式显示、Tabs保留、内容分组不按名称误删、拒绝错误编译器版本、Unity文档导出与旧包回放。
- 全量回归1779/1779通过。
- 12份交付114项浏览器检查通过，涵盖实际ZIP下载、挂载、标题中心、交互、重开与离线重载。
- 检视了暂停与设置初始截图：冗余操作标题消失，设置内容标题保留。未执行Unity原生运行测试；未声称模型遵循率提高。
- 不额外调整草稿尺寸，原有滚动仍可能存在，尤其显式显示模式；浏览器交互通过不是所有首屏按钮可见的保证。

[三栏对照页](../output/action-heading-review-v1/index.html) · [重放记录](../output/action-heading-replay-v1/input-adaptability-report.json) · [浏览器证据](../output/action-heading-browser-v1/browser-report.json) · [完整回归](../output/action-heading-full-regression-v2.log)

## 使用

新建计划显式选用 `examples/modern-action-headings.catalog.json`。已有0.16方案可调用 `headingThemeTarget(spec, sourceCatalog, targetCatalog, 'auto' | 'show')` 获取同颜色同模式的主题引用，再由正常编译/交付流程生成新包。不要直接改保存包的主题或编译器字段。旧方案不会静默迁移。

离线复现（输出目录必须不存在）：

```powershell
node scripts/replay-action-headings.mjs --output output/action-heading-replay-new
node scripts/check-input-adaptability-browser.mjs --run output/action-heading-replay-new --output output/action-heading-browser-new
node scripts/review-action-headings.mjs --run output/action-heading-replay-new --browser output/action-heading-browser-new --output output/action-heading-review-new
```
