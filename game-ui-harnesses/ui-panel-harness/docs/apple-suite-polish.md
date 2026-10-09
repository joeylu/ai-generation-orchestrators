# Apple风格整套精修样本

沿用退出确认的紧凑精修方向，为主菜单、暂停、声音设置、画质设置、角色信息和退出确认提供一套浅深色候选，共12份。入口 `output/apple-suite-polish-v2/review/overview.html` 使用实际Pixi截图展示整体关系；点击面板进入 `index.html?panel=menu-light` 等并排对比页，可试玩和下载。

## 统一规则

- 使用完整20px圆角底板，28px面板内边距，24px标题、16px正文及按钮文字。字体族为 `Segoe UI, Microsoft YaHei UI, sans-serif`，实际字体由系统回退决定。
- 菜单和暂停收紧为428px宽，操作组居中，按钮280×48；蓝色主按钮、中性次按钮和文字入口形成层级。
- 声音与画质保持500px宽，滑块、开关及下拉沿用现有分组布局；恢复默认、关闭与保存集中到底部。保留原无底色声音图标，以及6px轨道、28px白色圆钮和边缘投影。
- 角色资料收紧到460px宽，资料和经验条在同一完整底板内；返回与查看装备沿用底部操作区。
- 两种颜色各自使用统一表面、文字和边缘色；深色主按钮使用较深蓝底，链接和滑块使用较亮蓝色，按钮文字对比在回归中检查。
- 退出确认直接复用上一轮精修，浅深色候选包SHA与 `apple-dialog-polish-v2` 完全相同；保留其428×269尺寸、细边线和轻量投影。

这里只统一比例、颜色和层级；菜单、设置、资料与确认仍使用各自已有的排版。总览缩略图为完整画布等比容纳，各面板原画布高度不同；进入对比页可查看完整尺寸和操作。

## 来源与实现

对照来源为 `output/apple-panel-samples-v4/review/` 的五类候选，声音采用 `output/audio-flow-review-v1/review/s1-{light,dark}.panel.bundle.json`；退出精修摘要锚点来自 `output/apple-dialog-polish-v2/review/`。

共享规则位于 `examples/apple-suite-polish-v1/art-direction.mjs`，夹具变换位于同目录 `fixture.mjs`，只接受指定程序夹具及行结构，拒绝模型来源。已有行对象、文案、状态、绑定、事件、动作与外部素材闭包保持；样式、分组和尺寸为明确的候选变更。

设置、菜单与资料复用 grouped-v2 / compiler0.24.0，退出确认复用 refined-v1 / compiler0.18.0。没有改PanelSpec、编译器、Pixi运行时、UGUI适配器、Studio默认或其他Harness。原未提交改动保留，没有新增模型或媒体调用，没有推送GitHub。

## 验证与限制

- 31项对应回归通过，记录为 `output/apple-suite-targeted-tests-v1.txt`：新增14项，加原多面板、退出精修及声音布局回归。检查严格重编译、源对象不变、业务与素材保持、完整底板、按钮命中区域及文字对比、清晰滑块、会话加载和UGUI结构。
- 60组面板浏览器检查通过，记录为 `output/apple-suite-polish-v2/review/review-report.json`：12份桌面/390px候选，按钮事件、滑块端点及拖动、开关、下拉、经验值更新、状态独立、实时导出与无文字截断。
- 12份实际下载ZIP完成CRC、逐文件摘要、严格重导入、无图库Studio导入/导出和离线打开。
- 6组总览浏览器检查通过，记录为同目录 `overview-report.json`：两种宽度的12张实际截图加载、六图显示、浅深切换、缩略图进入试玩、类型与颜色导航及返回。所有浏览器错误和外部HTTP请求为0。
- 24份原包严格重放且源文件字节摘要保持；最终 `study-report.json` 绑定所有来源、候选与执行源码。来源路径为Harness相对路径。首次v1结果保留，v2仅修正报告中的路径表达，12份候选摘要保持。

整套浅深色截图已人工查看，但用户美术认可仍记为 `NOT_RUN`。本轮为程序样本，不能证明真实自然语言输入覆盖；390px为固定画布缩放，不代表响应式重排。Unity编辑器及游戏接入均为 `NOT_RUN`，没有重跑无关全量回归。

```sh
node --test tests/apple-suite-polish.test.mjs tests/apple-panel-samples.test.mjs tests/apple-dialog-polish.test.mjs tests/audio-flow.test.mjs
node scripts/build-apple-suite-polish.mjs --source output/apple-panel-samples-v4/review --audio output/audio-flow-review-v1/review --dialog output/apple-dialog-polish-v2/review --output output/apple-suite-polish-new
```
