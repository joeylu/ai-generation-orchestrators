# 菜单、表单与弹窗排版

`examples/modern-layout.catalog.json` 在 Semantic-v1 控件上显式启用
`presentationStyle: "focused-v1"`。八种主题版本为 `0.6.0`，编译器固定为 `0.16.0`，
支持现有 PanelSpec 0.7–0.14。旧主题目录、编译器和已保存面板不自动迁移。

程序根据控件种类测量排版，不根据按钮文字猜测行为：

- 全部为独立按钮的菜单使用居中、等宽的纵向按钮组；单分区重复标题隐藏。
- 表单的标签与输入框沿内容边缘对齐，保留输入错误行。尾部独立操作按钮靠右紧凑排列，与内容留出额外间距。
- 表单和确认弹窗的静态正文使用完整内容宽度，标签在正文上方。`wrap:word` / `textLayouts` 使用已有的完整字素分行程序；无换行声明时保持单行，放不下就明确失败。
- 操作区使用实际按钮字号测量宽度；多按钮放不下时按原顺序纵排，不裁剪或缩小文字。

显式 `actionLayouts` 优先，局部按钮尺寸、字号、圆形样式仍生效。
默认排版不改变控件顺序、ID、事件、提交范围、重置范围、创作默认值或试玩值。
带行标签的按钮继续使用列表排版，普通设置分区保留原几何。
超高正文沿用声明的滚动或拒绝规则；没有引入自动删除内容、逐帧重排或新业务组件。

规划提示暴露当前主题的排版能力，建议多句说明采用 `wrap:word`。
清除手动换行恢复单行，不会被主题再次强制换行。
会话校验按当前固定编译器核对每一条派生文本及位置；篡改正文或几何会失败。
Pixi 预览、宿主实例、离线运行包和 Studio 使用同一校验。
Unity 导出仍使用现有原生 UGUI 节点及相同分行和位置数据；本轮未运行 Unity Editor。

在本 Harness 目录执行：

```sh
node scripts/build-workbench.mjs --catalog examples/modern-layout.catalog.json --output output/my-layout-studio
node scripts/serve-workbench.mjs --workbench output/my-layout-studio --output-root output/my-layout-runs --port 0
node --test tests/focused-layout.test.mjs
node scripts/check-focused-layout-browser.mjs --output output/my-layout-review
```

浏览器检查覆盖实际输入、必填校验、提交与取消、菜单事件、确认按钮、390px 页面、
长正文滚动、组合页签及输入值保留、主题 Select，以及实际点击下载后的 CRC、摘要、重导入和离线打开。
所有样例均为程序夹具，模型调用为零，不代表新的真实模型生成成功率。
本工作区的[可交互对比](../output/panel-layout-review-v4/index.html?panel=menu)包含菜单、表单、弹窗、长正文、组合及设置六个入口。
