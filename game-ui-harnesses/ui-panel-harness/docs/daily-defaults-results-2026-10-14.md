# 简短口令规则接入日常默认

本轮真实模型调用 **0**。已接入源码和本地 SDK rc.6 候选，尚未提交、打标签或发布。
已打开的旧 Studio 构建未重启；源码下次启动与新安装 SDK 才会使用这些默认。

## 默认变化

Studio 和 SDK 共用 `src/default-catalog.mjs`，选用 `modern-compact-message`。
生产规划器直接调用共享草稿提示，实验脚本只重新导出同一实现。
新默认保留 16 种组件、浅深色与 4 种配色及明确小标题选项。
重复小标题采用 concise-v4；短确认正文保留内部标签、完整正文和按钮语义，采用 0.36.0 紧凑居中排版。
其他完整组件面板为 0.34.0。明确尺寸仍优先，长段落保留左对齐。
静态角色占位保持中性，示例业务数据不冒称真实结果；按钮只通知宿主。

旧保存包和目录不自动升级，旧目录的规划提示保持完全相同。
运行时没有新增读取外部 skill 的步骤，沿用经过真实测试的简短草稿规则。

## 离线验证

| 检查 | 实际结果 |
| --- | --- |
| 完整源码回归 | 1971/1971，0 失败 |
| 日常默认直接传输 | 8 条短口令通过测试替身，未替换生产提示 |
| 上一批真实上下文提示比较 | 8/8 与原已批准提示逐字一致 |
| 已安装 SDK | 39 项通过，10 次测试替身调用 |
| SDK 常规浏览器 | 17 项通过 |
| 16 种组件浅深色交互与导出 | 12 项通过 |
| 4 个确认框桌面／390 像素窄屏 | 24 项通过，真实按钮事件均检查 |
| 最终安装产物与浏览器检查版比较 | 308 份文件完全相同 |
| 新 Studio 静态构建 | 完成，12 个图标，未重启已有入口 |

浏览器检查共 53 项，未访问外部服务。Unity 原生验收本轮未运行。
安装包验收夹具已移除固定旧主题版本，旧目录仍生成相同夹具。
此前中间目录与失败保留；未修改旧生成回执、交付包或审计结果。

最终候选：`output/daily-defaults-sdk-candidate-v3/ai-ui-panel-harness-0.1.0-rc.6.zip`

大小 **4,431,342 字节**，SHA-256：

`4184225a9e24bdeadf92d3aec90222f92b8666e29b6b5eb937ca5225cdd0a61d`

它记录真实源码 dirty 状态，`publicationEligible:false`，仅供本地验收。
最终版只改变 SDK 文档与其派生校验文件；源码、运行时、资源、目录与前一候选逐字相同。
重新安装校验通过，308 份实际导出文件也与已通过浏览器检查的目录完全相同，因此保留该浏览器证据，不冒称又运行一次。

## 证据与下一步

本地证据（不随 Git 提交）：

- `output/daily-defaults-closeout-v1/closeout.json`
- `output/daily-defaults-full-regression-v3.log`
- `output/daily-defaults-sdk-installed-v4/installed-package-report.json`
- `output/daily-defaults-sdk-candidate-v3/documentation-parity.json`
- `output/daily-defaults-prompt-parity-v1/parity.json`
- `output/daily-defaults-sdk-browser-v1/browser-report.json`
- `output/daily-defaults-components-browser-v1/browser-report.json`
- `output/daily-defaults-compact-browser-v2/browser-report.json`
- `output/daily-defaults-studio-build-v1/workbench-build.json`

上一轮 [8 次真实测试](compact-message-results-2026-10-14.md)证明了有限上下文中的效果。
本轮离线默认接入不能冒称完整默认目录的新真实测试。
已冻结 [8 类日常默认真实验收计划](daily-defaults-plan-2026-10-14.md)，预检通过，授权未授予，调用 0。
新批次通过并完成文案、视觉审阅后，再收尾提交和发布 rc.6。
