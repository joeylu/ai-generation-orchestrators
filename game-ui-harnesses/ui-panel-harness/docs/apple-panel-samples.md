# Apple 风格多面板样本

沿用用户此前认可的声音设置方向，提供主菜单、暂停、画质设置、角色信息、退出确认五类样本，各有浅深色，共10份候选。最新入口为 `output/apple-panel-samples-v4/review/index.html`，左右并排比较原简约版与 Apple 风格样本；可切换类型和颜色、实际试玩、下载当前候选。原v3保留。

这轮用于评审布局与美术。样本由本地程序明确编写，模型及媒体生成调用均为0，没有消耗新的真实调用授权，也没有把试稿设为 Studio 默认。最终审美认可仍待用户评审。

| 样本 | 布局重点 | 可验证操作 |
| --- | --- | --- |
| 主菜单 | 居中标题、宽主按钮、次级入口降低权重 | 开始、设置、退出事件 |
| 暂停 | 继续游戏为主操作，返回主菜单为次级操作 | 继续、设置、返回事件 |
| 画质设置 | 两个滑块、下拉与开关归入一张卡，底部集中操作 | 端点与拖动、选项、开关、恢复、关闭、保存 |
| 角色信息 | 角色、等级、战力与经验集中展示 | 返回、装备事件、宿主更新经验 |
| 退出确认 | 完整圆角底板承载标题、正文与并列操作，退出使用红色 | 取消、退出事件 |

左右两份保留相同的行对象、正文、初始值、绑定、事件、动作与素材闭包。每组按钮统一使用文字，不增加装饰图标；所有事件只向宿主报告，没有接入游戏逻辑。字体继续使用 `Segoe UI, Microsoft YaHei UI, sans-serif`，没有引入 Apple 专有字体、图标或新的素材生成。

## 实现范围

`examples/apple-panel-samples-v1/fixture.mjs` 只接受0.23.0程序声音试稿作为主题来源，拒绝模型结果。原对照使用 minimal-v1 / compiler0.19.0；候选显式启用 grouped-v2 / compiler0.24.0，为已有分组设置补充 Select、静态 Text、Progress 和换行正文的排版。继续使用同一 PanelSpec、Pixi 与 UGUI 导出链，旧0.19–0.23版本保持严格重放。

会话校验按 grouped-v2 重新计算正文的完整行、宽度及位置，仍拒绝被篡改的派生文字或几何。新样式只出现在独立样本目录，没有修改日常主题目录、生成提示或已经保存的面板。

修改前17份相关源码及摘要保留于 `output/apple-panel-samples-source-snapshot-v1/`。本轮没有修改其他 Harness、结束服务、推送 GitHub 或接入游戏。

## 验证与保留记录

以下为原v3验收；v4对应证据见后面的底板修订。

- 全量1267项回归通过：`output/apple-panel-samples-regression-v1.txt`。新增12项覆盖10份浅深样本的内容/状态/事件不变、严格重编译、分组控件排版、正文派生几何校验、UGUI结构导出及模型来源拒绝。
- 50组浏览器检查通过：`output/apple-panel-samples-v3/review/review-report.json`。包括20份前后对照的桌面与390px显示、文字无截断、真实按钮/下拉/开关、滑块端点与拖动、经验更新、独立状态、严格试玩值导出。
- 10份实际下载ZIP通过CRC、逐文件字节数与SHA-256核对、无图库Studio重导入/重导出和独立离线打开。没有外部HTTP请求或浏览器错误。
- 24份原Skill、分组、图标、滑块和声音连续布局对照包严格重放通过：`output/apple-panel-samples-v3/compatibility/legacy-replay-report.json`。
- `study-report.json` 绑定原包、候选摘要及执行源码；截图保存在同级 `review/`。390px是面板等比缩放，比较页变为上下排列，未宣称移动面板重新布局。

首轮 `output/apple-panel-samples-v1/` 的退出确认暴露正文会话校验仍查找旧行容器，分组编译已将文字平铺到卡片；修正会话校验并增加篡改几何拒绝回归。第二轮 `output/apple-panel-samples-v2/` 桌面与10份交付包检查通过，但390px比较页出现CSS Grid最小宽度溢出；随后修正比较页列宽约束。原失败报告和截图均保留，最终v3通过。没有重新生成或修改模型输出。

Unity 导出结构与源码包已验证；Unity 编辑器导入和原生交互仍为 `NOT_RUN`。这些样本没有新增真实自然语言理解验收，也不能替代全输入场景覆盖。

## 退出确认底板修订（v4）

用户指出退出游戏的整体底板消失。原因是 grouped-v2 设置页默认令外层面板与画布同色且圆角为零，只有正文分组卡可见，标题和按钮显得悬空。退出确认应作为完整弹窗承载内容。

仅在退出夹具声明现有 `appearance.panelColor`、`panelRadius` 和 `canvasColor`，恢复浅色白底、深色深灰底的20px圆角整板。取消按钮改用控制区灰底，避免融进整板。没有修改编译器、协议、控件、文字或事件。

15项对应回归通过：`output/apple-exit-plate-targeted-v1.txt`；50组浏览器检查及10份实际ZIP离线/无图库往返通过：`output/apple-panel-samples-v4/review/review-report.json`。截图已查看。`exit-plate-scope-report.json` 确认10份原对照和其余8份候选摘要完全不变，只有退出的2份候选外观改变，其几何、业务与目录保持；原v3的20份包严格重放通过。本轮为夹具外观修订，未重跑全量回归；模型调用0，默认未切换，Unity编辑器仍未验收。

```sh
node scripts/build-apple-panel-samples.mjs --source output/audio-flow-review-v1/review --output output/apple-panel-samples-new
node scripts/check-apple-panel-compatibility.mjs --output output/apple-panel-samples-new/compatibility
```
