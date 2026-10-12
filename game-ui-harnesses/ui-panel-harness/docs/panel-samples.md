# 当前默认链路的代表面板对照

本轮只新增程序夹具、浏览器对照工具和验收记录。沿用 `modern-image-slots` 目录、PanelIntent 0.11、PanelSpec / Bundle 0.15 及编译器 0.29.0，没有调整生产默认、核心编译器或已保存面板。

入口：`output/panel-samples-review-v2/index.html`。五类面板各有浅深色，共十份可试玩样本；可切换样本、恢复初始状态及下载初始样本 ZIP。图片为缺图占位，未生成角色立绘。实际 PNG 绑定另见[图片槽对照](image-slots.md)。

| 样本 | 主要检查 |
| --- | --- |
| 声音设置 | 两个滑块、开关、按字段恢复默认和保存事件；两项操作完整可见 |
| 创建角色 | 说明、必填输入、最小长度提示、禁用提交及合法文本提交 |
| 角色卡片 | 三个角色名各展示一次，图片无动作，三个按钮分别通知宿主 |
| 下载进度 | 只读进度、宿主更新 0/57/100、不伪造用户事件、取消操作 |
| 综合页签 | 当前八种内容行的组合、Select 键盘选择、滚动、输入提交、切页保值；聚焦底部操作后完整露出 |

声音样本最初包含恢复默认、关闭、保存三项操作，默认纵排令保存进入滚动区；最终夹具需求采用恢复默认和保存两项常用操作。这个调整属于样本编排，不是新增自动精简用户需求的规则。

综合页签保留必要滚动。提交动作遵守现有 input 字符串字段合同，性别 Select 通过独立事件通知宿主，不把 enum 字段塞入 `submit.values`。这项边界新增了拒绝用例，没有扩大核心能力。

## 路径与验证

`examples/panel-samples-v1/fixture.mjs` 明确编写五份原生响应，`build-panel-samples-review.mjs` 依次调用现有工作台 `prepare → materializePanelIntent → checkPanelProposal → acceptProposal`，随后走实际 Pixi 适配器与现有 Web/UGUI 打包工具。没有模型运输或自动重试。

```sh
node --test tests/panel-samples.test.mjs tests/current-catalog-coverage.test.mjs tests/input-coverage-v2.test.mjs
node scripts/build-panel-samples-review.mjs --output output/panel-samples-review-v2
node scripts/check-panel-samples-browser.mjs --review output/panel-samples-review-v2 --output output/panel-samples-browser-v4
node --test tests/*.test.mjs
```

2026-10-12 确定性验收：

- 定向测试 67/67 通过，完整回归 1523/1523 通过。
- 十份样本构建、Bundle JSON 往返及 UGUI 文档/ZIP 校验通过；每份 ZIP 精确字节数、SHA-256 与逐文件摘要写入构建回执。
- 实际浏览器 44/44 通过，包括文字不省略、桌面控件尺寸、鼠标/键盘交互、输入校验、角色独立事件、只读进度、Tabs 状态保留及聚焦操作完整露出。
- 实际试玩状态导出、无图库重导入通过；五份深色实际下载 ZIP 的字节及逐文件摘要、离线打开和重新打开通过。
- 开启 reduced-motion 检查；375px 竖屏和 812px 横屏检查对照页及全部预览不横向溢出。面板仍使用已有固定画布缩放，这不是响应式重排或移动触控验收。现有桌面 Select 控件高 40px，不宣称全部达到原生移动触控尺寸。

对应文件：

- 构建回执：`output/panel-samples-review-v2/acceptance.json`。
- 浏览器回执及浅深色、滚动与页签截图：`output/panel-samples-browser-v4/`。
- 定向及完整日志：`output/panel-samples-targeted-v4.log`、`output/panel-samples-regression-v1.log`。

早期失败记录原样保留：`panel-samples-unit-v1/v2.log` 包含提交字段越界及测试导航字段误名；`panel-samples-browser-v1/v2/` 包含验收输入焦点恢复错误和对桌面 Select 误用 44px 门槛。对应修正分别为合法夹具与新增拒绝用例、沿用公开导航字段、实际点击恢复原生输入焦点、按现有桌面合同检查并标注移动验收边界。`panel-samples-browser-v3/` 的 44 项已通过；v4 补强滚动后聚焦按钮完全可见及页签保存点击检查后复核通过，没有修写旧回执。

本轮参考本机 ui-ux-pro-max 的字段附近反馈、明确提交反馈及浅深色分别检查规则。结果证明样本可编译、可交互及可离线交付，不证明模型能自主产出相同排版或所有输入均被理解。人工美术认可、Unity 原生导入、消费方 Web 验收均为 NOT_RUN；真实模型及图片生成调用为 0，未发布新 SDK，未修改 Docker/Web 消费项目。
