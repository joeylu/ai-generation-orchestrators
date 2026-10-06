# 输入表单 v1

新目录 `examples/modern-mint-forms.catalog.json` 在分页目录上增加独立的
`forms.input@0.1.0`。支持单行文本/密码输入、占位文字、只读、必填、最短长度、
最大长度，以及校验后提交指定输入的确认按钮。可以放入普通布局或横向 Tabs。
程序不会执行登录、改角色名、兑换等游戏业务；成功提交交给宿主处理。

生成使用Context/Proposal/Spec/Bundle 0.7、PanelIntent 0.7、编译器0.7.0；已保存Intent 0.6兼容读取。
当前原生生成不填写行/分组/页签ID，程序按树顺序全局分配。resetRows/submitRows使用整数行序号，跨页不重新编号。
保存后的Spec和局部修改继续使用稳定字符串ID，详见[Codex接入](codex-planner.md)。
旧版本、旧目录及旧包的摘要复验继续保留。单行输入的长度限制为 1–512 个 UTF-16 单元，
中英文普通字符各一单元，emoji 通常占两单元。输入值原样保存，包括首尾空格。
必填和最短长度仅检查去掉首尾空白后的长度，不改写保存值或提交值。
空/过短值可以试玩和导出；确认按钮禁用，不发出提交事件。

输入行使用 `kind:"input"`，绑定 `{id,type:"string",initial,maxLength}` 状态。
行显式声明 `placeholder`、`inputType:"text"|"password"`、`readOnly` 及
`validation:{required,minLength,requiredMessage,minLengthMessage}`。
只有需求未指定时，生成入口使用技术缺省：空初值/占位文字、text、非只读、
maxLength 64、非必填、minLength 0；所有明确要求优先保留。密码只影响显示方式，
通用状态与提交仍保留原文。

确认按钮声明 `{kind:"submit",fields:[输入状态ID...]}`。宿主事件中的 `values`
只包含这些字段，`state` 是完整状态快照。取消使用 `emit` 通知宿主，或依请求使用
`reset-initial`；不隐式清空或关闭。切页保留输入和各页滚动位置，隐藏页不接收用户操作。
组合器隔离字段、事件及 submit/reset 范围；允许旧种类与输入表单混合。

`set-input-properties` 原子修改现有输入的 placeholder、inputType、readOnly、maxLength
及完整 validation；`set-state-initial` 修改创作初值。应用保留当前输入，新增字段使用初值，
整批可撤销。降低最大长度不能截断现有输入或初值；不符合新限制时整批拒绝并保留原面板。
删除输入必须同时处理提交/重置依赖。旧 Spec 不通过 Patch 自动升级。

Pixi 使用已有 Input 控件，补充 Harness 内的 Unicode 边界保护，防止粘贴和输入法长度截断产生
半个代理字符对。没有修改相邻组件源码。Unity 适配器 0.1.4 使用原生 UGUI InputField，
包含原生 Text/placeholder、SingleLine、characterLimit、readOnly 和 Password 设置。
共用的 PanelController 提供静默 `SetText`，按相同规则显示错误、禁用无效确认并发送
`PanelHostEvent.Values`；所有文件仍归属 `Assets/PanelHarness/`，不增加逐面板脚本。

可直接在 Studio 测试：

> 生成角色命名面板。角色名输入框，单行文本，初始为空，占位文字请输入角色名，必填，最少2个字符，最多12个字符。确认按钮校验并提交角色名；取消按钮只通知宿主，保留输入。

程序夹具和浏览器验收可以这样复现，不调用模型：

```sh
node scripts/write-forms-fixture.mjs --output output/forms-example
node scripts/build-workbench.mjs --catalog examples/modern-mint-forms.catalog.json --output output/forms-studio
node scripts/check-forms-workbench-browser.mjs --workbench output/forms-studio --output test-results/forms-browser
node scripts/build-preview.mjs --bundle output/forms-example/panel.bundle.json --output output/forms-preview
node scripts/cli.mjs export-unity output/forms-example/panel.bundle.json --output output/forms-kit
```

当前静态 Studio 为 `output/panel-studio-no-change-v1/`，本机入口为 4188。
表单编辑的紧凑传输、错误字段诊断及已有失败页面的无模型导入见 [角色宣言编辑说明](form-edit-recovery.md)。
组合预览为 `output/forms-composition-preview-v1/index.html`。
已验证 native package 为 `output/forms-unity-native-v1/panel.unitypackage`，
修改与新增输入的更新包为 `output/forms-unity-update-native-v1/panel.unitypackage`。
更新包针对相同 Runtime 的原基准，不能当成旧 Runtime 的自动迁移包。
现有测试不证明所有自然语言生成都成功；本轮模型调用为 0，见 [任务证据](tasks.md)。
多行、正则、联网校验、账号认证及上传尚未实现。
