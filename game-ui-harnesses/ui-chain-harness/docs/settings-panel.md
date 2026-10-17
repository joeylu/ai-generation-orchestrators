# 真实皮肤设置面板

这是确定性的设置预设编译与本地交互预览，复用 PanelDocument、PixiUI 组件及 Layout 编译器。尚未接入自然语言解析或 AI 初稿生成，也不包含游戏音频系统、翻译系统或跨刷新存储。

## 唯一维护入口

| 修改内容 | 维护文件 |
| --- | --- |
| 标题、设置项、默认值、语言选项 | [settings-content.json](../configs/settings-content.json) |
| 横竖版面板尺寸、行列方向、间距、标签及控件尺寸 | [settings-layout.json](../configs/settings-layout.json) |
| 16:9 / 9:16 逻辑画布 | [canvas-presets.json](../configs/canvas-presets.json) |
| 具体皮肤图像、切线和文字安全区 | 对应皮肤的 assembly.json，再由程序组包 |

已支持 switch、slider、select 三种设置项。所有字段可配置 enabled（默认 true）；slider 必须显式提供 min/max/step/value，不再隐式固定 0–100。旧的内容 JSON 若缺少范围需先补齐；已生成 PanelDocument 不受影响。新增同类项目只改内容 JSON；数量增加导致溢出时，编译器明确拒绝，需要同时调整布局或另选预设。新增交互类型需扩展 settings.mjs 的映射及测试，不在这里复制控件实现。

横版采用标签/控件并排，竖版采用上下排布；均使用 Layout 流式容器。面板在画布居中，位置从画布和面板尺寸派生，不维护第二套节点坐标表。源内容不带纹理路径；实际包通过命令选择，产出的面板绑定该包 manifest 摘要。

## 构建与检查

在本 Harness 目录执行（替换路径中的示例值）：

```powershell
node scripts/settings-preview.mjs --package work/skins/example/assembled/<assembly>/package/builds/<build>/pack --out work/panels/settings
node scripts/settings-check.mjs work/panels/settings/<preview-id>
node scripts/surface-preview.mjs serve --out work/panels/settings/<preview-id> --port 4184
```

每次构建生成独立目录，包含横竖 PanelDocument、冻结内容/布局输入、自包含 HTML 和摘要报告。构建验证真实包及当前模板/配方/角色绑定，不调用模型或外部服务。检查使用离线浏览器和已有真实皮肤，产生 screenshots 与 checks.json；这些额外检查文件不手写成功状态。

面板文档可声明 imported 来源，加载时同时检查上下文绑定和实际皮肤 manifest 摘要；资源闭包按真实来源标记。既有 fixture 文档继续兼容。本地画布编辑器目前仍加载 fixture，因此不能直接在旧编辑器里打开这份 imported 面板，需使用加载同一真实皮肤的编译上下文。

## 操作和数据边界

- 开关、滑条和选择器使用现有 PixiUI 信号及组件状态；测试包含真实点击和键盘操作。
- 横竖切换和关闭后重开保留本次预览状态；刷新页面恢复内容 JSON 的默认值。
- 关闭隐藏设置界面并暂停交互，顶部“重新打开”恢复。
- “导出面板 JSON”导出当前方向的创作文档，不把临时操作写回预设，不覆盖本地维护源。
- 语言选择只验证选中状态，不声称界面翻译已实现；音量也不控制真实音频。

已增加原生 intent 0.3 到本预设的离线转换，见 [planning-integration.md](planning-integration.md)。预览命令可用 `--content <content.json>` 加载转换结果；缺省仍使用维护源 settings-content.json。本工具不将确定性预设编译称作 AI 生成。完整美术接受及生产接入另行验收。
