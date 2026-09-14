# Select 菜单逐选项图标：唯一接入合同 v1.0

消费端实现于 `src/select-option-icons.ts`。此文档是拆分端的唯一字段依据；
不向 `Choice {id,label}` 增加同义图标字段，不用普通 Image 节点覆盖菜单。
这是 appearance binding 0.2 / UI document 0.2 的可选严格扩展，独立版本为 1.0。
生成、计划冻结与美术授权不属于此功能。

## 拆分端声明

在已有 Select `bindings[].states.select` 中增加 `optionIcons`，并显式提供
已有的 `popupContentLayout`。背景/箭头仍走原有 `parts`，**菜单图标只在
optionIcons.items[].icon.layerId 中引用**，不在 parts 重复登记。

```json
{
  "labelLayout": {"coordinateSpace":"target-component-local","x":12,"y":4,"width":240,"height":40},
  "popupPlacement": {"coordinateSpace":"target-component-local","anchor":"below-start","gap":4},
  "popupContentLayout": {"coordinateSpace":"target-popup-local","x":12,"y":12,"width":276,"height":144},
  "optionIcons": {
    "version":"1.0",
    "coordinateSpace":"popup-row-local",
    "items":[
      {"optionId":"all","icon":{"layerId":"globe-icon","layout":{"x":6,"y":10,"width":28,"height":28}},"labelLayout":{"x":48,"y":4,"width":220,"height":40}},
      {"optionId":"forest","icon":{"layerId":"tree-icon","layout":{"x":6,"y":10,"width":28,"height":28}},"labelLayout":{"x":48,"y":4,"width":220,"height":40}},
      {"optionId":"mountain","icon":{"layerId":"mountain-icon","layout":{"x":6,"y":10,"width":28,"height":28}},"labelLayout":{"x":48,"y":4,"width":220,"height":40}}
    ]
  }
}
```

示例 ID 仅演示格式，必须替换为语义文档的真实 optionId 和已认证的交付层 ID。
示例不确立 Quest Journal 的像素、几何或参考状态；不能直接充当生成输入。

## 几何、资源和生命周期

- 每个选项必须出现一次，items 的数组顺序无关；**行序只取 Select.props.options**。
  未知/重复 ID、遗漏条目均失败。允许部分选项不带图标，唯一写法为
  `"icon":null`，仍须给出该选项的 labelLayout；无效引用不会降级成 null。
- popupContentLayout 为弹出面板安全内容区。N 个选项等分其高度，行宽为其宽度。
  第 i 行原点 = `(safe.x, safe.y + i * safe.height / N)`，相对 popup 左上角。
  icon.layout 与 labelLayout 的 x/y/width/height 相对此行，必须完全位于行内，
  坐标有限且非负、尺寸有限且大于零，图标占位与文字占位不得重叠。
  安全区本身必须位于 popup 图层范围内；负坐标、越界、缺少安全区均失败。
- binding 中上述几何使用注册后的目标逻辑单位；应用外观时除以注册等比缩放，
  存入 popupCanvas 对应的源单位。渲染时乘实际 popup 缩放一次，不能重复缩放。
  声明位置为权威布局，图层在拆分源图中的 left/top 不会被再次叠加。
- `layerId` 必须引用同包已认证场景层；素材按原 PNG 字节加入 Bundle 资源。
  图标在 layout 中居中 contain，保留**整个 PNG（含透明留边）**的宽高比、alpha；
  不裁掉透明边、不拉伸、不自动重着色。图标不会自动带到收起栏。
- 菜单背景 → 选中/悬停反馈 → 图标 → 运行时文字，层次独立。
  显式配置反馈颜色与几何时只使用 [menuHighlights v1.0](select-menu-highlights-v1.md)，
  不在 optionIcons 内重复声明背景或 tint。
  普通文字始终读取 option.label，独立裁剪到 labelLayout；超长文字沿用 ellipsis。
  所有菜单内容额外裁剪到安全区，行是点击目标，图标及文字不截断命中。
  整块 popup（包括装饰留白）阻挡底层控件点击。
- 打开时创建各 optionId 的 Sprite，关闭/卸载时销毁；已有关闭动效可播放退出阶段，
  完成后不保留 Sprite。图标纹理在控件加载时获取、卸载时释放，可复用同一资源。
  图标在 hover/selected 状态保持原绑定；v1 不声明不同状态的另一套图标。
- 鼠标选择、键盘方向键仍沿用既有 Select 语义：方向键立即改变当前选项，Enter
  打开/关闭菜单，Escape 关闭且不回滚已发生的选择，Tab 在控件间移动并关闭菜单。
  同一选项重复选择、方向键到达边界不会额外发 change；不会触发底层按钮。

## 消费端持久化形式

正式应用器生成 `Select.props.appearance.optionIcons`，同版本、coordinateSpace、
items/optionId/labelLayout。唯一转换是 `icon.layerId` → `icon.image`（Bundle 内相对
资源路径）和上述单位换算：

```json
{"optionId":"all","icon":{"image":"appearance/<archive-sha256>/globe-icon.png","layout":{"x":6,"y":10,"width":28,"height":28}},"labelLayout":{"x":48,"y":4,"width":220,"height":40}}
```

这两种引用分别属于已有交付绑定和已编译运行时外观，不是两套上游格式。
拆分端只作者 layerId 声明，让官方 component-handoff CLI 完成编译。
资源枚举、Bundle 完整性校验、保存 JSON、Bundle 0.3 的原包证据和 handoff 2.1
运行时快照导出均保留此字段与素材。原参考图、映射、状态、范围保持原始证据。
更改选项或外观使原证据失效时，继续使用现有 stale-evidence 拒绝机制。

## 版本与失败行为

未知版本/字段、非法引用/路径/尺寸/坐标、缺失资源、摘要不符均明确失败；无效素材
不以程序图标替代。旧无图标声明保持兼容，不会猜测补图标。
此前消费端的 binding 0.2 和 document 0.2 校验器均拒绝未知字段，收到 optionIcons
会以 UNSUPPORTED_FIELD 拒绝，而不会忽略；生产接入仍须固定支持本扩展的消费端版本。
不支持任意行高、菜单分页/滚动、业务过滤或图标状态变体，未来扩展需另行版本化。

## 本地离线回归

`tests/helpers/select-option-icons-fixture.ts` 是唯一确定性夹具生成器（三种几何图标，
带透明与半透明边缘），不是 Quest Journal 美术。正式导入命令：

```sh
node scripts/cli.mjs component-handoff <fixture.zip> --output <new-bundle.json> --reference-output <new-reference.json>
node --test tests/select-option-icons.test.ts
```

浏览器回归 `tests/browser/select-option-icons.spec.ts` 在实际 Studio 用鼠标和键盘检查
值、change 次数、真实截图像素、图标比例、文字映射、遮挡、无残留，以及保存重开和
导出后官方 CLI 再导入。程序夹具的原图观察状态保持 unknown、视觉范围排除；
真实输入检查是派生测试，不冒充参考视觉通过，human_visual_acceptance 始终 false。
