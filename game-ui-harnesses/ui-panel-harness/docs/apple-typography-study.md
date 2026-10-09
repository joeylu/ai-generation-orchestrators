# Apple面板字体对比

用户反馈整套Apple方向的字体仍不舒服。本轮固定上一轮的字号、字重、行距和布局，用两款中文字体在真实Pixi面板中对比，暂不切换默认。

入口 `output/apple-typography-review-v2/review/index.html?panel=audio-dark-noto`，左侧为当前字体，右侧可切换Noto Sans SC或等线。声音设置、角色信息、退出确认各有浅深色，共12份候选，支持独立试玩和下载。页面下方附同字号的字形样本。

## 字体及实际加载

当前字体栈为 `Segoe UI, Microsoft YaHei UI, sans-serif`。本机浏览器的字形探针确认中文使用Microsoft YaHei UI，英文及数字使用Segoe UI，普通与粗体分别检查。

| 条件 | 字体栈 | 本机实际中文字体 |
| --- | --- | --- |
| 当前 | `Segoe UI, Microsoft YaHei UI, sans-serif` | Microsoft YaHei UI |
| Noto候选 | `Segoe UI, Noto Sans SC, Microsoft YaHei UI, sans-serif` | Noto Sans SC |
| 等线候选 | `Segoe UI, DengXian, Microsoft YaHei UI, sans-serif` | DengXian |

数字和英文继续使用Segoe UI，中文换为候选字体。浏览器报告同时检查普通与粗体字形探针的实际平台字体，以及Pixi节点使用的完整字体栈，候选中文字体未加载则失败。

参考本机 `ui-ux-pro-max` 的定向检索：`Chinese sans interface typography --domain typography` 返回适用于简体中文界面的Noto Sans SC。等线为本机已安装的另一种字体候选，具体搭配为本地试稿；不把Skill推荐视为用户审美通过。没有安装或下载新字体，没有复制系统字体文件。

## 范围与来源

来源为 `output/apple-suite-polish-v2/review/` 中三类面板的六份候选原包。`examples/apple-typography-v1/fixture.mjs` 仅接受指定程序夹具和原字体栈；只修改活动主题的字体族及候选身份，模型来源拒绝。

原行对象、文字、状态、绑定、事件、动作、布局、字重、行高、字号、颜色及素材资源字节保持。构建器将新文档字体族规范回原值后，与原组件文档逐字段比较；没有通过修改保存的组件输出实现字体替换。

复用0.24.0与0.18.0编译器、PanelSpec、Pixi及现有交付链，没有修改生产源码、默认主题、UGUI适配器或其他Harness。模型与图像生成调用0，没有推送GitHub。

## 验证

- 43项对应回归通过：`output/apple-typography-targeted-v2.txt`，新增12项，加上一轮31项。覆盖字体族之外的文档完全一致、严格重编译、源对象不变、业务/资源保持和非法来源拒绝。
- 60组面板浏览器检查通过：`output/apple-typography-review-v2/review/review-report.json`，包括桌面与390px、无文字截断、按钮、滑块端点与拖动、开关、经验值更新、独立状态和实时严格导出。
- 12份实际下载ZIP完成CRC、逐文件摘要、严格重导入、无图库Studio导入/导出及离线打开。
- 16组字体与导航检查通过：同目录 `typography-report.json`。12份候选逐一检查普通/粗体中文与英文的实际平台字体；两种宽度下切换字体、类型和浅深色保持其他选择，页面无横向溢出。所有浏览器错误与外部HTTP请求为0。
- 六份原包严格重放，构建前后源文件字节摘要保持；`study-report.json` 绑定来源、候选和执行源码。六张代表性桌面截图已查看，用户美术认可仍为 `NOT_RUN`。

## 已知边界与失败保留

首轮 `output/apple-typography-review-v1/` 使用Noto Sans SC优先的整栈字体，声音与角色页正常；退出确认的粗体按钮触发 `TEXT_OVERFLOW: sample-exit.row.confirm.control.center-label`，浏览器门禁失败。原包、截图、失败报告与构建输出保留。v2采用Segoe UI负责英文/数字、Noto负责中文的搭配，仍保留原字号、字重、文字槽尺寸及溢出检查。没有裁字、缩字、修改源包或放宽门禁。

当前交付能力仍为 `environment-family`。候选包不内嵌字体文件，缺少字体的设备会回退；本机离线成功不证明跨设备字体一致。UGUI源结构保持，但原生导出不包含这些字体文件，也没有验收Unity中的字形，原生与游戏接入为 `NOT_RUN`。

另在deviceScaleFactor=2下确认现有预览仍使用1倍画布绘制，报告记为 `EXISTING_1X_LIMITATION`。本轮没有改渲染分辨率，也未宣称解决高DPI文字清晰度。390px为固定画布缩放。程序字体样本不代表真实自然语言输入覆盖，没有重跑无关全量回归。

```sh
node --test tests/apple-typography.test.mjs tests/apple-suite-polish.test.mjs tests/apple-panel-samples.test.mjs tests/apple-dialog-polish.test.mjs tests/audio-flow.test.mjs
node scripts/build-apple-typography.mjs --source output/apple-suite-polish-v2/review --output output/apple-typography-review-new
```
