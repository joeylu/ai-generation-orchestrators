# 按钮主次与主题下拉菜单

`examples/modern-controls.catalog.json` 显式启用 `controlStyle: "semantic-v1"`。
保留 Modern-v3 的排版，主题引用升级到 `0.5.0`，编译器固定为 `0.15.0`。
它支持现有 PanelSpec 0.7–0.14；没有新增控件种类或可执行样式。
`modern-adaptive.catalog.json` 和已保存交付包继续按原版本重编译，不自动迁移。

按钮通过精确配方引用选择外观，文字和动作保持独立：

| 配方 | 用途与外观 |
| --- | --- |
| `settings.button.primary@0.1.0` | 主操作，主题主色实底，按实际底色选择黑白文字 |
| `settings.button.secondary@0.1.0` | 辅助操作，控件底色、正文颜色、主色描边 |
| `settings.button.danger@0.1.0` | 明确的破坏性操作，红色实底；不会自动绑定删除动作 |

生成上下文和响应 schema 提供这些配方，规划提示建议每组一个主操作。
这不是按“保存”“取消”等文字匹配的业务规则；改名不改变角色、事件或重置范围。
新目录只提供明确角色的按钮配方，避免规划器继续选用无主次的通用按钮。
旧目录中的 `settings.button` 配方保留原行为。局部按钮和全局外观的显式修改仍覆盖角色默认值。
旧主题使用角色配方会明确失败，避免无声忽略。

Select 的折叠字段和展开菜单采用同一主题控件底色、正文与边界色；选中和悬停使用主色半透明强调。
折叠和展开的文字对比度按实际底色核对，边界不足时使用可读的主题色。
程序生成有界 PNG 皮肤并内嵌到原有组件资源合同，无下载、模型调用、逐帧绘图或共享组件源码修改。
校验从主题和几何重新生成字节并比对整个 PanelBundle；修改内嵌皮肤不能通过重导入。
重新打开面板仍使用原字段值，选择菜单不改动其他字段。

Unity 导出继续使用原生 UGUI Button / Dropdown 和既有适配器，字段、菜单和按钮颜色由相同样式数据提供。
Pixi 的程序皮肤随源包保留，但不会成为 Unity 项目的纹理依赖。
UGUI 的选中标记、悬停和字体使用其原生呈现，不能据此宣称与 Pixi 像素一致。
本次未运行 Unity Editor，原生验收保持 `NOT_RUN`。

从当前目录构建新 Studio；旧服务、面板和草稿不受影响：

```sh
node scripts/build-workbench.mjs --catalog examples/modern-controls.catalog.json --output output/my-controls-studio
node scripts/serve-workbench.mjs --workbench output/my-controls-studio --output-root output/my-controls-runs --port 0
node --test tests/semantic-controls.test.mjs
node scripts/check-semantic-controls-browser.mjs --output output/my-controls-browser
```

浏览器回归仅使用程序夹具，覆盖八种主题的展开选择、Escape、主按钮事件、恢复默认、离线资源摘要和重导入。
它不会调用模型，不是新的自然语言生成成功率验收。
本工作区的科幻面板前后对比（本地产物：`output/panel-controls-review-v2/index.html?view=compare`）也属于程序化视觉调整，
保留先前真实生成源的摘要、业务声明、几何、默认值和试玩值；旧演示文件保持原样。
