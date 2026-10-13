# 短输入草稿排版修复与离线重放

2026-10-13。新增模型调用 **0**。本轮复用上一批已保存的真实模型输出，不能计作重新生成成功率。

## 结果

- 原批仍为32次真实调用：20份草稿、5次澄清、6次校验失败、1次连接不确定、4项未运行。原记录未改写，连接不确定后未重试。
- 离线重放22份：原20份交付加2份原本因 `CONTROL_WIDTH` 失败的有效方案。
- 六份正文滚动的方案增加可用高度，按钮不再需要滚动才能看到；两份加载面板恢复编译。另有一份画布宽度从480变484，以保持32像素边距。共9份尺寸变化。
- 22份面板通过177项实际浏览器检查。首次交互前检查无正文滚动、每个按钮有非零渲染边界且完整位于面板与画布内；继续检查标题居中、保存状态、交互、重开、离线重载及实际ZIP下载校验。测试视口1120×1150，不代表所有设备尺寸均已验证。
- 全量离线回归1768/1768通过。没有运行Unity原生验收。

[修复前后对照（36项，含未成功项）](../output/short-draft-fit-review-v1/index.html) · [浏览器证据](../output/short-draft-fit-browser-v2/browser-report.json) · [重放记录](../output/short-draft-fit-v2/input-adaptability-report.json) · [全量测试](../output/short-draft-fit-regression-v2.log)

## 实现与边界

新增显式启用的 `fitDraftPanelLayout(spec, catalog, core, {mutableDimensions})`，从公共入口导出。调用方必须明确哪些尺寸是可以调整的建议值；默认空数组保持固定尺寸，不从自然语言猜测。当前仅支持无外部资源、无页签、无边框的0.16 flow/modern-v3面板。

辅助函数根据内容测量增加允许变动的高度；只有编译器报告控件宽度不足时才逐步增加允许变动的宽度。不会改动控件种类、顺序、文案、状态、按钮动作或样式。固定尺寸需要滚动时返回 `FIXED_DIMENSIONS_REQUIRE_SCROLL`，不能宣称内容全部可见。

此轮只用于固定短输入数据集的显式重放，**尚未把Studio默认生成切换为draft-first或自动尺寸调整**，编译器与历史包行为没有整体替换。真实输出中的八个问题方案已固化为回归夹具。重放对原报告哈希、计划摘要、原提案摘要及输出校验和进行程序验证。

此外，原生意图schema和简短实验提示明确：submit只引用Input；设置保存/应用通知使用emit；reset只引用现有状态控件；索引不得重复。验证器提供不存在目标、重复目标、非Input提交、非状态重置四类精确诊断，保留安全字段路径，仍拒绝错误而不代改或重试。已有Tabs测试同步检查新的精确诊断。

原四份无效意图没有保存可重放的原始内容，因此不能宣称其已被修好；本轮只证明新增诊断和约束在夹具上正确。澄清合理性、草稿所补内容是否合适、skill是否改善布局，仍不能由这一轮的技术通过率得出。

首次重放目录 `short-draft-fit-v1` 因脚本误读提案摘要字段中止，保留为不完整输出；修正为规范JSON摘要校验后写入全新v2目录。最终浏览器证据使用v2。原模型记录未改写。

## 复现

从Harness目录执行下列命令，输出目录必须不存在；均为离线，不调用模型：

```powershell
node scripts/replay-short-draft-layout.mjs --run output/short-input-real-v1 --audit output/short-input-audit-v1 --output output/short-draft-fit-new
node scripts/check-input-adaptability-browser.mjs --run output/short-draft-fit-new --output output/short-draft-fit-browser-new
node scripts/review-short-draft-fit.mjs --run output/short-draft-fit-new --before-browser output/short-input-browser-v1 --browser output/short-draft-fit-browser-new --output output/short-draft-fit-review-new
node --test tests/*.test.mjs
```
