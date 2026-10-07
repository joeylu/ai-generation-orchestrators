# 同组按钮的排列和形状

已生成的 modern-v3 面板支持修改纯按钮分组的排列、对齐、间距和尺寸。比如：

> 将现有三个播放按钮改成1:1正圆，在同一排居中排列，保留图标、顺序和动作，其他不变。

不必提供像素值；编辑器可以选用56×56、间距16的视觉默认值。按钮仍使用原来的ID、图标字符、事件和动作，不删除重建，也不覆盖试玩值。

## 合同

[EditContext 0.3](../schemas/panel-edit-context-v0.3.schema.json) 向编辑模型提供 `set-action-layout`。首次设置升级为 [Spec/Bundle 0.9](../schemas/panel-spec-v0.9.schema.json)，由编译器0.9.0生成几何；已保存的旧上下文和面板按原版本重放。

新编辑上下文现为0.4，另支持同组重排和单按钮样式；生成Intent 0.9也可直接描述组内排列。见[扩展合同](panel-control-editing.md)。

```json
{
  "op": "set-action-layout",
  "sectionId": "existing-section",
  "layout": {
    "direction": "row",
    "align": "center",
    "gap": 16,
    "buttonWidth": 56,
    "buttonHeight": 56,
    "shape": "circle"
  }
}
```

`direction` 为 row/column，`align` 为 start/center/end；间距为0..128整数，宽高为44..512整数。circle必须等宽高，半边长圆角优先于全局按钮圆角。default使用主题或自定义按钮圆角。`layout:null` 清除该组的显式排列，恢复自动布局，已升级的文档保留版本号。

操作只能指向已有分组，且组内每行必须是无外部行标签的Button。整排按钮、间距和文字必须放得下，否则整批拒绝，保留原面板。当前支持按钮内文字和图标字符；外置资产行图标、混合输入/滑条分组及跨组自由拖放不在这个操作范围内。

操作须引用本轮原文证据，整批修改计一轮，与其他入口共用每面板十轮上限。撤销、刷新与同面板导入不返还轮次。组合器重映射sectionId；Pixi和Unity导出共享同一份宽高、位置、圆角与原事件。

## 验证边界

确定性回归覆盖原生模型响应schema、引文绑定、旧上下文重放、横排/竖排/恢复、正圆尺寸、溢出拒绝、原事件、试玩值、十轮限制、组合与Unity导出文档。程序夹具不代表真实模型成功率；Unity编辑器原生导入须单独验证。
