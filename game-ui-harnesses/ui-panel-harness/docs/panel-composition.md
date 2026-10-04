# 面板组合

`composePanelBundles(request, bundles, core)` 将已验证的 PanelBundle 0.4 合并成一个新的可移植面板包。
它不调用模型，也不修改来源文件。原有控件种类、顺序、范围、步长、初值、选项、禁用状态、文字、
当前试运行值、图标和重置范围全部保留。新布局采用测量规则，允许 column、row、grid 与原有嵌套分组，
长内容使用垂直滚动。单个包继续受 32 个分组、128 行、96 个布局节点、8 层和资源体积上限约束。

每个来源需要一个明确的 namespace，同一个面板也可组合多次。字段、行、分组和事件按来源重命名，
长名称使用确定性摘要后缀，完整映射保存到组合回执；来源的 reset-initial.fields 同步重写，不能越过来源范围。
恢复创作初值与保留当前试运行值仍是两个独立概念。来源的单分组标题使用来源面板标题；多分组标题
使用“面板标题 · 分组标题”，以便在合并后的界面区分来源。

目录必须完全一致，主题也必须一致，避免无提示改变已有外观。使用图片的来源必须引用同一资源库摘要；
相同图片字节只保存一份，相同资源 key 的元数据冲突会被拒绝。组合面板的背景由 surfaceFrom 明确选择
来源 namespace，或设为 null 使用程序化背景。所有来源行图标保留。

CLI 输入为一个 JSON 文件，包含 request 和与 sources 同序的 sourceFiles（路径相对输入文件解析）：

```json
{
  "request": {
    "panelCompositionRequestVersion": "0.1",
    "id": "combined-settings",
    "title": "综合设置",
    "sources": [
      {"namespace": "audio", "bundleSha256": "<exact-source-bundle-sha256>"},
      {"namespace": "graphics", "bundleSha256": "<exact-source-bundle-sha256>"}
    ],
    "layout": "grid",
    "width": 1400,
    "canvasWidth": 1464,
    "canvasHeight": null,
    "maxHeight": 480,
    "surfaceFrom": null
  },
  "sourceFiles": ["audio.panel.bundle.json", "graphics.panel.bundle.json"]
}
```

```sh
node scripts/compose-panels.mjs --input <composition-input.json> --output output/<fresh-composition>
node scripts/build-preview.mjs --bundle output/<fresh-composition>/panel.bundle.json --output output/<fresh-preview>
```

输出 composition.json 包含请求、面板包、来源摘要、命名映射和原始 provenance。提供原始来源包后，
`validatePanelComposition` 完整重放变换并比较结果，不能只修改回执或摘要来声称成功。
浏览器与原生引擎验证标志不会由组合器代替验收程序修改。

自动组合验收另外覆盖全 16 个真实面板的单列和双列、三个设置面板横排、同一面板重复实例和混合内容。
组合不会实现实际游戏跳转、联网、文件存档或业务数据绑定；宿主仍通过命名映射接收各来源事件。

真实 16 面板与组合合集还可一起生成 Unity 导入工具包并核对共享 Runtime、文件摘要、初值、
当前值、事件及重置映射：

```sh
node scripts/export-panel-evaluation-unity.mjs --run <accepted-16-run> --compositions <accepted-composition-preview> --output output/<fresh-unity-kits>
```

该命令只导出和验证文件，不启动 Unity；报告中的原生编辑器验收保持 `NOT_RUN`。
