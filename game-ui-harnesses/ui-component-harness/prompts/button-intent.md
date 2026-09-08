# Button 视觉识别输出规范 v0.1

输入：一张按钮局部图，以及调用方指定的 id 和资源 source。由当前对话视觉能力分析；这份规范本身不代表已连接自动模型 API。

只输出以下 JSON，不额外填写合同或布局。不得根据颜色、文字推断业务行为、enabled、尺寸、位置或未给出的状态外观。

```json
{
  "intentVersion": "0.1",
  "id": "调用方给定的唯一组件ID",
  "componentType": "Button",
  "visual": { "source": "调用方给定的图片路径", "mode": "whole-image" },
  "text": { "mode": "baked", "value": "图片中可确认的文字" }
}
```

`text.mode=baked` 表示文字已在图中，编译时不再叠字；没有文字时用 `mode=none,value=""`。已有图标、边框和背景完整保留在原图中，不要求拆层，也不生成新美术。

识别不清不能硬填 Button 或猜文字：输出未解决原因并停止该项；即便收到 `componentType=Unresolved`，编译器也会明确拒绝，不生成可渲染合同。独立文字、分层视觉、其他组件类型和未知字段均显式报不支持。

实际尺寸由浏览器解码图片得到，预览位置、scale、enabled 由 `examples/preview-policy.json` 显式提供。编译器的输入不包含这些视觉推断值。
