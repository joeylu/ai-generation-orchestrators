# 组合面板验收 · 2026-10-06

本轮 3 条明确需求分别调用一次 Codex CLI（gpt-6-luna / xhigh），全部返回可编译方案。
调用、原始草稿、上下文、公共方案、报告和生产回执逐一复验，实际调用 3 次，自动重试 0。
原先 40 个固定用户输入用例的结果保持独立；本轮补充复杂组合与原生导出覆盖。

| 场景 | 核验行为 | 浏览器检查 | 原生 Unity 检查 |
| --- | --- | ---: | ---: |
| COM01 三页游戏设置 | 14 行控件、选项、初值、各页独立滚动、切页关闭下拉弹层、页面范围恢复 | 10 PASS | 44 PASS |
| COM02 跨页角色资料 | 隐藏页输入校验、同时提交两页字段、取消保留输入、编辑和撤销 | 11 PASS | 40 PASS |
| COM03 资源加载 | 两个只读进度条、静默宿主更新、格式化显示、拒绝越界、取消与局部重置 | 11 PASS | 42 PASS |
| COM04 双实例加载组合 | 同一来源复用两次、字段和事件命名隔离、两页重置互不干扰 | 7 PASS | 41 PASS |

COM04 是程序组合已有真实生成包，新增模型调用为 0。COM02 的本轮编辑/撤销检查使用明确标记的
程序方案，不计为真实语言修改成功。真实修改入口的此前验收见
[40 个用户输入用例](user-input-acceptance-2026-10-06.md)。

浏览器使用 Edge 154 / Playwright，桌面 1440×1080、移动 390×844，4 组共 39 项通过。
模型请求被拦截保护，重放阶段实际调用 0 次；无应用/控制台错误、错误覆盖层和横向溢出。
浏览器插件在当前环境不可用，因此复用了项目已有的 Playwright。

Unity 6000.3.7f1 / UGUI 2.0 的实际 PlayMode、渲染和包检查共 167 项通过。四个导出包在同一个
隔离测试项目中共存，另外 6 项检查通过：共享 Runtime 的版本、路径、字节和 GUID 一致，
不同面板的 Prefab、字体、纹理、精灵和身份文件位于各自目录；四包安装预检均为
`ALREADY_INSTALLED`，写入次数 0。每个面板有自身原生交互证据；四个面板同时活动时的交互未测。
没有修改用户游戏项目。

```text
Assets/PanelHarness/
  Runtime/                         固定的 5 个共享脚本
  Panels/composite-settings/
  Panels/composite-role-form/
  Panels/composite-loading/
  Panels/composite-loading-pair/
```

两项发现及处理：

- 首轮加载面板测试按“加载进度”定位，但需求和生成标签是“加载进度条”。纠正测试定位，
  以控件种类、顺序和明确标签核验原包，未重新生成。原中断报告保留。
- 两个下拉框导致原生验收脚本重复记录同一个检查名，严格发布程序拒绝该报告。
  保留每个下拉框的检查，在全部通过后记录一次汇总结果。重新执行原生验收后成功发布；
  没有编辑原报告或放宽发布校验。发布/验证 29 项、组合/安装 13 项本地回归均通过。

完整证据为 `output/composite-acceptance-v1/acceptance.json`；
预览和四个 Unity 包入口为 `output/composite-acceptance-v1/index.html`。
原始真实调用保存在 `output/composite-live-real-v1/`，浏览器重放在
`test-results/composite-browser-v2/`，原生证据在 `test-results/cun1b/`、`cun2/`、`cun3/`、`cun4/`。
首轮原生发布拒绝的证据仍在 `test-results/cun1/`。

明确需求保存在 `examples/composite-v1/requests.json`，共享断言保存在 `acceptance.mjs`。
复用本轮已保存的真实生成包，可以执行下面的零模型浏览器回归；输出目录必须是新目录：

```sh
node scripts/check-composite-workbench-browser.mjs --workbench output/panel-studio-clarification-guard-v1 --bundles output/composite-live-real-v1 --output test-results/composite-browser-fresh
```

`scripts/check-unity-coexistence.mjs` 使用本机 Unity、字体、待验证导出工具包和已验证交付包，
只创建 Harness 下的隔离测试项目，不执行模型调用。
`--companions` 文件只包含 `deliveries` 数组，路径相对该文件解析。

原生 UGUI 的外观与 Pixi 不保证像素一致；本轮字体的 Emoji 字形显示不足，但输入和提交的原始
Unicode 数据保留。多层 Tabs 来源仍由组合器明确拒绝。这批固定完整需求通过，不能推断任意
自然语言、其他 Unity 版本或尚未验收的 Cocos/Godot/UE 适配器均稳定。
