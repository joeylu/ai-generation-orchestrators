# 面板视觉主题

新版目录为`examples/modern-mint-polished.catalog.json`，主题是`modern-mint-light@0.2.0`。
它显式声明`visualStyle: "modern-v1"`，要求PanelSpec 0.7和编译器0.7.1。
未声明这个字段的原目录继续使用原编译器；旧包导入后保持原主题。
规划和修改仍使用原协议，视觉主题不解释业务，不修改字段、默认值或事件。

## Modern Mint

| 角色 | 颜色或规则 |
|---|---|
| 预览背景 | `#142B32` |
| 面板和字段底色 | `#FFFFFF` |
| 设置行底色 | `#F1F6F4` |
| 主色 | `#0F7666` |
| 正文 | `#183A36` |
| 次级正文 | `#526B65` |
| 装饰分隔线 | `#DCE8E3` |
| 字体 | 本地Segoe UI、Microsoft YaHei及sans-serif回退，无网络字体 |
| 字号 | 正文16、分组18、面板标题28逻辑像素 |
| 圆角 | 面板16、设置行和操作按钮8逻辑像素 |
| 主操作 | 主色实底，按实际底色选择黑白文字 |
| 恢复默认 | 白底、主色描边及文字；动作仍只重置声明的字段 |
| 只读信息 | 面板底色，减少独立背景板 |

标题下有细分隔线。输入行标签与输入文本区域对齐，错误仍显示在字段下方。
Select折叠字段使用主题颜色；默认弹出菜单继续使用组件运行时的浅色样式。
显式选择的图片背景和图标保持原资源，不在换主题时偷偷改图。

## 标签与反馈

按钮保留原语义标签，同时使用一个显式Text子节点供Pixi绘制。
`attachPanelVisuals`在挂载后读取真实字形边界，并用已有组件呈现API居中该标签。
它不猜测中文字符宽度，不把本机字体测量写入PanelSpec或交付哈希。
窗口缩放、滚动与父按钮缩放继承已有变换；标签内容变化通过重新编译、挂载生效。
Unity导出跳过这个仅用于Pixi的标签子节点，由原生Button绘制一份居中标签。

按钮悬停复用已有MotionAnimator及corporate配置，100毫秒内缩放1%；按下和输入焦点由原控件即时呈现。
只更新发生交互的按钮，挂载时不安装会反复重绘全树的组件动效系统；共享组件源码保持不变。
滑条值、页签切换和进度更新继续即时生效。
系统启用`prefers-reduced-motion`时关闭动态反馈；运行中改变偏好同样有效。
关闭、替换和销毁面板时取消未完成动画，移除交互和偏好监听，再释放渲染器。
这些效果只改变呈现，不提交额外事件或执行游戏逻辑。

## 构建和检查

```sh
node scripts/build-workbench.mjs --catalog examples/modern-mint-polished.catalog.json --output output/my-polished-studio
node scripts/serve-workbench.mjs --workbench output/my-polished-studio --output-root output/my-polished-runs --port 0
node --test tests/panel-visuals.test.mjs
```

本工作区的[前后对照](../output/panel-visual-review-v4/index.html)包含16份保存的真实面板、
3份明确标记的表单/页签/进度程序夹具，以及5种同主题组合。
对照属于确定性换主题，不是新一轮模型生成；当前值和业务声明与原面板保持一致。
浏览器检查的独立结果见[检查报告](../output/panel-visual-browser-v7/visual-browser-report.json)。
734项回归与518项浏览器检查通过；24份实际下载ZIP完成CRC、逐文件摘要、离线打开和试玩状态重导入。
19份原主题预览同时检查通过；新主题16个面板与5种组合另含3份程序夹具，不作为新生成成功率。
浏览器前期的等待超时和大网格动效挂载FAIL保留。大网格定位到全树动效重置时反复重绘，
本目录内的逐按钮反馈适配修复后，定点107项及上述完整检查通过。
没有重新运行目标Unity工程，因此本轮原生运行和人工视觉审核仍为`NOT_RUN`。
这轮检查不代替原生成验收，不改写第一版收尾记录。
