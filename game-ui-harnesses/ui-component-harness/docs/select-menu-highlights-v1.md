# Select 菜单状态背景：唯一接入合同 v1.0

本文件是拆分端接入的唯一依据。实现及共享校验：`src/select-menu-highlights.ts`。
这是 appearance binding 0.2 / UI document 0.2 的可选版本化扩展，独立版本 **1.0**。
复用既有 popupContentLayout、optionIcons 和交付摘要体系；不在 Choice、Text、图标、
普通 Image 节点或其他同义字段上重复配置背景。

## 唯一作者字段

位置：`appearance-binding.json` → `bindings[].states.select.menuHighlights`。
声明该扩展时，必须同时提供既有 `states.select.popupContentLayout`。保留原有
labelLayout、popupPlacement、parts 和可选 optionIcons；以下片段合并到已有 select 状态：

```json
{
  "popupContentLayout": {
    "coordinateSpace": "target-popup-local",
    "x": 2, "y": 1, "width": 350, "height": 144
  },
  "menuHighlights": {
    "version": "1.0",
    "coordinateSpace": "popup-row-local",
    "selected": {
      "color": "#168ADD",
      "alpha": 0.45,
      "insets": { "top": 1, "right": 8, "bottom": 1, "left": 8 },
      "cornerRadius": 0
    },
    "hover": {
      "color": "#168ADD",
      "alpha": 0.20,
      "insets": { "top": 1, "right": 8, "bottom": 1, "left": 8 },
      "cornerRadius": 0
    }
  }
}
```

数值是 Settings 派生验证配置，不是其他样本的默认值或原图观察事实。生产作者须按
明确设计意图填写。运行时不采样颜色、不推断亮度/主题、不按组件名称匹配。

## 几何和叠加规则

设 Select 有 N 个 options，安全区宽 W、高 H。沿用菜单等高行规则：每行 W × H/N，
第 i 行在 popup 中的原点是 `(safe.x, safe.y + i*H/N)`。两种状态分别声明四边内缩。
绘制矩形为 `(left, top, W-left-right, H/N-top-bottom)`，圆角为 cornerRadius。
整个菜单内容继续裁剪到安全区；背景不扩大选项命中区，也不侵占弹出面板装饰边界。

绑定中内缩、圆角使用注册后的目标逻辑单位。正式外观应用器按 Select 的已验证
runtimeScale 除一次，存入 popupCanvas 源单位；渲染按当前 popup 缩放乘一次。
alpha、color、version 不缩放；页面 CSS 缩放不改变合同。

同一行 **selected 优先于 hover，不叠加**：

| 行状态 | 绘制 |
|---|---|
| 未选中、未悬停 | 不绘制状态背景 |
| 未选中、悬停 | hover |
| 选中、未悬停 | selected |
| 选中、悬停 | selected（仍只绘制一次） |

alpha=0 可以明确关闭某状态背景；选中且 selected.alpha=0 时也不改用 hover。
alpha 是标准 source-over 填充透明度，实际像素仍受菜单底图和已有父级 opacity 影响。
层次固定为：**popup 底图 → 单层状态背景 → optionIcons → 运行时文字**。
仅 Graphics 填充指定颜色，不设置行、图标、文字容器的 tint 或 alpha。

移出后恢复 selected 或无背景。鼠标、键盘和正式程序接口改变 selectedId 后立即
更新；显式扩展的键盘更新保留当前 hover 行。关闭时随 popup 生命周期销毁背景与
监听器，重开从当前 selectedId 创建；不保留旧 hover。收起栏外观不受该字段影响。

## 严格校验

- menuHighlights 四个字段全部必填，version 只能为字符串 `"1.0"`，coordinateSpace
  只能为 `"popup-row-local"`。对象、状态和 insets 均拒绝未知字段或缺失字段。
- selected、hover 都必须是完整对象，不能写 null；要禁用某态，显式 alpha=0。
- color 只能为 `#RRGGBB`，十六进制大小写均可；不接受颜色名、短 HEX、8 位 HEX、
  rgba()、CSS 变量或脚本。透明度唯一位置是 alpha。
- alpha 必须有限且在 [0,1]；内缩、圆角必须有限且非负。
- 左右内缩之和必须小于行宽，上下之和必须小于行高；留下的宽高必须大于零。
  cornerRadius 不得大于内缩后较短边的一半。非法几何明确失败，不静默裁正。
- 必须有有效、位于 popup 内的 popupContentLayout；选项改变后重新校验行几何。
- binding 和运行时 UiDocument 共享上述验证；外观应用、Bundle 校验与官方 CLI
  都走此链路。无效声明不能被当作“未声明”而降级到旧绿色。

## 持久化与兼容

应用器写入 `Select.props.appearance.menuHighlights`，同样的结构与版本，只做上述
几何单位转换。拆分端只作者 binding 字段，不另造第二份运行时声明。
本扩展不引入资源；现有图标、底图的素材引用、摘要与路径校验保持原有规则。

官方单包导入、Studio 保存 JSON/重新打开、handoff 2.1 导出和官方 CLI 再导入保留
绑定、运行时外观与原参考证据。直接编辑已认证方案的外观仍适用 stale-evidence
保护，不能忽略错误去导出；需要从新作者绑定构建并完整校验新的派生交付包。

未声明 menuHighlights 的旧包保持原有表现：有外观素材时选中绿 #6B8F3A/0.14，
选中内缩 x=8/y=6、圆角 min(12,rowHeight/4)；悬停绿 #6B8F3A/0.12 满行矩形，
选中且悬停仍沿用历史两层叠加。旧无素材 Select 也保持原状。
此前严格校验器会拒绝未知 menuHighlights，旧消费端不得删除字段后继续导入；
部署接入须固定支持本扩展的消费端版本。

## 拆分端同步清单

只同步 states.select.menuHighlights 的类型、严格字段集、v1.0 验证、几何规则及
完整序列化；复用已有 popupContentLayout 和 appearance-binding 摘要重算。
预检须确认目标消费端支持该字段。已生成的蓝色验证包是派生设计测试，原图、
unknown 字段、原参考状态和人工未确认标记不能被新配色覆盖。
本轮未修改拆分端代码，其后应以本文件为准同步。

回归：`tests/select-menu-highlights.test.ts`、
`tests/browser/select-menu-highlights.spec.ts`（真实鼠标/键盘、像素、图标文字及往返）。
