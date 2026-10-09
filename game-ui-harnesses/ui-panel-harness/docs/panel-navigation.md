# 主题页签

`examples/modern-navigation.catalog.json` 是0.17主题页签目录，继续用于已保存面板。
日常默认已升级为[refined-v1](panel-refined-surface.md)，包含下述页签能力。
八种主题版本为 `0.7.0`，显式声明 `navigationStyle: "tabs-v1"`，
保留 `semantic-v1` 控件与 `focused-v1` 排版，固定编译器 `0.17.0`。
支持现有 PanelSpec 0.7–0.14，不新增用户需求字段。

页签使用主题的控件背景、面板背景和强调色。选中状态同时改变文字颜色、背景和底部下划线，
普通与选中文字对比度至少 4.5:1，指示线至少 3:1；用户自定义颜色仍经过同样的对比度选择。
等宽页签、48px 高度、原点击范围及内容几何保持一致，不按标签文字猜测行为。
样式 PNG 由确定性程序在编译时生成，不来自纹理资产池。

Pixi 沿用现有 Tabs 控件、枚举状态和事件。鼠标切页；用 Tab 聚焦页签后，方向键、Home、End 切页。
切换不重建内容，不清空输入值、其他页的设置或正文滚动位置。
组合面板仍按来源限定提交和重置字段，不改变业务范围。
旧目录与已保存的旧编译器产物继续原样重放，不自动迁移。

Unity 导出适配器升级到 `0.1.5`。原生 UGUI Button/Text 和现有 Graphic 绘制页签，
`PanelNode` 增加可选的 `tabActiveColor`、`tabActiveTextColor`、`tabIndicatorColor`。
共享 Runtime 使用原有五个脚本及 GUID；无需逐面板复制脚本。
新导入包不携带程序生成的 Pixi 页签纹理。旧文档未声明这些字段时保留原绘制方式。
已有 Unity 项目升级仍需走原有 Runtime 身份核验，不绕过版本或本地修改检查。
本轮验证导出数据与包内容，未运行 Unity Editor，不声称通过原生交互验收。

在 Harness 目录运行：

```sh
node scripts/build-workbench.mjs --catalog examples/modern-navigation.catalog.json --output output/my-studio
node scripts/serve-workbench.mjs --workbench output/my-studio --output-root output/my-runs --port 0
node --test tests/navigation.test.mjs
node scripts/check-navigation-browser.mjs --output output/my-navigation-review
```

浏览器检查覆盖八种主题的真实输入、下拉选择、键盘切页、跨页提交、隐藏页值保留、
长正文滚动位置、390px 窗口、实际下载 ZIP 的 CRC/摘要、重导入和离线切换。
样例由程序夹具生成，模型调用为零，不代表新的真实模型生成成功率。
本地交互对比（本地产物：`output/panel-navigation-review-v6/index.html?panel=modern-blue-dark`）包含八种主题。

带说明的表单可声明[完整说明正文](literal-body-copy.md)，避免多句内容被缩短成第一句。
