# ScrollView 滑块纵向三段切片 v1.0（唯一合同）

只扩展 ScrollView 的滑块，不扩展其他组件或水平/九宫格作者格式。
唯一作者字段：appearance-binding.json → bindings[].states.scrollView.scrollbarThumbSlices。
复用已有 scrollbar-thumb 素材；不创建新素材路径、同义字段或业务行为。

```json
{
  "scrollbarThumbSlices": {
    "version": "1.0",
    "coordinateSpace": "thumb-source-pixels",
    "top": 4,
    "bottom": 5
  }
}
```

4/5 是20像素高程序夹具的测试参数，不能照搬到真实包。拆分端必须查看真实滑块PNG，显式确定上下固定段。

- top/bottom 是实际 scrollbar-thumb PNG 中的整数像素高度；不是注册后坐标、轨道坐标或原始大图坐标。
- 上段 [0,top)，中段 [top,H-bottom)，下段 [H-bottom,H)。宽度整段保留，不做左右切片。
- 动态长度仅伸展中段；顶部和底部只随整个控件的基础缩放变化，不随内容比例拉长。
- source像素声明从绑定到运行时不做单位转换；运行时按viewport基础缩放应用一次。
- 当前模式只有stretch，不支持tile，不猜切线，不采样颜色决定主题。
- 必须同时声明已有 scrollbarInsets。该合同保证可用轨道容纳原始滑块；切片不修改轨道留白。
- 保留现有比例长度算法和源滑块最小高度。因此最终高度至少为原始滑块高度，固定段不会相互挤压。
- 切片不把长滑块变短；内容只比视口长24像素时，滑块仍应接近轨道全长。
- 继续使用原透明像素、正常纹理过滤、既有层叠和命中区；切线附近允许正常线性过滤混色。

严格校验：对象恰好含 version/coordinateSpace/top/bottom；版本只接受1.0，坐标空间只接受thumb-source-pixels。
top/bottom必须为有限非负整数，top+bottom严格小于源图H，必须留下非空中段；允许其中一端为0。
未知字段、错误类型、错误版本、缺失留白、尺寸越界均明确失败。素材引用/路径/摘要沿用原有严格校验。
缺少scrollbarThumbSlices的旧包继续整图伸展；旧消费者应拒绝此未知字段，不可删除后降级导入。

运行时唯一落点：ScrollView.props.appearance.scrollbarThumbSlices，同结构同单位。
保存、重开、完整ZIP导出、官方CLI再导入保留该字段。素材、原图、映射、状态及unknown字段不得因该扩展改写。
渲染内部使用Pixi NineSliceSprite且左右固定宽度为0，仅实现纵向三段；它已纳入正式绘制区域采集。

本地回归：tests/scrollbar-thumb-slices.test.ts、tests/browser/scrollbar-thumb-slices.spec.ts。
覆盖1x/2x缩放、不同长度、像素、真实滚轮/拖动/键盘、零范围事件、旧留白行为、保存和CLI往返。
human_visual_acceptance始终false；程序夹具不代表真实美术验收。
