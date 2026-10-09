# 声音设置图标精修

用户反馈 Apple 分组试稿的图标，特别是图标与底色组合不好看。本轮只处理这一层：去掉蓝色圆角底块，重新绘制主音量、音乐、静音三个图形，统一28px画布、1.65px线宽、圆端点与留白。浅色使用深墨色，深色使用柔白色；音乐音符头采用小面积实心形状。具体图形为本项目新绘制，没有使用 Apple 图标素材。

对比入口：`output/apple-line-icons-review-v1/review/index.html`。默认展示无底色版本，可切换原分组稿与浅深色；两份候选均可试玩和下载。原布局、标题、文案、行顺序、颜色令牌、控件范围、状态、绑定和动作保持原样。

用户反馈该版好一些，但滑块看不清；后续提供[滑块清晰度修订](slider-clarity.md)，保留本版作为直接对照。

## 现有链路内的实现

新增可选主题字段 `iconStyle: plain-v1`，要求 `surfaceStyle: grouped-v1`，绑定编译器0.22.0。此字段关闭行图标底块，不自动选图、重画或改色；与主题匹配的图标仍通过精确版本素材引用提供。普通生成目录和Studio默认未切换。没有改写原核心12个图标、原已保存面板或模型结果。

`examples/plain-audio-icons-v1/fixture.mjs` 提供有界SVG和只接受既有分组程序夹具的工厂；`scripts/build-plain-audio-icon-review.mjs` 使用现有 SVG 校验、Sharp导入、素材库验证、PanelBundle编译、Pixi与UGUI打包。浅深色六份SVG逐一重放到PNG，核对非空透明图、连续alpha、透明像素RGB归零及图形边缘留白。颜色已写入各自素材；本试稿不宣称任意主题颜色变化时自动适配。

普通Skill对照继续要求素材闭包完全相等。仅此图标试稿显式传入三行替换清单，附加门禁要求其余规格、布局、颜色令牌及业务完全相等；替换清单、闭包角色和精确键也必须匹配。改动前12份源码摘要和原文留存于 `output/grouped-icons-source-snapshot-v1/`。

## 验证

- 全量回归1247/1247通过：`output/plain-icons-regression-v1.txt`。对应图标及原分组9项回归通过：`output/plain-icons-targeted-v2.txt`。
- 浏览器8组检查通过：实际Slider/Switch/按钮事件、状态隔离及恢复默认、文字无截断；两份实际下载ZIP核对CRC/摘要、离线打开及无图库严格重导入。
- 12份旧对照包按各自固定编译器严格重放通过：`output/apple-line-icons-review-v1/legacy-replay-report.json`。原0.21.0的图标底块行为保持。
- `study-report.json` 记录源码、来源面板和新素材库摘要；`review/review-report.json` 记录浏览器结果。截图已人工查看，最终美术喜好等待用户评审。

初次新增回归将父节点连同整棵子树重复比较，因子图标预期去掉底块而失败；调整为逐节点比较自身属性及子节点身份后通过，产品要求未放宽。

模型和媒体生成调用均为0。UGUI结构及交付包已生成，Unity编辑器验收与游戏接入均为 `NOT_RUN`。4951服务检查时仍在，未结束或重启进程；未推送GitHub。

本地重建（必须使用新输出目录和已有Sharp，不安装依赖）：

```sh
node scripts/build-plain-audio-icon-review.mjs --source output/apple-grouped-audio-review-v3/review --output output/apple-line-icons-review-new --sharp-module <installed-sharp-module>
```
