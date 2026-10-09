# Apple 风格的分组设置布局试稿

用户认为三种 Skill 的真实结果基本相同，提出从布局入手，参考 Apple UI。此次沿用声音设置的原业务，做一份可试玩的浅深色程序试稿，模型及媒体生成调用均为0。

入口：`output/apple-grouped-audio-review-v3/review/index.html`。可以切换当前稿与试稿、浅深色，实际调整控件并下载离线包。`study-report.json` 记录试稿来源与源码摘要，`review/review-report.json` 记录浏览器和ZIP检查。日常默认主题未切换。

后续用户反馈图标及蓝色底块不好看，已提供[无底色图标精修试稿](plain-audio-icons.md)，保留本页的原布局和旧稿作为对照。

## 设计变化

参考 [Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout) 对对齐、层级和逻辑分组的指导，以及 [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables) 的设置列表方向。这里采用分组设置界面的结构，具体颜色、尺寸和控件美术是本项目的设计选择。

- 外层使用浅灰或纯黑背景，标题位于卡片之外。
- 两个音量控件放在同一圆角卡片，组内用内缩分隔线连接；静音、恢复默认各有独立分组。
- 恢复默认成为整行操作，关闭降低强调，保存保留主操作。
- 使用32px标题、17px正文、28px滑杆圆钮和较细轨道；蓝色用于操作和音量，绿色用于开启状态。
- 字体仍为现有环境字体，图标继续使用原来的自有素材。

这是一次结构和视觉层级的试稿，不是完整Apple原生界面或完整平台规范验收。390px入口验证的是等比缩放和容纳，未宣称移动端重新排版、动态字号或原生字体一致性。

## 实现边界

新增显式启用的 `surfaceStyle: grouped-v1`，绑定编译器 `0.21.0`；沿用 PanelSpec/Bundle 0.12 与现有 Pixi、状态、事件、ZIP和UGUI导出链。`src/grouped-presentation.mjs` 为Slider/Switch分组及单按钮设置行提供布局；现有显式按钮排列仍优先，其他控件沿用已有排版规则。

`examples/grouped-audio-v1/fixture.mjs` 只接受指定的程序声音夹具。它重新分组已有行，不改写原包；行对象及其顺序、文案、范围、默认值、试玩值、绑定、事件、动作、图标引用和素材闭包保持原样。明确的按钮尺寸、超宽拒绝、面板颜色仍受回归保护。新样式未加入日常生成目录或默认选择，也没有新增真实调用额度。

改动前已将上一份冻结计划的15份执行源码按摘要留存于 `output/grouped-layout-source-snapshot-v1/`。原计划、原模型文本、失败回执、原已接受面板及旧网页保持原样；它们按各自固定编译器重放。旧批次已关闭，不再使用其授权或尝试用变更后的源码续跑。

## 验证

最终全量回归1242/1242通过，输出为 `output/grouped-layout-regression-v4.txt`。新样式的4项对应回归覆盖浅深色的严格重编译、分组几何与分隔线间距、素材/业务/试玩保留、UGUI结构导出、版本拒绝、显式尺寸/颜色和越界拒绝；对应浏览器检查包括真实控件事件、实例状态隔离、恢复默认、文字无截断、两个实际下载ZIP的CRC/摘要、离线打开和无图库重导入。

v3全量回归的超宽负例最初使用900px，先被公开schema的512px上限拒绝，未到达测试期望的版面越界检查；负例改为500px，在公开范围内验证超过当前分组可用宽度的拒绝，产品约束没有放宽。原失败输出保留，最终v4全量通过。

最终试稿浏览器门禁8组通过；此前8份声音对照包使用新源码按原版本严格重编译通过。Unity编辑器和游戏接入均为 `NOT_RUN`，用户美术认可仍待评审。v1、v2试稿及回归输出保留，最终入口使用v3。

本地构建：

```sh
node scripts/build-grouped-audio-review.mjs --source output/skill-art-comparison-plan-v4 --output output/apple-grouped-audio-review-new
```

该脚本只消费本地已保存夹具，不导入模型运输；输出必须是新目录。4951服务没有被重启或结束，没有推送GitHub。
