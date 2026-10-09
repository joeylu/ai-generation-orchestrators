# 声音设置连续布局试稿

用户认可图标和滑块有所改善，但认为布局仍不舒服，并提供当前浅色页面截图。本轮将音量、音乐、静音合为一张卡片；恢复默认成为底部左侧的次要文字操作，关闭与保存对齐在右侧同一行。画布从540×640收为540×540，字体、主色、图标及滑块美术保持上一版。

入口：`output/audio-flow-review-v1/review/index.html`。可切换上一版和浅深色，实际试玩及下载。截图已查看，最终布局喜好仍待用户评审。

## 范围

`examples/audio-flow-v1/fixture.mjs` 只接受指定的0.23.0程序声音试稿，使用现有PanelSpec的分组、嵌套流式布局、按钮布局及单按钮尺寸，不新增协议、编译器版本或渲染链。原六个行对象与顺序、数值范围、试玩值、绑定、事件、动作、图标引用及全部资源字节保持。只有已声明的分组、画布、底部布局和恢复默认按钮尺寸/底色改变。

底部使用现有等宽双槽：左侧恢复默认，右侧关闭与保存。独立试稿目录将分组和实际使用的按钮行recipe最小宽度调整到220px以容纳这些槽，Slider/Switch的最小宽度保持；没有改公共目录。`scripts/lib/audio-flow-study.mjs` 要求候选严格等于这份声明的布局，并核对字体、颜色、状态、业务和所有资源字节。

原0.23.0编译与控件美术源码未修改。改动前12份源码原文和摘要保留在 `output/audio-flow-source-snapshot-v1/`，原预览及已接受结果保留；日常Studio默认未切换。

## 验证

- 对应16项回归通过：`output/audio-flow-targeted-v1.txt`。新增3项覆盖浅深色严格重编译、同组控件、页脚同轴与无重叠、保存右边缘对齐、原业务和资源不变、无额外标题、UGUI结构导出及无关编辑拒绝；同时运行原分组、滑块和Skill对照相关回归。
- 12组浏览器门禁通过：真实Slider/Switch与按钮事件、独立状态与恢复默认、文字无截断；桌面与390px的端点和圆钮拖动；两份实际下载ZIP的CRC/摘要、严格重导入和离线打开。390px仍是等比缩放，未宣称移动端重新排版。
- 20份旧对照包严格重放通过：`output/audio-flow-review-v1/legacy-replay-report.json`。
- `study-report.json` 记录原包与执行源码摘要；`review/review-report.json` 记录浏览器结果。未重新运行与本轮无关的模型调用。

本轮模型及媒体生成调用均为0。Unity编辑器与游戏接入均为 `NOT_RUN`；没有重启服务或推送GitHub。

```sh
node scripts/build-audio-flow-review.mjs --source output/slider-clarity-review-v2/review --output output/audio-flow-review-new
```
