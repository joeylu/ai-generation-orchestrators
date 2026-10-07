# 标题对齐与独立底板

用户可以说“把音乐播放器标题居中，给标题加深绿色底板，高56，其他保持不变”。操作作用于现有面板标题，正文、分组标题和按钮不随之改变。选择了行控件时需先取消选择。

`set-title-bar {op,style}` 使用完整的七字段样式：`horizontalAlign`（left/center/right）、`verticalAlign`（top/middle/bottom）、`backgroundColor`、`textColor`、`cornerRadius`、`fontSize`、`padding`。前六项的 `null` 表示继承；未要求修改的对齐轴保持原来的排版。颜色是 `#RRGGBB`，圆角0–128，字号8–96，内边距0–64，数值均为整数逻辑像素。`style:null` 清除标题样式，不重置标题区域高度。

标题底板只在明确指定背景色时创建独立容器，内部保留唯一标题 Text。高度使用已有 `set-layout.titleHeight`。容不下的字号或内边距会原子拒绝，不自动扩大画布，不替换当前面板，不消耗修改轮次。

新能力采用 Spec/Bundle 0.12、编译器0.12.0、EditContext 0.7。Pixi 按实际字形尺寸调整位置，不运行持续刷新循环。Unity 导出使用原生 UGUI Text 的 TextAnchor 与独立 Image 容器。旧版本上下文和包按原合同回放；组合要求标题样式一致，冲突会明确拒绝。

同一面板仍最多十轮成功修改；标题操作不扩大所选控件的作用范围。澄清历史中已有“保留对齐”的回答时，新的居中意图应重新明确提出。
