# Panel 控件范围与样本覆盖

当前默认链路已接入全部 16 类组件，完整映射、边界和复跑入口见 [16 种组件自动生成合同](all-components.md)。默认为 modern-all-components / PanelSpec 0.16；旧包按原合同重放。

以下为 2026-10-12 的历史覆盖记录，描述新增四类组件之前的状态，不代表当前默认目录。


Component 的 16 类基础节点不等于 Panel 的 16 类可创作内容。当前工作区默认目录 `modern-centered-cards` 沿用 `modern-image-slots` 的 8 种内容行，另以布局合同表达分组、滚动及 Tabs。[卡片对齐](card-alignment.md)只改变版本化展示，没有新增组件。以下是源码状态，已发布的固定 SDK 不会随工作区变化而更新。

| Component 节点 | 当前 Panel 对应合同 |
| --- | --- |
| Image | `image` 静态图片行：固定素材或缺图占位，没有点击选择或自动生成图片 |
| Text | `text` 静态文字行，支持显式换行布局 |
| Container | 编译器用于分组和布局，不能提交任意 Component 树代替 PanelSpec |
| Panel | 面板底板及容器由编译器创建 |
| Button | `button` 行：通知宿主、按指定字段恢复默认、提交输入 |
| Switch | `switch` 布尔开关行 |
| CheckBox | 尚未开放独立内容行；Switch 不冒充 CheckBox |
| RadioGroup | 尚未开放独立内容行；Select 不冒充单选按钮组 |
| Input | `input` 单行文本或密码输入，含长度、必填及只读约束 |
| Select | `select` 下拉选择行，保留选项及默认值 |
| ProgressBar | `progress` 只读进度行，由宿主更新 |
| Slider | `slider` 数值行，含范围、步长及默认值 |
| ScrollView | 面板垂直溢出通过布局合同表达，不能创作任意嵌套滚动树 |
| List | 尚未开放数据列表、重复项模板或动态列表绑定 |
| Dialog | 尚未开放独立 Dialog 生命周期；确认面板样式不等于 Dialog 节点合同 |
| Tabs | 2–8 页签，不能嵌套 Tabs |

尚未开放的节点需要补齐生成、状态、编辑、预览、保存和导出合同后才能接入；不能只向提示词添加名字就宣称支持。图片槽也不能替代图库浏览、图片点击选择或自动美术生产。

## 当前默认目录的确定性验证

`tests/current-catalog-coverage.test.mjs` 使用明确编写的 PanelIntent 0.11 响应，不启动 CLI：

- 8 种内容行分别通过工作台 `prepare → acceptProposal`，每种检查浅深色，共 16 个单控件样本。
- 检查单控件标题收起及 recipe 最小高度、音量默认 57、男女选项默认男、输入值及只读进度等事实，随后进行 Bundle JSON 往返和 UGUI 文档校验。
- 8 种内容在带滚动的双 Tabs 中组合；修改标题后保留内容、导航、绑定、动作及合法试玩值，计一次成功修改。
- 原生生成 schema 只声明当前 8 种内容行，直接提交 CheckBox、RadioGroup、List、Dialog 类型会被拒绝。这是协议边界检查，不是自然语言自动澄清验收。

既有 [24 种输入场景](input-coverage-v2.md) 现在同时在旧 `modern-refined` 与当前 `modern-image-slots` 目录运行，覆盖纠正、排除、Unicode、补充回答、同名对象、选中范围、无变化和整批澄清。夹具生产器根据上下文选择原生版本；旧目录仍使用 PanelIntent 0.10，当前目录使用 0.11。独立期望及反例检查保持相同。

```sh
node --test tests/current-catalog-coverage.test.mjs tests/input-coverage-v2.test.mjs
node --test tests/*.test.mjs
```

2026-10-12 定向检查 61/61 通过，日志为 `output/current-catalog-targeted-v2.log`。首次组合检查误从公共 `index.mjs` 导入未导出的摘要函数而失败；原日志 `output/current-controls-coverage-v1.log` 保留，改用既有 `canonical.mjs` 后重新执行通过。未修改生产编译器来迁就测试。

完整回归 1517/1517 通过，日志为 `output/current-catalog-regression-v1.log`；旧目录、历史 Bundle 和既有图片合同回归均保留。

后续[代表面板浏览器对照](panel-samples.md)已补齐五类面板的浅深色实际 Pixi 样本、交互与离线下载验收，当前完整回归为 1523/1523；这同样不代表新的真实模型验收。

这些结果证明协议、编译及状态保护的覆盖，不证明真实模型理解各种输入，也不代表全部样本已通过浏览器美术或 Unity 原生导入验收。真实模型及图片生成调用均为 0；Docker/Web 消费项目未修改，未发布新 SDK。

后续单独授权的[角色图片槽真实生成](image-slots-real-results-2026-10-12.md)已完成 1 次调用、0 次重试及 12 项实际浏览器检查，原始方案未改写；这是单例补充，不改变本表的组件开放范围，也不代表其余输入均完成真实模型验收。
