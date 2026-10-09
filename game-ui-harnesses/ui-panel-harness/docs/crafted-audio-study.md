# 声音设置美术试稿 · crafted-v1

用户认为 minimal-v1 仍一般，要求试用更偏美术指导的 Skill。本次只处理一个声音设置程序夹具的浅深色版本，保留现有 PanelSpec → 确定性编译 → Pixi → PanelBundle / UGUI 导出链路。没有推广到其他用途或修改日常默认目录。

## 三款可试玩候选 · 2026-10-09

用户随后澄清要比较不同 Skill。这里 A/B/C 均为同组指导下的视觉变体，不能作为 Skill 对照成绩。独立 Skill 对比的冻结输入和等待授权状态见[不同 Skill 对照计划](art-skill-comparison.md)。

用户对首稿反馈“有好一些”，随后要求更多方案测试。这是改善反馈，尚未选定或确认美术定稿。新增两款局部方案，当前入口为 `output/audio-art-options-v1/index.html`：

| 方案 | 设计差异 | 逻辑面板尺寸 |
| --- | --- | --- |
| A · 薄荷紧凑 | 原稿原样保留，左对齐标题，纵向设置和轻量操作区 | 500 × 464 |
| B · 温润留白 | 温暖中性色，24px居中标题，更舒展的设置间距，集中排列底部操作 | 480 × 532 |
| C · 横向分栏 | 26px左对齐标题，两项音量并排，静音独立成行，底部操作分主次 | 720 × 412 |

页面可切换三款及浅深色、试玩、下载；各实例独立保留试玩值。A 的浅深色面板包直接复制上一份通过报告的产物，程序核对字节摘要完全一致。B/C 只使用既有 PanelSpec 能力和编译器0.20，未新增主题编译逻辑或修改 Studio 默认。B 用 Spec 0.12 明确指定标题对齐；C 用 Spec 0.10 的嵌套 row/column 明确分组。行对象、行顺序、文案、默认值、试玩值、动作、事件、绑定及原素材闭包均与 A 一致。

候选工厂为 `examples/crafted-audio-v1/options.mjs`，拒绝模型面板或非指定声音夹具；独立的目录/主题版本记录两款本地试作。预览入口 `options-review.mjs` 仍挂载真实 PanelHost/Pixi 实例，没有用 HTML 重画控件。

`output/audio-art-options-v1/review-report.json` 首次运行 PASS，共25组：6份严格包/业务/素材核对、6组实际交互与无图库导出、6份实际下载ZIP的CRC/逐文件摘要/重导入/离线打开、1组实例状态及重置隔离、6组390px画布容纳与候选导航。原有 crafted-audio 的4项对应回归再次通过。Agent已查看两款新方案浅深色截图及窄屏页面；这些检查不等于用户美术通过。

该次只增加夹具、对照页与文档，未改生产源码，因此不重复无关的1226项全量回归。新增真实模型调用0、图像生成0、浏览器外部请求0；Unity原生编辑器仍 `NOT_RUN`。窄屏是固定画布等比缩放，C定位宽屏，未宣称移动端重排或文字可读性验收。未重启4951、安装Skill或推送GitHub。

复现时输出目录必须不存在：

```sh
node scripts/build-audio-art-options.mjs --source output/impeccable-audio-review-v4 --output output/my-audio-art-options
```

报告程序生成来源摘要及本次工厂、预览入口、构建器和共用编译器的源码指纹。历史试稿和报告保持原样。

## 首稿的设计依据

参考 [Impeccable SKILL.md](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/SKILL.md) 的 Operate 模式，以及其 [layout](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/reference/layout.md)、[typeset](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/reference/typeset.md) 和 [craft-floor](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/reference/craft-floor.md) 指导。沿用简约、薄荷强调色和自有 Modern Mint 资源，调整比例、文字层级、分组间距及操作区主次。启动器和自动 detector 未安装，因此直接读取项目上下文；这是参考其设计方法的局部试作，不冒称执行了完整 `/impeccable critique` 或 detector。

## 试稿范围

- 面板宽500px，内容边距36px，标题28px加粗，正文16px；数字采用中性次要色，滑杆缩短并与文字列对齐。
- 冷色中性表面，取消底板描边与模拟阴影；浅色图标底色与表面统一色相，原图标 PNG 字节保留。
- “恢复默认”使用轻量文字按钮，“关闭”使用次要底色，“保存设置”保留强调色。两份试稿的所有控件、动作、事件、字段、默认值和试玩值与来源一致。
- 控件图形以2倍像素尺寸生成，引用坐标同步缩放，保持逻辑尺寸、命中区域与数值语义。旧 minimal-v1 继续使用原1倍像素配方并通过原包的严格重编译。
- 仅在该程序夹具中，将动作分组标题“操作”明确改为重复面板标题并收起重复显示，同时替换原夹具的三个180px等宽按钮布局。工厂拒绝处理保存的模型面板。独立提供的不同分组标题、显式按钮排列和局部样式仍优先。

候选主题由 `examples/crafted-audio-v1/fixture.mjs` 生成：目录 `crafted-audio-study@0.1.0`、主题 `0.10.0`、`surfaceStyle: crafted-v1`、编译器固定 `0.20.0`。新增版本是为了保持原0.19及更早版本的确定性回放；旧面板没有自动升级。

字体仍为环境字体，未嵌入或下载字体。390px证据检查固定画布缩放及容纳，不宣称实现响应式重排。

## 2026-10-09 证据

| 检查 | 结果 |
| --- | --- |
| 全量本地回归 | 1226/1226，`output/crafted-regression-v1.log` |
| 当前试稿 | `output/impeccable-audio-review-v4/index.html`，前后对比，共4个实际Pixi实例 |
| 浏览器验收 | `review-report.json` PASS；8组检查，浅深色滑杆、开关、保存、关闭、恢复默认、无图库导出、实际ZIP下载、逐文件摘要、重导入、离线打开、390px画布容纳 |
| 截图 | 同目录 `audio-dark.png`、`audio-light.png`、`comparison.png`、`narrow.png` |
| 数据与资源追溯 | 同目录前后4份 `*.panel.bundle.json`；报告记录来源文件摘要及前后包摘要 |
| Unity | UGUI导出数据、资源闭包与打包检查通过；原生编辑器 `NOT_RUN` |
| 美术 | 原报告用户美术确认 `NOT_RUN`；随后用户反馈“有好一些”，尚未定稿 |

首次单元检查发现收起重复标题后的动作分组不足既有配方80px最小高度，按配方保留空间；随后修正测试读取Unity节点字段的位置。浏览器v1的浅色鼠标操作未先将画布滚入视口；v2/v3保留窄屏容纳失败。后者最终定位为Pixi画布整数高度比外层分数高度多不足1px，对照页增加1px容纳空间，v4全部通过。未删除失败或改写原报告。v2之后候选面板的包摘要保持相同，修复只涉及对照页及验收脚本。

新增真实模型调用0次，图像生成0次，浏览器外部请求0次。没有安装新Skill、接入游戏、推送GitHub或重启4951进程。现有24项输入场景覆盖和原真实结果结论保留，本次不新增真实语义验收。早期Modern Mint只作为已有美术参考；本次仍使用自有资源。

三款候选仍待用户选择美术方向。程序通过只说明对应交互与交付检查通过。
