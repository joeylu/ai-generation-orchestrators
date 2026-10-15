# 分组标题4条真实结果与混合设置修正

已批准冻结计划 `output/content-heading-real-plan-v2`，SHA-256 `cd11d7b74a78a99da07ccbcbf6d361988bf150854ac37eb867b15a164c49e9c3`，实际执行4次gpt-6-luna／xhigh，各一次，自动重试0。授权已消费，未补跑失败项。

| 原短口令 | 原始结果 | 观察 |
| --- | --- | --- |
| 做个背包面板 | 交付 | 重复小标题未出现，物品标签与两按钮保留 |
| 帮我做个设置面板 | FAIL：CONTROL_WIDTH | 两滑块、画质Select、全屏Switch及两按钮同组；编译时滑轨空间不足，未交付 |
| 做个角色选择面板 | 交付 | List及确认操作保留，未额外显示分组标题 |
| 做个退出游戏确认框 | 交付 | 完整正文、两个选择及居中排版保留 |

3份原始交付通过22项常规浏览器检查，以及1100、390、375像素下各9屏标题、字号与交互检查；375像素最小显示文字约16.46。浏览器无错误或警告。未交付设置标为未评估，整批仍为FAIL。489份冻结源码、单次授权、4份原生调用收据、实际ZIP摘要完整性通过，不代表4条全部成功。

原始结果页 `output/content-heading-real-review-v1/index.html`，原始调用 `output/content-heading-real-v1`，完整性审计 `output/content-heading-real-audit-v1`。原始方案、失败、收据与3份交付未改写。Browser plugin not available，采用本机Playwright／Edge；Unity原生和游戏服务未运行。这是4条有限样本，不推断总体成功率。

## 独立离线修复

新目录 `modern-readable-game-layout`、主题0.26.0／0.26.1与 `game-readable-v2` 显式选择Compiler 0.39.0，Studio／SDK新生成共用该目录。正文／按钮24、标题32、普通宽420、菜单宽360及v5分组标题规则保持。旧目录和原始0.38结果保持原意义。

混合组中的Slider和Progress采用独立标签／数值行与完整轨道，按实际控件高度累计内容。新版本未指定高度且采用自动溢出策略时，恢复按最大内容页撑高，避免遗漏v5分支后出现非必要滚动。明确面板／画布尺寸、滚动、按钮尺寸、字号和业务事件保持绑定。运行时不加载外部skill，也不修改短口令强迫模型拆组。

全量2028／2028项离线回归通过，新增15项覆盖：三份原0.38包精确重放与设置原FAIL；同一原始意图明确改用新目录全部编译；Slider与CheckBox／List／Image／Progress混用、长设置、Tabs、多内容标题、明确尺寸，以及全部16组件的编译和Unity文档导出。导出检查不代表Unity原生运行。

4份原始意图明确重放，加7种程序夹具，共11份离线交付，通过129项常规浏览器、36屏原生标题、36屏实际字号及33组操作；包括所有页签的首屏按钮可见检查。375像素最小显示文字约16.46，控制事件和选择状态变化通过。新增真实调用0，不能替换原批3／4，也不是新模型复测。Agent检查设置390像素截图，无重复小标题、完整滑轨及两操作按钮；用户美术确认尚未记录。

修复入口 `output/readable-layout-replay-review-v1/index.html`；离线交付 `output/readable-layout-replay-v1`；只读证据为 `output/readable-layout-replay-browser-v1`、`output/readable-layout-replay-headings-v1`、`output/readable-layout-replay-readability-v1`、`output/readable-layout-replay-interactions-v1`；全量记录 `output/readable-layout-full-v1.log`。本地产物不随Git提交。

实际SDK候选通过39项安装、17项SDK浏览器、12项全16组件浅深色及24项确认框检查，使用10个明确替身，真实调用0。首次安装检查漏列新目录的旧夹具主题映射，原失败保留；修正检查工具后在同一归档上重新通过，未改写归档。候选为4,544,601字节，SHA-256 `353af861420d6494c2c2961e5e480fc8f85934d8964ba36a307f457c16d60888`，工作区候选不可发布。记录 `output/readable-layout-sdk-candidate-v1`、`output/readable-layout-sdk-installed-v2`、`output/readable-layout-sdk-browser-v1`、`output/readable-layout-components-browser-v1`、`output/readable-layout-compact-browser-v1`。

后续真实批限定原4条短口令、完整16主题和12图标、生产共享提示、串行各一次、最多4次、零重试。新冻结计划 `output/readable-layout-real-plan-v1`，SHA-256 `c5e5d861834a9aa6ef66a65ab86c636d2b309ae2b0e1dbb004f26de575619c18`，491份来源已校验留存，该授权随后已消费：4次调用全部交付，零重试，34项浏览器及标题／字号／操作各12屏与完整性审计通过。[新真实结果](readable-layout-real-results-2026-10-15.md)单独记录，不覆盖本页原3／4。计划入口 `output/readable-layout-real-plan-review-v1/index.html`，不得再次执行已消费计划。当前rc.7未发布，已发布rc.6保持原字节。
