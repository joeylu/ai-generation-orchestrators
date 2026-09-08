# Intent → Button 合同编译器 v0.1

`src/intent-compiler.ts` 只依赖引擎无关的合同模块；不读文件、不请求网络、不导入 PixiJS、不读取时间、不生成随机 ID。同样的三个输入得到同样的合同，输入不会被改写。

## 三个输入

| 输入 | 来源与职责 |
| --- | --- |
| `ButtonIntent` | 视觉分析结果：类型、原图引用、图中文字。严格字段，不接受布局、尺寸、enabled 或业务事件。 |
| `ImageFacts` | 实际解码的 `width/height`；由调用方负责测量，纯函数本身不解码。当前 Web 适配器确实使用图片 naturalWidth/naturalHeight。 |
| `PreviewPolicy` | 明确的画布尺寸、center 放置规则、scale、enabled；没有隐式默认值。 |

```json
{
  "intentVersion": "0.1",
  "id": "button_confirm_01",
  "componentType": "Button",
  "visual": { "source": "./assets/button-confirm.png", "mode": "whole-image" },
  "text": { "mode": "baked", "value": "确定" }
}
```

`whole-image` 表示完整复用原图；`baked` 表示文字已在图中，不生成 label。没有文字用 `text: {mode: "none", value: ""}`。这些是意图中的已声明观察，代码不再次识图确认文字。

```json
{
  "canvas": { "width": 640, "height": 400 },
  "placement": "center",
  "scale": 1,
  "enabled": true
}
```

## 固定规则

| 输出 | 计算 / 来源 |
| --- | --- |
| schemaVersion / type | 0.1 / Button。 |
| id | intent.id。 |
| visual id | intent.id + `_visual`。 |
| source | intent.visual.source。 |
| width / height | 解码宽高 × 显式 scale。 |
| x / y | (画布尺寸 − 编译后尺寸) ÷ 2，保留小数，不自动裁切或缩放适配。 |
| enabled | policy.enabled。 |
| text / icon | 不添加独立槽位，完整保留图中已有内容。 |

编译完成后，使用现有 `validateButton` 再校验生成合同。347×133 原图在 640×400 画布、scale=1 时得到 x=146.5、y=133.5。

```ts
import { compileButton } from './src/intent-compiler.ts';
// imageFacts 必须来自实际资源测量；以下数值对应已解码的用户 PNG。
const contract = compileButton(intent, { width: 347, height: 133 }, policy);
```

Web 入口为 `preview.loadIntent(intent, policy, signal, progress)`：先校验 intent 和 policy，再抓取并解码图片，编译并校验合同，最后用同一已解码图片创建实例。返回的 compilation 记录全部三个输入和生成合同；不向调用方暴露 PixiJS 对象。当前 Web 画布固定 640×400，policy.canvas 不匹配直接报 CANVAS_MISMATCH；纯编译器可用于其他明确尺寸的画布。

## 错误

| 情况 | 行为 |
| --- | --- |
| 缺字段 / 未解决类型 / 不支持能力 / 旧叙述式分析 | intent 阶段明确指出字段路径；不补值、不生成合同。 |
| 缺 enabled / 非法缩放 / 无效尺寸 / 尺寸溢出 | compile 阶段报错；不自动归一化。 |
| HTTP、图片解码或加载超时失败 | resource 阶段报错；不使用旧组件或测试夹具替代。 |
| 生成合同违反合同规则 | contract 阶段报错；不创建组件。 |
| 旧加载被重载或销毁取消 | AbortError，日志明确记录旧请求被取消；只有最新成功实例存活。 |

取消已有实例并清除界面上的上次输出后才开始新的加载；失败界面显示“尚未生成合同”和未执行步骤，不留下旧结果冒充新结果。

`examples/button-confirm.json` 与 `analysis/button-confirm.compilation.json` 是本轮从实际浏览器生成记录导出的示例。运行页面没有导入这份已生成的合同 JSON；新的 intent 或图片变化会在下次编译时重新计算。

本轮仅支持完整图片 Button；没有新增在线模型调用器、图片上传编辑器、动效或其他组件。视觉分析仍由当前对话完成。
