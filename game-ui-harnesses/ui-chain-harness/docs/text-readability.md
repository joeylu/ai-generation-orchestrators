# 组件文字可读性

新皮肤在确定性拆分/打包时生成 `theme.textColors`，以皮肤部件角色为键。按钮、输入框、列表项、页签和面板分别保存字色，各自的正常、按下、选中底图独立检查。不再用一份全局 `palette.text` 判断所有底图。

## 维护入口

| 入口 | 责任 |
| --- | --- |
| `configs/text-readability-policy.json` | 公共深浅候选色、最低对比度、采样网格、透明度门槛、需要检查的角色范围 |
| 原始导入/assembly 配置的 `theme.textColors` | 可选的单套皮肤人工指定；可只指定部分角色，程序补齐其余角色并校验全部角色 |
| `src/skins/text-readability.mjs` | 用真实交付 PNG 和内容安全区计算颜色与检查结果 |
| `src/runtime/text-colors.mjs` | 全部正式组件/面板共用的角色字色应用；跟随当前显示底图和状态 |

普通用户不需要填写以上配置。不要编辑生成的 `kit.json` 或旧包清单；应修改维护源后重建新版本。公共策略进入工具指纹，源配置、字色和 PNG 摘要进入包及报告。

## 自动检查的范围

- 在内容安全区与图片中央 70% 区域的交集中取 17×17 网格，按实际像素去重。按照图集缩放与部件 density 换算安全区；空区域不能通过。
- 透明/半透明点不以 RGB 冒充真实底色。低于 alpha 门槛的采样点、有效点不足、最差采样对比度低于公共策略 4.5，均为 `needs-review`。
- 自动字色从深浅候选中选取最差采样对比度更高者；人工指定色保持不变，但仍检查，差色不会被静默判为通过。
- `passed` 仅表示底图采样检查通过。字体、字号、截断、内容区和操作状态沿用运行时和浏览器回归；不意味着每个像素、任意文字位置或任意画布缩放都可读。
- 正式运行时按绘制顺序与文字位置匹配皮肤底图，应用已保存字色，不逐帧取样图片。独立标签按宿主 renderer 背景选择深浅色；不修改组件运行时以外的宿主 Text。
- 透明宿主、自定义背景、混色纹理、遮挡、hover tint 或 disabled alpha 仍需合成结果复核。运行时 evidence 的 `compositingReview` 标记透明度或染色情况，不把普通状态的检查结果等同于这些状态已通过。
- 没有引入 Codex session 或人工视觉查看的强制生产依赖，也不声称已经实现任意画面的视觉质量保证。

Studio 的本地画布编辑副本另支持作者为单个节点指定 `fontSize` 与 `textColor`，不修改上述冻结主题、PNG、报告或清单。字号沿用同源尺寸及真实字体检查；显式颜色忠实应用于当前控件自己的所有文字与状态，优先于皮肤自动字色，子控件保留自己的策略。运行时将这类证据标记为 `colorSource: node-override` 和 `compositingReview: true`，不把原皮肤采样的 `passed` 归给自选颜色。勾选恢复默认删除节点覆盖，重新使用原角色颜色。这属于用户编辑及视觉验收，未重新生成皮肤的对比度报告。

## 产物与旧包

`skin-pack.json` 保存正式字色。导入报告、组件消费包、设置/action 面板预览均带 `text-readability.json` 或对应报告字段。Studio 新包画布显示待复核状态数量，并提供报告入口；独立导出和面板使用同一个运行时。

旧包继续可加载，正式检查返回 `not-assessed`。其 Studio 画布仍可使用预览辅助色，原导出不会被悄悄覆盖。

需要升级旧包时可运行：

```powershell
node scripts/skin-text-upgrade.mjs --package work/<verified-package> --out work/text-readability/<name>
node scripts/consumer-pack.mjs --package work/text-readability/<name>/<revision-id>/pack --out work/text-readability/<name>-consumer
```

升级程序验证原资源后建立新的 revision 和 manifest，保留资源字节、原版本及来源摘要，生成 `text-upgrade.json`。不修改图片，不调用模型，不自动切换已完成项目选中的历史产物。新项目的正常拆分链路直接获得正式字色。

验证命令：`node --test tests/text-readability.test.mjs tests/skin-package.test.mjs`；`node scripts/consumer-check.mjs <consumer-directory>` 额外验证正式字色、下拉、按下和选中态、宿主文字隔离；`node scripts/settings-check.mjs <preview-directory>` 验证横竖面板复用字色。
