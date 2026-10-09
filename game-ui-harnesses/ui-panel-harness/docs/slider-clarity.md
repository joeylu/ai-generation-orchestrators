# 声音设置滑块清晰度

用户认为无底色图标版好一些，但滑块看不清。本轮只调整Slider美术：原浅色白圆钮与白卡片相近，原边线在2倍素材下只有约0.5px；现在保留28px白色圆面，增加1px不透明边缘和轻微下投影，未填充轨道加深，轨道由4px调整为6px。

入口：`output/slider-clarity-review-v2/review/index.html`。默认展示「清晰滑块」，可切换上一版与浅深色，实际试玩和下载。图标、布局、文案、控件范围、默认及试玩状态、绑定和动作保持原样；用户审美认可仍待评审。

后续用户反馈好些了，但布局仍不舒服；新增[连续布局试稿](audio-flow-study.md)，保留本版的图标、字体和滑块作为布局对照。

## 实现

新增显式主题字段 `sliderStyle: raised-v1`，要求分组表面，绑定编译器0.23.0。仅Slider使用新绘制的确定性RGBA圆钮和轨道，Switch、Input和Progress继续使用原图；日常目录和默认主题未切换。新圆钮使用36px透明画布容纳投影，圆面保持28px；轨道端点和圆钮定位共用同一几何，端点时整个素材在控件内。

`src/raised-slider.mjs` 负责圆钮绘制及浅深色配色，`src/minimal-skin.mjs` 接入显式样式，原版本的像素和路径保留。`examples/slider-clarity-v1/fixture.mjs` 只接受上一版指定的程序声音夹具；本地对照门禁逐节点核对，只有Slider的appearance允许变化。原图标闭包、其余节点以及所有业务都必须相等。

## 验证

- 全量回归1252/1252通过：`output/slider-clarity-regression-v1.txt`。对应14项回归通过：`output/slider-clarity-targeted-v2.txt`。
- 新5项回归覆盖浅深色的严格重编译、像素边缘/白圆面/柔和投影/透明RGB、端点素材容纳、版本拒绝及其他控件与业务不变。当前浅深色的边缘和未填充轨道相对卡片均达到项目检查的3:1对比；不宣称任意自定义配色的完整可访问性验收。
- 12组浏览器门禁通过，包含浅深色真实事件、状态隔离及恢复默认；桌面和390px宽度下两个Slider的最小值、最大值及圆钮拖动；两份实际下载ZIP的CRC/摘要、严格重导入及离线打开。390px仍为等比缩放，未新增移动端重排。
- 16份旧对照包按原固定版本严格重放通过：`output/slider-clarity-review-v2/legacy-replay-report.json`。改动前14份源码存于 `output/slider-clarity-source-snapshot-v1/`。

`study-report.json` 保留来源面板和源码摘要，`review/review-report.json` 保留浏览器检查及原生未验收边界，浅深色截图已查看。

初次本地检查有两处验收脚本错误：对比度函数将sRGB指数写为2而非2.4；端点检查将最大值点击落在控件右边界之外。修正计算公式和控件内部点击点后，原候选面板摘要未变，v2复核通过；原v1失败回执和回归输出保留，没有降低断言、修改数值映射或重新生成模型结果。

模型及媒体生成调用均为0；Unity编辑器验收和游戏接入均为 `NOT_RUN`，没有重启服务或推送GitHub。

```sh
node scripts/build-slider-clarity-review.mjs --source output/apple-line-icons-review-v1/review --output output/slider-clarity-review-new
```
